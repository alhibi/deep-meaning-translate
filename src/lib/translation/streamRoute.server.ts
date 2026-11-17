/**
 * The one live-translation handler, shared by the web route and the versioned native
 * route. Prompts, provider routing, admission and cancellation live here and only here.
 */
import { InputSchema } from "./translate.functions";
import { takeLiveToken, takeToken, takeWarmToken } from "./throttle";
import { z } from "zod";
import { clientAddress, parseAdmittedJson } from "../requestSafety";
import {
  noteProviderFailure,
  noteProviderSuccess,
  providerCooling,
  type BrainId,
} from "./providers/health.server";

export const StreamInput = InputSchema.extend({
  mode: z.enum(["live", "full"]).optional().default("live"),
});

/**
 * Warm-up: resolve every module the first request needs and open the provider connection
 * before the first keystroke. The imports run together: they used to load one after the
 * other inside the request handler, so the first sentence paid for four serial module
 * resolutions on a cold instance.
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
  // Resolve the hot path once, in parallel. These modules used to be loaded one after
  // the other before a single provider byte could leave the server.
  const [opencode, types, ds, engine] = await Promise.all([
    import("./providers/opencode.server"),
    import("./types"),
    import("./providers/deepseek.server"),
    import("./engine.server"),
  ]);
  const { streamLiveTranslation, streamFullTranslation } = opencode;
  const { TranslationError, LUNA_ENABLED, effectiveBrain } = types;
  const { shouldFallBack } = engine;
  const lunaKey = process.env["OPENCODE_API_KEY"];
  const deepseekKey = ds.deepseekKey();
  const configured: Record<BrainId, boolean> = {
    luna: Boolean(lunaKey && LUNA_ENABLED),
    deepseek: Boolean(deepseekKey),
  };
  const other = (brain: BrainId): BrainId => (brain === "luna" ? "deepseek" : "luna");

  const { mode, ...rest } = data;
  const req = { ...rest, partial: mode !== "full" };
  const streamFrom = (
    brain: BrainId,
    options?: { maxAttempts: number },
  ): Promise<AsyncGenerator<string>> => {
    if (brain === "luna") {
      if (!lunaKey || !LUNA_ENABLED) throw new TranslationError("auth", "Luna is not configured.");
      return mode === "full"
        ? streamFullTranslation(lunaKey, req, upstream.signal, options)
        : streamLiveTranslation(lunaKey, req, upstream.signal, options);
    }
    if (!deepseekKey) throw new TranslationError("auth", "DeepSeek is not configured.");
    return mode === "full"
      ? ds.streamDeepSeekFull(deepseekKey, req, upstream.signal, options)
      : ds.streamDeepSeekLive(deepseekKey, req, upstream.signal, options);
  };

  const requested = effectiveBrain(data.brain);
  const otherBrain = other(requested);
  /**
   * Who goes first, and with how many attempts.
   *
   * A writer that just refused a request is skipped when the other writer can answer, so
   * a degraded Sona selection does not pay the same failure for every sentence. The writer
   * that starts gets one attempt only when a *usable* fallback waits behind it — fail over
   * now, not after a clamped Retry-After. The last usable writer keeps the bounded retry,
   * so a transient DeepSeek failure is still healed instead of being replaced by a known
   * failing writer. A cooling writer never gets the retry.
   */
  let first = requested;
  let second: BrainId | null = configured[otherBrain] ? otherBrain : null;
  /** Why the writer is not the requested one; null when the requested brain answered. */
  let fallbackReason: string | null = null;
  if (providerCooling(requested) && configured[otherBrain] && !providerCooling(otherBrain)) {
    first = otherBrain;
    second = requested;
    fallbackReason = "cooldown";
  }
  const firstOptions =
    providerCooling(first) || (second !== null && !providerCooling(second))
      ? { maxAttempts: 1 }
      : undefined;

  let brain: BrainId = first;
  let deltas: AsyncGenerator<string>;
  let upstreamMs = 0;
  try {
    try {
      deltas = await streamFrom(first, firstOptions);
    } catch (err) {
      // The other brain takes over when the chosen one is down, out of credit or rate
      // limited. A cancellation is never replayed.
      if (request.signal.aborted || !shouldFallBack(err)) throw err;
      const kind = err instanceof TranslationError ? err.kind : "provider";
      noteProviderFailure(first, kind);
      if (!second) throw err;
      if (first === requested) fallbackReason = kind;
      // The fallback is the last usable writer, so it keeps the bounded retry unless it
      // is itself cooling. Its own failure is recorded as well.
      const secondOptions = providerCooling(second) ? { maxAttempts: 1 } : undefined;
      try {
        deltas = await streamFrom(second, secondOptions);
      } catch (fallbackErr) {
        if (request.signal.aborted || !shouldFallBack(fallbackErr)) throw fallbackErr;
        const fallbackKind =
          fallbackErr instanceof TranslationError ? fallbackErr.kind : "provider";
        noteProviderFailure(second, fallbackKind);
        throw fallbackErr;
      }
      brain = second;
    }
    upstreamMs = Date.now() - started;
    noteProviderSuccess(brain);
    // The requested writer answered after all (for example after a cooldown skip).
    if (brain === requested) fallbackReason = null;
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
        // Privacy: metrics only — never the text. `upstreamMs` separates provider time
        // from the total, and `fallback` names the failure class that caused a rescue.
        console.info(
          JSON.stringify({
            event: "translate_stream",
            mode: data.mode,
            brain,
            requested,
            fallback: fallbackReason,
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
      // The brain that actually wrote it (after any fallback), so the quiet review is
      // never sent as if the requested model had written a rescued answer.
      "X-Translation-Writer": brain,
      // Diagnostic only, content-free: the requested writer answered unless a failure
      // class (or a short cooldown) made the other brain take over.
      ...(fallbackReason ? { "X-Translation-Fallback": fallbackReason } : {}),
    },
  });
}
