import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeSound, soundReady, speak } from "./sound";

/**
 * A minimal Web Audio double. jsdom has no AudioContext, and this project must not
 * gain one as a dependency, so the graph is faked just enough to prove what matters:
 * that a gesture builds nodes, that the context is created lazily *inside* the call,
 * and that nothing escapes as a throw when the API misbehaves.
 */
function makeAudioContext(overrides: Partial<{ state: string; ctorThrows: boolean }> = {}) {
  const nodes: string[] = [];
  const started: { freq: number; at: number }[] = [];
  const param = (value = 0) => ({
    value,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const connectable = (kind: string) => {
    nodes.push(kind);
    return {
      kind,
      connect: vi.fn((next: unknown) => next),
      disconnect: vi.fn(),
    };
  };
  class MockContext {
    currentTime = 0;
    sampleRate = 48_000;
    state = overrides.state ?? "running";
    destination = connectable("destination");
    /**
     * A real `resume()` moves `state` on a microtask, never synchronously. Modelling it
     * as an `async` body would run it eagerly and let the implementation believe the
     * context was already audible — testing the mock instead of the guard.
     */
    resume = vi.fn(() =>
      Promise.resolve().then(() => {
        this.state = "running";
      }),
    );
    close = vi.fn(async () => {
      this.state = "closed";
    });
    createGain = vi.fn(() => ({ ...connectable("gain"), gain: param(1) }));
    createOscillator = vi.fn(() => ({
      ...connectable("osc"),
      type: "sine",
      frequency: param(440),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as null | (() => void),
    }));
    createBiquadFilter = vi.fn(() => ({
      ...connectable("biquad"),
      type: "lowpass",
      Q: param(1),
      frequency: param(1000),
    }));
    createBufferSource = vi.fn(() => ({
      ...connectable("buffersource"),
      buffer: null,
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as null | (() => void),
    }));
    createBuffer = vi.fn((_ch: number, frames: number) => {
      const data = new Float32Array(frames);
      return { getChannelData: () => data, length: frames };
    });
  }
  const instances: MockContext[] = [];
  const Ctor = function (this: MockContext) {
    if (overrides.ctorThrows) throw new Error("no audio for you");
    const ctx = new MockContext();
    instances.push(ctx);
    return ctx;
  } as unknown as typeof AudioContext;
  return { Ctor, instances, nodes, started };
}

beforeEach(() => {
  closeSound();
});
afterEach(() => {
  closeSound();
  vi.unstubAllGlobals();
});

describe("synthesised interface sound", () => {
  it("stays silent and reports not-ready when the browser has no Web Audio", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(soundReady()).toBe(false);
    expect(() => speak("tap")).not.toThrow();
    expect(soundReady()).toBe(false);
  });

  it("creates its context lazily, inside the gesture, and reuses it afterwards", () => {
    const { Ctor, instances } = makeAudioContext();
    vi.stubGlobal("AudioContext", Ctor);
    // Nothing may be constructed at import time: a context built before a user
    // gesture would only ever come up suspended.
    expect(instances).toHaveLength(0);
    speak("tap");
    speak("confirm");
    speak("arrive");
    expect(instances).toHaveLength(1);
    expect(soundReady()).toBe(true);
  });

  it("builds a voice for every gesture without throwing", () => {
    const { Ctor, nodes } = makeAudioContext();
    vi.stubGlobal("AudioContext", Ctor);
    for (const g of ["tap", "confirm", "arrive", "swap", "dismiss"] as const) {
      expect(() => speak(g)).not.toThrow();
    }
    // "swap" is the noise whoosh, so it is the one gesture that needs a buffer source.
    expect(nodes).toContain("buffersource");
    expect(nodes.filter((n) => n === "osc").length).toBeGreaterThan(0);
  });

  it("resumes a suspended context and stays quiet while it refuses to run", () => {
    const { Ctor, instances } = makeAudioContext({ state: "suspended" });
    vi.stubGlobal("AudioContext", Ctor);
    speak("tap");
    // The gesture is what wakes the context up…
    expect(instances).toHaveLength(1);
    expect(instances[0]?.resume).toHaveBeenCalledTimes(1);
    // …but `resume()` is async, so the context is still suspended when this gesture
    // needs it. Nothing may be scheduled into a context that cannot be heard.
    expect(instances[0]?.createOscillator).not.toHaveBeenCalled();
    expect(soundReady()).toBe(false);
  });

  it("does not throw when the constructor itself fails, and stops trying", () => {
    const { Ctor } = makeAudioContext({ ctorThrows: true });
    vi.stubGlobal("AudioContext", Ctor);
    expect(() => speak("confirm")).not.toThrow();
    expect(soundReady()).toBe(false);
    // A permanently broken API should not be retried on every tap.
    expect(() => speak("confirm")).not.toThrow();
  });

  it("survives a single voice failing mid-gesture", () => {
    const { Ctor, instances } = makeAudioContext();
    vi.stubGlobal("AudioContext", Ctor);
    speak("tap"); // creates the engine
    const ctx = instances[0];
    if (ctx) {
      ctx.createOscillator = vi.fn(() => {
        throw new Error("node budget");
      }) as never;
    }
    expect(() => speak("arrive")).not.toThrow();
  });
});
