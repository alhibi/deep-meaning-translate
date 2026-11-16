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
  const signal = rest.signal ?? AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      signal,
      credentials: "omit",
      cache: "no-store",
      // The server answers with an exact allowlist; this header is what it checks.
      mode: "cors",
    });
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

export async function nativeJson<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
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
}
