import type { ErrorKind } from "./useTranslator";

export type StreamResponse = { ok: true; text: string } | { ok: false; kind: ErrorKind };

/** Client side of the live stream: calls onText with the accumulated translation as it grows. */
export async function streamTranslate(
  data: Record<string, unknown>,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<StreamResponse> {
  const res = await fetch("/api/translate-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal,
  });
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
    if (text.trim()) onText(text.trim());
  }
  text = (text + dec.decode()).trim();
  return text ? { ok: true, text } : { ok: false, kind: "provider" };
}
