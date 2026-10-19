import { MAX_SPEAK_CHARS, pcmToWav, type SpeakErrorKind, type SpeakRequest } from "./geminiVoice";

/**
 * Browser side of Gemini speech: fetches WAV clips from /api/speak, keeps a small
 * in-memory cache (never written to disk, gone when the app closes), shares in-flight
 * requests so double taps never pay twice, and pauses itself after quota/config errors.
 */

export class ClipCache {
  private map = new Map<string, Blob>();
  private bytes = 0;
  constructor(
    private maxItems = 40,
    private maxBytes = 12 * 1024 * 1024,
  ) {}
  get(k: string) {
    const b = this.map.get(k);
    if (b) {
      this.map.delete(k);
      this.map.set(k, b); // most recently used last
    }
    return b;
  }
  set(k: string, b: Blob) {
    if (b.size > this.maxBytes) return;
    const old = this.map.get(k);
    if (old) {
      this.bytes -= old.size;
      this.map.delete(k);
    }
    this.map.set(k, b);
    this.bytes += b.size;
    while (this.map.size > this.maxItems || this.bytes > this.maxBytes) {
      const first = this.map.keys().next().value as string;
      this.bytes -= this.map.get(first)!.size;
      this.map.delete(first);
    }
  }
  get size() {
    return this.map.size;
  }
  get totalBytes() {
    return this.bytes;
  }
}

export class CloudSpeakError extends Error {
  constructor(
    public kind: SpeakErrorKind | "offline",
    public retryAfter = 0,
  ) {
    super(kind);
  }
}

const cache = new ClipCache();
const inflight = new Map<string, Promise<Blob>>();
let pausedUntil = 0;

export const clipKey = (r: SpeakRequest) =>
  [r.quality, r.voice, r.pace, r.lang, r.text].join("\u0001");

/** Whether Gemini should be tried right now (not paused by quota/config, online). */
export function cloudAvailable() {
  return (
    Date.now() >= pausedUntil && (typeof navigator === "undefined" || navigator.onLine !== false)
  );
}

export function fetchClip(r: SpeakRequest): Promise<Blob> {
  const key = clipKey(r);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return Promise.reject(new CloudSpeakError("offline"));
  const p = (async () => {
    let res: Response;
    try {
      res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r),
        signal: AbortSignal.timeout(50_000),
      });
    } catch (e) {
      throw new CloudSpeakError((e as Error)?.name === "TimeoutError" ? "timeout" : "offline");
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { kind?: SpeakErrorKind } | null;
      const kind = body?.kind ?? "provider";
      const retry = Number(res.headers.get("Retry-After")) || 0;
      // Circuit breaker: never hammer Google after quota or key problems.
      if (kind === "quota") pausedUntil = Date.now() + Math.max(60, retry) * 1000;
      if (kind === "config") pausedUntil = Date.now() + 10 * 60_000;
      throw new CloudSpeakError(kind, retry);
    }
    const blob = await res.blob();
    if (blob.size < 64) throw new CloudSpeakError("provider");
    cache.set(key, blob);
    return blob;
  })();
  inflight.set(key, p);
  p.then(
    () => inflight.delete(key),
    () => inflight.delete(key),
  );
  return p;
}

/** Ordered pieces under the server limit, split at sentence ends; the first is short for a fast start. */
export function speechPieces(
  text: string,
  chunk: (t: string, max: number) => { text: string; offset: number }[],
) {
  const first = chunk(text, 220)[0];
  if (!first) return [];
  const restStart = first.offset + first.text.length;
  const rest = chunk(text.slice(restStart), Math.min(420, MAX_SPEAK_CHARS)).map((c) => ({
    text: c.text,
    offset: c.offset + restStart,
  }));
  return [first, ...rest];
}

let silentUrl: string | null = null;
/** A tiny silent clip played inside the tap so iOS/Android allow the later real playback. */
export function silentClip() {
  if (!silentUrl && typeof URL !== "undefined") {
    silentUrl = URL.createObjectURL(
      new Blob([pcmToWav(new Uint8Array(480))], { type: "audio/wav" }),
    );
  }
  return silentUrl ?? "";
}

export const _cache = cache;
