import { isNativeApp, nativeApiUrl } from "./config";

export type NativeErrorKind =
  "auth" | "quota" | "rate" | "network" | "offline" | "timeout" | "provider" | "input";

export class NativeTransportError extends Error {
  constructor(readonly kind: NativeErrorKind) {
    super(kind);
    this.name = "NativeTransportError";
  }
}

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

/**
 * One outbound call for the installed app: absolute URL, no cookies (the app has no
 * account), a bounded wait, and a failure classified into the product's existing error
 * kinds so the UI keeps its calm messages. The response body is returned untouched for
 * streaming callers.
 */
export async function nativeRequest(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  if (!isNativeApp()) throw new NativeTransportError("offline");
  const url = nativeApiUrl(path);
  if (!url) throw new NativeTransportError("network");
  const { timeoutMs = 90_000, ...rest } = init;
  const signal = rest.signal ?? timeoutSignal(timeoutMs);
  try {
    const request: RequestInit = {
      ...rest,
      credentials: "omit",
      cache: "no-store",
      // The server answers with an exact allowlist; this header is what it checks.
      mode: "cors",
    };
    if (signal) request.signal = signal;
    const res = await fetch(url, request);
    return res;
  } catch (err) {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw new NativeTransportError("offline");
    const name = (err as Error)?.name;
    throw new NativeTransportError(
      name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    );
  }
}

/** Same-origin JSON through the Android network stack when WebView fetch is blocked. */
async function nativeJsonViaHttp<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const { CapacitorHttp } = await import("@capacitor/core");
  const res = await CapacitorHttp.post({
    url,
    headers: { "Content-Type": "application/json" },
    data: body,
    responseType: "json",
    connectTimeout: Math.min(timeoutMs, 20_000),
    readTimeout: timeoutMs,
  });
  if (res.status < 200 || res.status >= 300) {
    const payload = res.data as { kind?: NativeErrorKind } | null;
    throw new NativeTransportError(payload?.kind ?? (res.status === 429 ? "rate" : "provider"));
  }
  return res.data as T;
}

export async function nativeJson<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  try {
    const res = await nativeRequest(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs,
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { kind?: NativeErrorKind } | null;
      throw new NativeTransportError(payload?.kind ?? (res.status === 429 ? "rate" : "provider"));
    }
    return (await res.json()) as T;
  } catch (error) {
    const kind = error instanceof NativeTransportError ? error.kind : "network";
    if (kind !== "network" && kind !== "timeout") throw error;
    const url = nativeApiUrl(path);
    if (!url) throw error;
    // WebView fetch can be blocked while the Android stack is not: retry once natively.
    try {
      return await nativeJsonViaHttp<T>(url, body, timeoutMs);
    } catch {
      throw error;
    }
  }
}
