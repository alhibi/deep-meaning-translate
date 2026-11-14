import type { ErrorKind } from "./useTranslator";
import { partialTranslation } from "./parse";

export type StreamResponse =
  { ok: true; text: string } | { ok: false; kind: ErrorKind; cancelled?: true };

/** Client side of the live stream: calls onText with the accumulated translation as it grows. */
export async function streamTranslate(
  data: Record<string, unknown>,
  signal: AbortSignal,
  onText: (text: string) => void,
  mode: "live" | "full" = "live",
): Promise<StreamResponse> {
  const res = await fetch("/api/translate-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, mode }),
    signal,
  });
  // The route answers 204 when the request was aborted upstream: a quiet cancellation,
  // not a provider failure. It carries no body, so it must never be read as JSON.
  if (res.status === 204) return { ok: false, kind: "provider", cancelled: true };
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => null)) as { kind?: ErrorKind } | null;
    return { ok: false, kind: j?.kind ?? (res.status === 429 ? "rate" : "provider") };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    const visible = mode === "full" ? partialTranslation(text) : text;
    if (visible.trim()) onText(visible.trim());
  }
  text = (text + dec.decode()).trim();
  return text ? { ok: true, text } : { ok: false, kind: "provider" };
}

/** Fire-and-forget: opens the connection chain to the translation service before the first request. */
export function warmTranslation(): void {
  if (typeof fetch === "undefined") return;
  void fetch("/api/translate-stream", { method: "GET", cache: "no-store" }).catch(() => {});
}
