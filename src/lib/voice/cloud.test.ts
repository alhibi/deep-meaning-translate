import { afterEach, describe, expect, it, vi } from "vitest";
import { Feed } from "./cloud";
import { DEFAULT_VOICE } from "./geminiVoice";
const req = { text: "audit unique clip", lang: "de", voice: DEFAULT_VOICE, quality: "best" as const, pace: "normal" as const };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("cloud feed lifecycle", () => {
  it("abort cancels a stalled body and immediately settles waiting consumers", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(80)); }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const feed = new Feed(req).start();
    await feed.next(0);
    const next = feed.next(1).catch(e => e.kind);
    feed.abort();
    expect(await next).toBe("network");
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("audio followed by a stalled connection reaches a bounded timeout", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(80)); }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const feed = new Feed({ ...req, text: "stalled unique clip" }).start();
    await feed.next(0);
    const next = feed.next(1).catch(e => e.kind);
    await vi.advanceTimersByTimeAsync(15001);
    expect(await next).toBe("timeout");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(feed.done).toBe(false);
  });
});