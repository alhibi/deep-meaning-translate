/**
 * The one live-translation handler, shared by the web route and the versioned native
 * route. Prompts, provider routing, admission and cancellation live here and only here.
 */
import { InputSchema } from "./translate.functions";
import { takeLiveToken, takeToken, takeWarmToken } from "./throttle";
import { z } from "zod";
import { clientAddress, parseAdmittedJson } from "../requestSafety";

export const StreamInput = InputSchema.extend({
  mode: z.enum(["live", "full"]).optional().default("live"),
});

/** Warm-up: resolve and open the connection to the provider before the first keystroke. */
export async function warmTranslateStream(request: Request): Promise<Response> {
  const noContent = new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
  // Free work for us, but still an outbound request: bounded per client, or the
  // endpoint becomes a request amplifier for anyone who knows the URL.
  if (!takeWarmToken(clientAddress(request))) return noContent;
  // No text and no credentials are sent by the HEAD.
  await Promise.allSettled([
    fetch("https://api.deepseek.com/models", { method: "HEAD" }).catch(() => {}),
    import("./providers/deepseek.server"),
    import("./providers/opencode.server"),
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
  const apiKey = process.env["OPENCODE_API_KEY"];

  const { streamLiveTranslation, streamFullTranslation } =
    await import("./providers/opencode.server");
  const { TranslationError, LUNA_ENABLED, effectiveBrain } = await import("./types");
  const started = Date.now();
  let deltas: AsyncGenerator<string>;
  const { mode, ...rest } = data;
  const req = { ...rest, partial: mode !== "full" };
  const ds = await import("./providers/deepseek.server");
  const { shouldFallBack } = await import("./engine.server");
  const brains = {
    luna: () => {
      if (!apiKey || !LUNA_ENABLED) throw new TranslationError("auth", "Luna is not configured.");
      return mode === "full"
        ? streamFullTranslation(apiKey, req, upstream.signal)
        : streamLiveTranslation(apiKey, req, upstream.signal);
    },
    deepseek: () => {
      const key = ds.deepseekKey();
      if (!key) throw new TranslationError("auth", "DeepSeek is not configured.");
      return mode === "full"
        ? ds.streamDeepSeekFull(key, req, upstream.signal)
        : ds.streamDeepSeekLive(key, req, upstream.signal);
    },
  } as const;
  let brain: keyof typeof brains = effectiveBrain(data.brain);
  try {
    try {
      deltas = await brains[brain]();
    } catch (err) {
      // The other brain takes over when the chosen one is down, out of credit or rate limited.
      if (request.signal.aborted || !LUNA_ENABLED || !shouldFallBack(err)) throw err;
      brain = brain === "luna" ? "deepseek" : "luna";
      deltas = await brains[brain]();
    }
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
    },
  });
}
