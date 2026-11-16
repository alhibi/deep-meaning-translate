/** Bound actual incoming bytes, including chunked bodies without Content-Length. */
export async function boundedJson(request: Request, maxBytes = 96 * 1024): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("input");
  if (!request.body) throw new Error("input");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("input");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse the bounded body before spending admission. Invalid or oversized input must not
 * drain a client's budget, and a spent budget must not hide an input error behind a 429.
 */
export async function parseAdmittedJson<T>(
  request: Request,
  schema: { parse(value: unknown): T },
  take: (data: T) => boolean,
): Promise<{ ok: true; data: T } | { ok: false; kind: "input" | "rate" }> {
  let data: T;
  try {
    data = schema.parse(await boundedJson(request));
  } catch {
    return { ok: false, kind: "input" };
  }
  // The parsed body picks its purpose-specific budget (live vs settled translation).
  if (!take(data)) return { ok: false, kind: "rate" };
  return { ok: true, data };
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return (
    (!origin || origin === new URL(request.url).origin) &&
    request.headers.get("Sec-Fetch-Site") !== "cross-site"
  );
}

/** Proxy-provided identity only; never keep translation text in admission state. */
export function clientAddress(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Real-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unidentified"
  );
}
