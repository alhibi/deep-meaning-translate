import { pcm16ToFloat } from "./geminiVoice";

const RATE = 24000;
let shared: AudioContext | null = null;

/**
 * Must be called inside the tap: creates/resumes the audio context and plays one silent
 * sample so mobile browsers allow the streamed audio that arrives seconds later.
 */
export function unlockAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    shared ??= new Ctx({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  if (shared.state !== "running") void shared.resume().catch(() => undefined);
  const b = shared.createBuffer(1, 1, RATE);
  const s = shared.createBufferSource();
  s.buffer = b;
  s.connect(shared.destination);
  s.start();
  return shared;
}

/**
 * Gapless player for streamed PCM. Chunks are scheduled back to back on the audio clock;
 * playback begins once a small cushion is buffered so network jitter never stutters it.
 * A tiny fade-in on the first chunk avoids a click.
 */
export class PcmPlayer {
  private carry: number[] = [];
  private pending: AudioBuffer[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private startAt = 0;
  private nextAt = 0;
  private segments: { at: number; offset: number; duration: number }[] = [];
  private queued = 0; // seconds of audio on the timeline
  private started = false;
  private stopped = false;
  onStart?: () => void;
  constructor(
    private ctx: AudioContext,
    private cushion = 0.35,
  ) {}

  /** Seconds of audio pushed so far (the timeline position where the next chunk lands). */
  get queuedSeconds() {
    return this.queued + this.pending.reduce((a, b) => a + b.duration, 0);
  }
  /** Current playback position on the timeline, in seconds. */
  get position() {
    const now = this.audibleTime;
    let position = 0;
    for (const segment of this.segments) {
      if (now < segment.at) break;
      position = segment.offset + Math.min(segment.duration, now - segment.at);
    }
    return Math.min(this.queued, position);
  }

  private get audibleTime() {
    const stamp = this.ctx.getOutputTimestamp?.();
    const contextTime = stamp?.contextTime ?? 0;
    const performanceTime = stamp?.performanceTime ?? 0;
    if (contextTime > 0 && performanceTime > 0) {
      return Math.min(this.ctx.currentTime, contextTime + Math.max(0, performance.now() - performanceTime) / 1000);
    }
    return this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
  }

  get audible() {
    return this.started && this.audibleTime >= this.startAt;
  }

  push(bytes: Uint8Array) {
    if (this.stopped || !bytes.length) return;
    const f = pcm16ToFloat(bytes, this.carry);
    if (!f.length) return;
    const buf = this.ctx.createBuffer(1, f.length, RATE);
    buf.copyToChannel(f as Float32Array<ArrayBuffer>, 0);
    if (!this.started) {
      this.pending.push(buf);
      if (this.queuedSeconds >= this.cushion) this.begin();
      return;
    }
    this.schedule(buf);
  }

  /** Stream ended: start even if the cushion was never reached; resolves when audio finishes. */
  finish(): Promise<void> {
    if (!this.started && this.pending.length) this.begin();
    return new Promise((resolve) => {
      const check = () => {
        if (
          this.stopped ||
          !this.started ||
          this.audibleTime >= this.nextAt
        )
          resolve();
        else setTimeout(check, 60);
      };
      check();
    });
  }

  stop() {
    this.stopped = true;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    }
    this.sources = [];
    this.pending = [];
  }

  private begin() {
    this.started = true;
    this.startAt = this.ctx.currentTime + 0.04;
    this.nextAt = this.startAt;
    const list = this.pending;
    this.pending = [];
    list.forEach((b, i) => this.schedule(b, i === 0));
    this.onStart?.();
  }

  private schedule(buf: AudioBuffer, fadeIn = false) {
    // Underrun (network slower than speech): continue from now instead of in the past.
    const at = Math.max(this.nextAt, this.ctx.currentTime + 0.01);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    if (fadeIn) {
      const g = this.ctx.createGain();
      const t = at;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.012);
      src.connect(g).connect(this.ctx.destination);
    } else src.connect(this.ctx.destination);
    src.start(at);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
    };
    this.sources.push(src);
    this.segments.push({ at, offset: this.queued, duration: buf.duration });
    this.nextAt = at + buf.duration;
    this.queued += buf.duration;
  }
}
