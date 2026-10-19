import { MAX_SPEAK_CHARS, type SpeakErrorKind, type SpeakRequest } from "./geminiVoice";
import { elevenParser, type ElevenRequest, type CharTiming } from "./elevenVoice";
export type CloudRequest = SpeakRequest | ElevenRequest;
const isEleven = (r: CloudRequest): r is ElevenRequest =>
  "engine" in r && r.engine === "elevenlabs";

/**
 * Browser side of cloud speech: fetches streamed PCM and keeps a small
 * in-memory cache (never written to disk, gone when the app closes), streams each piece
 * so playback starts early, and pauses itself after quota/config errors.
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
      this.bytes -= this.map.get(first)?.size ?? 0;
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
const pausedUntil = { gemini: 0, elevenlabs: 0 };
const alignments = new WeakMap<Blob, CharTiming[]>();

export const clipKey = (r: CloudRequest) =>
  [isEleven(r) ? "elevenlabs" : "gemini", r.quality, r.voice, r.pace, r.lang, r.text].join(
    "\u0001",
  );

/** Provider-local circuit breaker; one provider's quota never disables the other. */
export function cloudAvailable(engine: "gemini" | "elevenlabs" = "gemini") {
  return (
    Date.now() >= pausedUntil[engine] &&
    (typeof navigator === "undefined" || navigator.onLine !== false)
  );
}

/**
 * A piece's audio as it streams in. Consumers read chunks in order with `next()`;
 * a cached piece arrives as one chunk instantly. Finished pieces enter the memory cache.
 */
export class Feed {
  chunks: Uint8Array[] = [];
  done = false;
  error: CloudSpeakError | null = null;
  timing: CharTiming[] = [];
  private waiters: (() => void)[] = [];
  private wake() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
  private ctrl = new AbortController();
  constructor(private r: CloudRequest) {}

  start() {
    const key = clipKey(this.r);
    const hit = cache.get(key);
    if (hit) {
      this.timing = alignments.get(hit) ?? [];
      void hit.arrayBuffer().then((b) => {
        this.chunks.push(new Uint8Array(b));
        this.end();
      });
      return this;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.fail(new CloudSpeakError("offline"));
      return this;
    }
    // No first audio within 15 s → give up so the device voice can take over.
    const firstByte = setTimeout(() => this.ctrl.abort("timeout"), 15_000);
    void (async () => {
      let res: Response;
      try {
        res = await fetch(isEleven(this.r) ? "/api/eleven-speak" : "/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.r),
          signal: this.ctrl.signal,
        });
      } catch {
        clearTimeout(firstByte);
        this.fail(
          new CloudSpeakError(this.ctrl.signal.reason === "timeout" ? "timeout" : "offline"),
        );
        return;
      }
      if (!res.ok || !res.body) {
        clearTimeout(firstByte);
        const body = (await res.json().catch(() => null)) as { kind?: SpeakErrorKind } | null;
        const kind = body?.kind ?? "provider";
        const retry = Number(res.headers.get("Retry-After")) || 0;
        // Circuit breaker: never hammer Google after quota or key problems.
        const engine = isEleven(this.r) ? "elevenlabs" : "gemini";
        if (kind === "quota") pausedUntil[engine] = Date.now() + Math.max(60, retry) * 1000;
        if (kind === "config") pausedUntil[engine] = Date.now() + 10 * 60_000;
        this.fail(new CloudSpeakError(kind, retry));
        return;
      }
      const reader = res.body.getReader();
      const parse = isEleven(this.r) ? elevenParser() : null;
      const decoder = new TextDecoder();
      const accept = (value: Uint8Array, final = false) => {
        if (parse) {
          for (const p of parse(decoder.decode(value, { stream: !final }), final)) {
            this.timing.push(...p.timing);
            if (p.audio.length) this.chunks.push(p.audio);
          }
        } else if (value.length) this.chunks.push(value);
        if (this.chunks.length) clearTimeout(firstByte);
        this.wake();
      };
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            accept(new Uint8Array(), true);
            break;
          }
          if (value?.length) {
            accept(value);
          }
        }
      } catch (e) {
        const kind =
          this.ctrl.signal.reason === "timeout"
            ? "timeout"
            : e instanceof TypeError
              ? "network"
              : "provider";
        this.ctrl.abort("provider");
        void reader.cancel().catch(() => {});
        clearTimeout(firstByte);
        this.fail(new CloudSpeakError(kind));
        return;
      }
      clearTimeout(firstByte);
      const bytes = this.chunks.reduce((n, c) => n + c.length, 0);
      if (bytes < 64) {
        this.fail(new CloudSpeakError("provider"));
        return;
      }
      const blob = new Blob(this.chunks as BlobPart[], { type: "audio/l16" });
      alignments.set(blob, this.timing);
      cache.set(key, blob);
      this.end();
    })();
    return this;
  }
  /** Waits for the chunk at index i; null when the piece has ended. Throws on failure. */
  async next(i: number): Promise<Uint8Array | null> {
    for (;;) {
      const chunk = this.chunks[i];
      if (chunk) return chunk;
      if (this.error) throw this.error;
      if (this.done) return null;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }
  abort() {
    this.ctrl.abort("stop");
  }
  private end() {
    this.done = true;
    this.wake();
  }
  private fail(e: CloudSpeakError) {
    if (this.error || this.done) return;
    this.error = e;
    this.wake();
  }
}

const live = new Map<string, Feed>();
/**
 * One feed per clip: a tap while the clip is still being prepared in the background joins
 * that stream instead of asking Google again. Finished clips come from the memory cache.
 */
export function getFeed(r: CloudRequest): Feed {
  const key = clipKey(r);
  const running = live.get(key);
  if (running && !running.error) return running;
  const f = new Feed(r).start();
  if (!f.done) {
    live.set(key, f);
    const remove = () => {
      if (live.get(key) === f) live.delete(key);
    };
    void f.next(Number.MAX_SAFE_INTEGER).then(remove, remove);
  }
  return f;
}

let warmed = false;
/** Open the connection path to Google once, before the first Listen tap. Free. */
export function warmVoice() {
  if (warmed || typeof window === "undefined" || !cloudAvailable()) return;
  warmed = true;
  void fetch("/api/speak", { method: "GET" }).catch(() => undefined);
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
  // Input schemas trim requests: keep the visible offset in sync with that exact text.
  return [first, ...rest].map((p) => ({
    text: p.text.trim(),
    offset: p.offset + p.text.length - p.text.trimStart().length,
  })).filter((p) => p.text.length > 0);
}

export const _cache = cache;
