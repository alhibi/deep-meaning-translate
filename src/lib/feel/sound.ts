/**
 * Interface sound, synthesised at runtime.
 *
 * There is deliberately **no audio file anywhere in this project**: every gesture is
 * a few milliseconds of shaped oscillator built from one shared `AudioContext`. That
 * buys four things a sample-based kit cannot: zero bytes downloaded, zero third-party
 * origin, nothing to precache or version, and pitch that can be derived from the same
 * tokens the visual system uses.
 *
 * Rules this module never breaks:
 * - the context is created **inside a user gesture** (the first call), because browsers
 *   refuse to start one before that — creating it at import time would just be suspended;
 * - nothing throws: an unavailable Web Audio API means silence, never a broken action;
 * - every voice is short (< 320 ms) and quiet, so a person tapping quickly is not
 *   building a wall of noise;
 * - a suspended context (tab hidden, phone call, autoplay policy) is resumed, and if it
 *   stays suspended the gesture is simply dropped rather than queued for later.
 */

export type Gesture = "tap" | "confirm" | "arrive" | "swap" | "dismiss";

/** Master level. Low enough that it sits under the voice, never over it. */
const MASTER = 0.13;

interface Engine {
  ctx: AudioContext;
  out: GainNode;
}

let engine: Engine | null = null;
let noise: AudioBuffer | null = null;
let blocked = false;

function context(): Engine | null {
  if (blocked || typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    blocked = true;
    return null;
  }
  try {
    if (!engine) {
      const ctx = new Ctor();
      const out = ctx.createGain();
      out.gain.value = MASTER;
      out.connect(ctx.destination);
      engine = { ctx, out };
    }
    // A suspended context cannot be heard. Resume it; if that fails, stay silent.
    if (engine.ctx.state === "suspended") void engine.ctx.resume().catch(() => {});
    if (engine.ctx.state !== "running") return null;
    return engine;
  } catch {
    blocked = true;
    return null;
  }
}

/** One short 0.4 s noise buffer, built once and reused for the "swap" whoosh. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise) return noise;
  const frames = Math.floor(ctx.sampleRate * 0.4);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  noise = buf;
  return buf;
}

interface Tone {
  /** Start frequency in Hz. */
  from: number;
  /** End frequency; equal to `from` for a flat note. */
  to?: number;
  /** Seconds after the gesture at which this note starts. */
  at?: number;
  /** Seconds of sounding, attack+release included. */
  dur: number;
  type?: OscillatorType;
  /** Peak amplitude of this note, relative to the master level. */
  gain: number;
  /** Portion of `dur` spent attacking, 0..1. A soft swell needs a long one. */
  attack?: number;
}

function play(e: Engine, tone: Tone) {
  const { ctx, out } = e;
  const start = ctx.currentTime + (tone.at ?? 0);
  const dur = tone.dur;
  const attack = Math.min(0.9, Math.max(0.01, tone.attack ?? 0.12)) * dur;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = tone.type ?? "sine";
  osc.frequency.setValueAtTime(tone.from, start);
  if (tone.to && tone.to !== tone.from) {
    // A glide, not a jump: the pitch curve is what makes it feel physical.
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, tone.to), start + dur);
  }
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, tone.gain), start + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp).connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.02);
  // Detach on completion: an oscillator kept alive leaks nodes on a long session.
  osc.onended = () => {
    osc.disconnect();
    amp.disconnect();
  };
}

/** The "swap" whoosh: band-passed noise whose centre frequency sweeps upward. */
function whoosh(e: Engine) {
  const { ctx, out } = e;
  const start = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.1;
  band.frequency.setValueAtTime(420, start);
  band.frequency.exponentialRampToValueAtTime(2400, start + 0.15);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(0.05, start + 0.05);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
  src.connect(band).connect(amp).connect(out);
  src.start(start);
  src.stop(start + 0.2);
  src.onended = () => {
    src.disconnect();
    band.disconnect();
    amp.disconnect();
  };
}

/**
 * The voice of each gesture. Intervals are deliberate: `confirm` is a rising fifth
 * (resolution), `dismiss` the same distance falling (release), `arrive` a soft
 * open fifth that swells — the sound of something landing, not of a click.
 */
const VOICES: Record<Gesture, (e: Engine) => void> = {
  tap: (e) => play(e, { from: 1180, to: 940, dur: 0.04, gain: 0.05 }),
  confirm: (e) => {
    play(e, { from: 880, dur: 0.06, type: "triangle", gain: 0.06 });
    play(e, { from: 1318.5, at: 0.055, dur: 0.09, type: "triangle", gain: 0.055 });
  },
  arrive: (e) => {
    play(e, { from: 440, to: 444, dur: 0.3, gain: 0.045, attack: 0.45 });
    play(e, { from: 659.25, at: 0.03, dur: 0.28, gain: 0.032, attack: 0.5 });
  },
  swap: whoosh,
  dismiss: (e) => play(e, { from: 660, to: 392, dur: 0.08, gain: 0.04 }),
};

/**
 * Speak one gesture. Silent by design when the context is unavailable, suspended,
 * or when the caller has sound switched off — the caller only ever asks, never guards.
 */
export function speak(gesture: Gesture): void {
  const e = context();
  if (!e) return;
  try {
    VOICES[gesture](e);
  } catch {
    /* a failed voice must never break the action it accompanies */
  }
}

/** Test/diagnostic helper: true when a context exists and is running. */
export function soundReady(): boolean {
  return !!engine && engine.ctx.state === "running";
}

/**
 * Releases the engine.
 *
 * In the app this is a diagnostic hook; a real session keeps one context for its whole
 * lifetime, which is what the platform wants. It also clears the `blocked` latch, so a
 * test that exercises a broken audio API does not poison every test after it — the
 * latch exists to stop retrying a dead API on every tap, not to survive a fresh start.
 */
export function closeSound(): void {
  if (engine) {
    try {
      void engine.ctx.close();
    } catch {
      /* already closed */
    }
  }
  engine = null;
  noise = null;
  blocked = false;
}
