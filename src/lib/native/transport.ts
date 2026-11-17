import { isNativeApp, nativeApiUrl } from "./config";
import { beginTransport, classifyFetchError, safeDiagnosticMessage } from "./diagnostics";

export type NativeErrorKind =
  "auth" | "quota" | "rate" | "network" | "offline" | "timeout" | "provider" | "input";

export class NativeTransportError extends Error {
  constructor(readonly kind: NativeErrorKind) {
    super(kind);
    this.name = "NativeTransportError";
  }
}

/** The caller's own AbortSignal went off: a quiet cancellation, not a retryable failure. */
export function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

export const isAbortError = (error: unknown): boolean => (error as Error)?.name === "AbortError";

/**
 * AbortSignal.timeout is Chrome 103+. The app supports WebViews far older than that, and
 * on those an undefined static method made every request throw before it was sent, which
 * looked like "translation does not work". Use the same abort semantics with a manual
 * timer when the helper is missing.
 */
function timeoutSignal(ms: number): AbortSignal | undefined {
  const timeout = (AbortSignal as unknown as { timeout?: (value: number) => AbortSignal }).timeout;
  if (typeof timeout === "function") return timeout.call(AbortSignal, ms);
  if (typeof AbortController === "undefined") return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

export interface AbortGuard {
  /** The composed signal to hand to fetch. */
  signal: AbortSignal;
  /** The transport's own deadline fired (as opposed to the caller cancelling). */
  timedOut: () => boolean;
  /** Release the timer and the caller's listener; the request is finished. */
  dispose: () => void;
}

/**
 * One composed cancellation source: the caller's signal and the transport deadline.
 *
 * They must be distinguishable: a caller abort is a quiet supersession that is never
 * retried, while the transport deadline is the "timeout" the UI reports. The guard owns
 * the timer and the listener, so a finished request leaves neither behind.
 */
export function withAbortTimeout(caller: AbortSignal | undefined, timeoutMs: number): AbortGuard {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (caller) {
    if (caller.aborted) controller.abort();
    else caller.addEventListener("abort", onCallerAbort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
  };
}

/**
 * One outbound call for the installed app: absolute URL, no cookies (the app has no
 * account), a bounded wait, and a failure classified into the product's existing error
 * kinds so the UI keeps its calm messages. The response body is returned untouched for
 * streaming callers.
 *
 * A caller-provided signal owns the deadline (the caller composes it), so a cancellation
 * reaches fetch and aborts the request instead of being reported as a timeout.
 */
export async function nativeRequest(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  if (!isNativeApp()) throw new NativeTransportError("offline");
  const url = nativeApiUrl(path);
  if (!url) throw new NativeTransportError("network");
  const { timeoutMs = 90_000, signal, ...rest } = init;
  if (signal?.aborted) throw abortError();
  const effective = signal ?? timeoutSignal(timeoutMs);
  try {
    const request: RequestInit = {
      ...rest,
      credentials: "omit",
      cache: "no-store",
      // The server answers with an exact allowlist; this header is what it checks.
      mode: "cors",
    };
    if (effective) request.signal = effective;
    const res = await fetch(url, request);
    return res;
  } catch (err) {
    // The caller cancelled: cancel the fetch (above) and report the reason as a
    // cancellation. It is never a "network failure" the UI could retry.
    if (signal?.aborted) throw abortError();
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw new NativeTransportError("offline");
    const name = (err as Error)?.name;
    throw new NativeTransportError(
      name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    );
  }
}

/** Same-origin JSON through the Android network stack when WebView fetch is blocked. */
async function nativeJsonViaHttp<T>(
  url: string,
  body: unknown,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  const { CapacitorHttp } = await import("@capacitor/core");
  // CapacitorHttp cannot cancel an in-flight call; do not start one for a request whose
  // caller already walked away, and discard what comes back if it left meanwhile.
  if (signal?.aborted) throw abortError();
  const res = await CapacitorHttp.post({
    url,
    headers: {
      "Content-Type": "application/json",
      // CapacitorHttp does not add the WebView Origin automatically. The native gate
      // requires it, and without this the fallback would receive its own 403.
      Origin: "https://localhost",
    },
    data: body,
    responseType: "json",
    connectTimeout: Math.min(timeoutMs, 20_000),
    readTimeout: timeoutMs,
  });
  if (signal?.aborted) throw abortError();
  if (res.status < 200 || res.status >= 300) {
    const payload = res.data as { kind?: NativeErrorKind } | null;
    throw new NativeTransportError(payload?.kind ?? (res.status === 429 ? "rate" : "provider"));
  }
  return res.data as T;
}

function classifyStatusSafe(status: number) {
  if (status === 401) return "http-401" as const;
  if (status === 403) return "http-403" as const;
  if (status === 404) return "http-404" as const;
  if (status === 429) return "http-429" as const;
  if (status >= 500) return "http-5xx" as const;
  if (status >= 400) return "http-other" as const;
  return "provider" as const;
}

/**
 * Read a response body while honouring cancellation, with the same discipline as the
 * translation stream: a caller abort cancels the active reader, so a WebView/mocked
 * transport that leaves `read()` pending cannot keep a dead request alive. The reader is
 * always released. Falls back to `res.json()` only for a body-less response.
 */
async function readJsonBody<T>(
  res: Response,
  signal: AbortSignal,
  cancelled: () => boolean,
): Promise<T> {
  if (!res.body) return (await res.json()) as T;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const stopReading = () => {
    void reader.cancel().catch(() => {});
  };
  let text = "";
  signal.addEventListener("abort", stopReading, { once: true });
  try {
    if (signal.aborted) stopReading();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    signal.removeEventListener("abort", stopReading);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (cancelled()) throw abortError();
  return JSON.parse(text) as T;
}

/**
 * One JSON call for the installed app. The optional signal is composed with the timeout
 * and wins over it: a caller abort cancels the fetch and its body reader, and it is never
 * turned into a retry (including the CapacitorHttp fallback, which would otherwise spend
 * a second request for an answer nobody wants).
 */
export async function nativeJson<T>(
  path: string,
  body: unknown,
  timeoutMs = 30_000,
  signal?: AbortSignal | undefined,
): Promise<T> {
  if (signal?.aborted) throw abortError();
  const url = nativeApiUrl(path);
  const guard = withAbortTimeout(signal, timeoutMs);
  const diagnostics = url
    ? beginTransport({ transport: "server-json", method: "POST", url })
    : null;
  const cancelled = () => signal?.aborted === true;
  try {
    const res = await nativeRequest(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: guard.signal,
    });
    if (cancelled()) {
      // The response arrived after the caller left: release it instead of parsing it.
      void res.body?.cancel().catch(() => {});
      throw abortError();
    }
    if (!res.ok) {
      let payload: { kind?: NativeErrorKind } | null = null;
      try {
        payload = await readJsonBody<{ kind?: NativeErrorKind }>(res, guard.signal, cancelled);
      } catch (error) {
        // A caller abort wins over the error body; an unparsable body keeps the status kind.
        if (cancelled() || isAbortError(error)) throw error;
      }
      diagnostics?.finish({
        stage: "error",
        status: res.status,
        contentType: res.headers.get("content-type") ?? undefined,
        kind: classifyStatusSafe(res.status),
      });
      if (cancelled()) throw abortError();
      throw new NativeTransportError(payload?.kind ?? (res.status === 429 ? "rate" : "provider"));
    }
    const parsed = await readJsonBody<T>(res, guard.signal, cancelled);
    if (cancelled()) throw abortError();
    diagnostics?.finish({
      stage: "done",
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
    });
    return parsed;
  } catch (error) {
    // A caller cancellation is not a transport verdict: report it as cancellation and
    // never fall back to the buffered Android transport. The composed signal also aborts
    // on our own deadline, so the caller's flag is checked before the timed-out flag.
    if (cancelled()) {
      diagnostics?.finish({ stage: "error", kind: "abort", cancelled: true });
      throw abortError();
    }
    if (guard.timedOut()) {
      diagnostics?.finish({
        stage: "error",
        kind: "timeout",
        errorName: (error as Error)?.name,
        errorMessage: safeDiagnosticMessage((error as Error)?.message),
      });
      const timedOut = new NativeTransportError("timeout");
      // Keep the existing availability rule: a WebView fetch deadline may be a WebView
      // problem, so the buffered Android stack gets one try. The aborted fetch above is
      // already released, so this cannot leave two live requests behind.
      if (!url) throw timedOut;
      try {
        const parsed = await nativeJsonViaHttp<T>(url, body, timeoutMs, signal);
        diagnostics?.finish({ stage: "done", transport: "capacitor-http" });
        return parsed;
      } catch (nativeError) {
        if (cancelled()) {
          diagnostics?.finish({
            stage: "error",
            transport: "capacitor-http",
            kind: "abort",
            cancelled: true,
          });
          throw abortError();
        }
        void nativeError;
        throw timedOut;
      }
    }
    if (isAbortError(error)) {
      diagnostics?.finish({ stage: "error", kind: "abort", cancelled: true });
      throw abortError();
    }
    const kind = error instanceof NativeTransportError ? error.kind : "network";
    if (kind !== "network" && kind !== "timeout") {
      diagnostics?.finish({
        stage: "error",
        kind:
          kind === "offline"
            ? "offline"
            : kind === "auth"
              ? "auth"
              : kind === "quota"
                ? "quota"
                : kind === "rate"
                  ? "rate"
                  : kind === "input"
                    ? "input"
                    : "provider",
        errorName: (error as Error)?.name,
        errorMessage: safeDiagnosticMessage((error as Error)?.message),
      });
      throw error;
    }
    if (!url) throw error;
    // WebView fetch can be blocked while the Android stack is not: retry once natively.
    try {
      const parsed = await nativeJsonViaHttp<T>(url, body, timeoutMs, signal);
      diagnostics?.finish({ stage: "done", transport: "capacitor-http" });
      return parsed;
    } catch (nativeError) {
      if (cancelled()) {
        diagnostics?.finish({
          stage: "error",
          transport: "capacitor-http",
          kind: "abort",
          cancelled: true,
        });
        throw abortError();
      }
      diagnostics?.finish({
        stage: "error",
        transport: "capacitor-http",
        kind: classifyFetchError(nativeError),
        errorName: (nativeError as Error)?.name,
        errorMessage: safeDiagnosticMessage((nativeError as Error)?.message),
      });
      throw error;
    }
  } finally {
    guard.dispose();
  }
}
