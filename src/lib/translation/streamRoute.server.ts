/**
 * The one live-translation handler, shared by the web route and the versioned native
 * route. Prompts, provider routing, admission and cancellation live here and only here.
 *
 * Model choice is strict: the selected writer is the only provider a request is sent to.
 * There is no automatic second-model fallback and no cooldown rerouting — an unavailable
 * model fails its own request, visibly, instead of silently answering with the other one.
 */
import { InputSchema } from "./translate.functions";
import { takeLiveToken, takeToken, takeWarmToken } from "./throttle";
import { z } from "zod";
import { clientAddress, parseAdmittedJson } from "../requestSafety";

export const StreamInput = InputSchema.extend({
  mode: z.enum(["live", "full"]).optional().default("live"),
});

/**
 * Warm-up: resolve every module the first request needs and open the provider connection
 * before the first keystroke. The imports run together instead of one after the other.
 */
export async function warmTranslateStream(request: Request): Promise<Response> {
  const noContent = new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
  // Free work for us, but still an outbound request: bounded per client, or the
  // endpoint becomes a request amplifier for anyone who knows the URL.
  if (!takeWarmToken(clientAddress(request))) return noContent;
  // No text and no credentials are sent by the HEAD.
  // A warm-up the caller no longer waits for is not worth an outbound request: the
  // request signal cancels the HEAD together with the client connection.
  await Promise.allSettled([
    fetch("https://api.deepseek.com/models", { method: "HEAD", signal: request.signal }).catch(
      () => {},
    ),
    import("./providers/deepseek.server"),
    import("./providers/opencode.server"),
    import("./engine.server"),
    import("./types"),
  ]);
  return noContent;
}

export async function handleTranslateStream(request: Request): Promise<Response> {
  const fail = (kind: string, status: number) =>
    Response.json(
      { ok: false, kind },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          ...(kind === "rate" ? { "Retry-After": "2" } : {}),
        },
      },
    );
  // A provisional stream and a settled sentence are different budgets: a burst of
  // typing must never spend the allowance the finished sentence needs.
  const admitted = await parseAdmittedJson(request, StreamInput, (data) =>
    (data.mode === "full" ? takeToken : takeLiveToken)(clientAddress(request)),
  );
  if (!admitted.ok) return fail(admitted.kind, admitted.kind === "rate" ? 429 : 400);
  const data = admitted.data;
  const upstream = new AbortController();
  const abort = () => upstream.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const cleanup = () => request.signal.removeEventListener("abort", abort);

  const started = Date.now();
  // Resolve the hot path once, in parallel.
  const [opencode, types, ds] = await Promise.all([
    import("./providers/opencode.server"),
    import("./types"),
    import("./providers/deepseek.server"),
  ]);
  const { streamLiveTranslation, streamFullTranslation } = opencode;
  const { TranslationError, LUNA_ENABLED, effectiveBrain } = types;
  const lunaKey = process.env["OPENCODE_API_KEY"];
  const deepseekKey = ds.deepseekKey();

  const { mode, ...rest } = data;
  const req = { ...rest, partial: mode !== "full" };
  const brain = effectiveBrain(data.brain);
  /**
   * One attempt on the selected provider. Waiting out a provider Retry-After would make
   * the person wait for a model they did not choose to fail; a strict selection must
   * answer (or fail) now, and the same model is the only thing ever asked again.
   */
  const options = { maxAttempts: 1 };
  let deltas: AsyncGenerator<string>;
  let upstreamMs = 0;
  try {
    if (brain === "luna") {
      if (!lunaKey || !LUNA_ENABLED) throw new TranslationError("auth", "Luna is not configured.");
      deltas =
        mode === "full"
          ? await streamFullTranslation(lunaKey, req, upstream.signal, options)
          : await streamLiveTranslation(lunaKey, req, upstream.signal, options);
    } else {
      if (!deepseekKey) throw new TranslationError("auth", "DeepSeek is not configured.");
      deltas =
        mode === "full"
          ? await ds.streamDeepSeekFull(deepseekKey, req, upstream.signal, options)
          : await ds.streamDeepSeekLive(deepseekKey, req, upstream.signal, options);
    }
    upstreamMs = Date.now() - started;
  } catch (err) {
    cleanup();
    // Cancelled by the app (newer text typed): end quietly, not an error.
    if (request.signal.aborted || (err as Error)?.name === "AbortError")
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    const kind = err instanceof TranslationError ? err.kind : "provider";
    return fail(kind, kind === "rate" ? 429 : 502);
  }

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let outcome = "ok";
      try {
        for await (const d of deltas) controller.enqueue(enc.encode(d));
        controller.close();
      } catch (err) {
        // The app cancels outdated translations on purpose; a dropped
        // connection is normal, not a server error — end quietly.
        const cancelled =
          upstream.signal.aborted ||
          (err as Error)?.name === "AbortError" ||
          (err as Error)?.message === "aborted";
        outcome = cancelled ? "cancelled" : "stream_error";
        if (cancelled) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        } else controller.error(err);
      } finally {
        cleanup();
        // Privacy: metrics only — never the text.
        console.info(
          JSON.stringify({
            event: "translate_stream",
            mode: data.mode,
            brain,
            upstreamMs,
            outcome,
            ms: Date.now() - started,
            chars: data.text.length,
          }),
        );
      }
    },
    cancel() {
      upstream.abort();
      cleanup();
      void deltas.return(undefined).catch(() => {});
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      // The selected (and only) writer. Never rewritten by a rescue.
      "X-Translation-Writer": brain,
    },
  });
}
