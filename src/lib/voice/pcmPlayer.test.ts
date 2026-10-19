import { describe, expect, it, vi } from "vitest";
import { PcmPlayer } from "./pcmPlayer";

function audioClock() {
  const ctx = {
    currentTime: 0,
    outputLatency: 0,
    baseLatency: 0,
    destination: {},
    createBuffer: (_channels: number, frames: number, rate: number) => ({ duration: frames / rate, copyToChannel() {} }),
    createBufferSource: () => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null, onended: null }),
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect: () => ({}) }),
  };
  return ctx;
}
describe("audible PCM clock", () => {
  it("freezes during a network gap and resumes at the actual sample offset", () => {
    const ctx = audioClock();
    const player = new PcmPlayer(ctx as unknown as AudioContext, 0);
    player.push(new Uint8Array(48000));
    ctx.currentTime = 0.54;
    expect(player.position).toBeCloseTo(0.5);
    ctx.currentTime = 3;
    expect(player.position).toBe(1);
    player.push(new Uint8Array(48000));
    expect(player.queuedSeconds).toBe(2);
    expect(player.position).toBe(1);
    ctx.currentTime = 3.51;
    expect(player.position).toBeCloseTo(1.5);
  });
  it("accounts for output latency instead of highlighting before sound reaches the listener", () => {
    const ctx = audioClock();
    ctx.outputLatency = 0.15;
    const player = new PcmPlayer(ctx as unknown as AudioContext, 0);
    player.push(new Uint8Array(48000));
    ctx.currentTime = 0.1;
    expect(player.audible).toBe(false);
    expect(player.position).toBe(0);
    ctx.currentTime = 0.69;
    expect(player.audible).toBe(true);
    expect(player.position).toBeCloseTo(0.5);
  });
  it("does not end until the final sample is audible", async () => {
    vi.useFakeTimers();
    try {
      const ctx = audioClock();
      const player = new PcmPlayer(ctx as unknown as AudioContext, 0);
      player.push(new Uint8Array(48000));
      const end = vi.fn();
      void player.finish().then(end);
      ctx.currentTime = 1.025;
      await vi.advanceTimersByTimeAsync(60);
      expect(end).not.toHaveBeenCalled();
      ctx.currentTime = 1.05;
      await vi.advanceTimersByTimeAsync(60);
      expect(end).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});