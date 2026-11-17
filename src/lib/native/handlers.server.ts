/**
 * The versioned server surface for the installed Android app.
 *
 * Each handler reuses the web route's schema, admission budget and domain function —
 * the prompts and translation engine exist once. What differs is the transport: the app
 * runs from a local origin, so authorization is an exact origin allowlist
 * (`gate.server.ts`) instead of the browser's same-origin check.
 *
 * Cancellation: the runtime wires `Request.signal` to the client connection (the Node
 * adapter aborts it when the response stream closes early; Cloudflare aborts it when the
 * client disappears). Every handler checks it before spending a token or a provider call
 * and answers a quiet 204 when the work it produced is no longer wanted, which is the
 * same quiet-cancellation contract the streaming route uses. The upstream provider call
 * itself is aborted where the domain function accepts a signal (see the `signal` plumbing
 * in engine.server.ts / lexicon.functions.ts / shadow.functions.ts).
 */
import { z } from "zod";
import { InputSchema } from "../translation/translate.functions";
import { analyzeLexiconFor, LexiconInput } from "../translation/lexicon.functions";
import { analyzeShadowFor, ShadowInput } from "../translation/shadow.functions";
import { isResult } from "../translation/result";
import type { TranslationResult } from "../translation/types";
import { takeDictationToken, takeRepairToken } from "../translation/throttle";
import { boundedJson, clientAddress, parseAdmittedJson } from "../requestSafety";

const noStore = { "Cache-Control": "no-store" };

/**
 * One composed cancellation source for an outbound provider call: the caller's own
 * disconnection and this handler's deadline. The same rule the app transport uses, kept
 * local so a server handler never imports the client transport module.
 */
function abortGuard(
  caller: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (caller.aborted) controller.abort();
  else caller.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      caller.removeEventListener("abort", onAbort);
    },
  };
}

/** The caller left: answer the established quiet-cancellation status and spend nothing. */
const quietCancel = () => new Response(null, { status: 204, headers: noStore });

/** Nobody will read this request body; release it instead of buffering it for a ghost. */
function discardBody(request: Request): void {
  void request.body?.cancel().catch(() => {});
}

const badRequest = (kind = "input") =>
  Response.json({ ok: false, kind }, { status: 400, headers: noStore });

const quietNull = () => Response.json({ ok: true, result: null }, { headers: noStore });

/** The quiet second pass takes the same schema as the web server function. */
const RepairInput = z.object({
  request: InputSchema,
  previous: z.custom<TranslationResult>((value) => isResult(value), {
    message: "Invalid translation result.",
  }),
});

export async function nativeRepair(request: Request): Promise<Response> {
  // Cancelled before the body is even parsed: a stale review must not cost a byte.
  if (request.signal.aborted) {
    discardBody(request);
    return quietCancel();
  }
  // Bounded before the schema and before the repair budget: an oversized body must be a
  // 400 that spends nothing, not a fully buffered JSON.parse (A5-01).
  const admitted = await parseAdmittedJson(request, RepairInput, () =>
    takeRepairToken(clientAddress(request)),
  );
  if (!admitted.ok) return admitted.kind === "rate" ? quietNull() : badRequest();
  if (request.signal.aborted) return quietCancel();
  const data = admitted.data;
  const { runRepair } = await import("../translation/engine.server");
  const started = Date.now();
  const result = await runRepair(data.request, data.previous).catch(() => null);
  // The caller disconnected while the review was running: its result is not wanted and
  // must not be logged as a completed round trip either.
  if (request.signal.aborted) return quietCancel();
  // Metrics only, never the text.
  console.info(
    JSON.stringify({
      event: "repair",
      surface: "native",
      outcome: result ? "improved" : "kept",
      ms: Date.now() - started,
    }),
  );
  return Response.json({ ok: true, result }, { headers: noStore });
}

export async function nativeLexicon(request: Request): Promise<Response> {
  if (request.signal.aborted) {
    discardBody(request);
    return quietCancel();
  }
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch {
    return badRequest();
  }
  const parsed = LexiconInput.safeParse(body);
  if (!parsed.success) return badRequest();
  if (request.signal.aborted) return quietCancel();
  // Reuse the one domain path: cheap candidate gate, enrichment admission, provider-agnostic
  // analysis and request-context echo stay identical to the web surface. This transport was
  // already authorized by its exact origin allowlist, so the second same-origin check is skipped.
  const lexicon = await analyzeLexiconFor(parsed.data, { request, crossOrigin: true });
  if (request.signal.aborted) return quietCancel();
  return Response.json({ ok: true, lexicon }, { headers: noStore });
}

export async function nativeShadow(request: Request): Promise<Response> {
  if (request.signal.aborted) {
    discardBody(request);
    return quietCancel();
  }
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch {
    return badRequest();
  }
  const parsed = ShadowInput.safeParse(body);
  if (!parsed.success) return badRequest();
  if (request.signal.aborted) return quietCancel();
  // Reuse the one domain path: windowing, enrichment admission and the provider-agnostic
  // analysis call stay identical to the web surface. This transport was already authorized
  // by its exact origin allowlist, so the second same-origin check is skipped.
  const shadow = await analyzeShadowFor(parsed.data, { request, crossOrigin: true });
  if (request.signal.aborted) return quietCancel();
  return Response.json({ shadow }, { headers: noStore });
}

/** Issues a short-lived AssemblyAI token. The permanent key never leaves the server. */
export async function nativeDictation(request: Request): Promise<Response> {
  if (request.signal.aborted) {
    discardBody(request);
    return quietCancel();
  }
  if (!takeDictationToken(clientAddress(request)))
    return Response.json(
      {
        ok: false,
        status: 429,
        message: "Too many dictation sessions. Wait a moment and try again.",
      },
      { status: 429, headers: noStore },
    );
  const key = process.env["ASSEMBLYAI_API_KEY"];
  if (!key)
    return Response.json(
      { ok: false, status: 503, message: "AssemblyAI is not configured." },
      { status: 503, headers: noStore },
    );
  // The transport deadline and the caller's own cancellation are one signal: a
  // disconnecting client aborts the outbound provider request instead of leaving it
  // running to its timeout for a screen that is gone.
  const guard = abortGuard(request.signal, 15_000);
  try {
    const response = await fetch(
      "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60",
      {
        headers: { Authorization: key },
        signal: guard.signal,
      },
    );
    if (request.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      return quietCancel();
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      console.warn("[native:assembly] provider status", response.status);
      return Response.json(
        { ok: false, status: response.status, message: "AssemblyAI is unavailable right now." },
        { status: 502, headers: noStore },
      );
    }
    const data: unknown = await response.json();
    if (request.signal.aborted) return quietCancel();
    if (!data || typeof data !== "object" || !("token" in data) || typeof data.token !== "string")
      return Response.json(
        { ok: false, status: 502, message: "AssemblyAI returned an invalid session." },
        { status: 502, headers: noStore },
      );
    return Response.json({ ok: true, token: data.token }, { headers: noStore });
  } catch {
    // A caller that left is not an error to report; a real failure keeps the calm shape.
    if (request.signal.aborted) return quietCancel();
    return Response.json(
      { ok: false, status: 502, message: "Could not connect to AssemblyAI." },
      { status: 502, headers: noStore },
    );
  } finally {
    guard.dispose();
  }
}
