import { afterEach, describe, expect, it, vi } from "vitest";
import { providerFetch } from "./request.server";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("direct provider request lifetime", () => {
  it("aborts stalled headers within the safety deadline", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            signal = init.signal;
            signal?.addEventListener("abort", () =>
              reject(new DOMException("Cancelled", "AbortError")),
            );
          }),
      ),
    );
    const result = providerFetch("https://provider.example", {}).catch((e) => e.name);
    await vi.advanceTimersByTimeAsync(60001);
    expect(await result).toBe("AbortError");
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a stalled response body and cancels its reader", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const response = await providerFetch("https://provider.example", {});
    const result = response.arrayBuffer().catch((e) => e.name);
    await vi.advanceTimersByTimeAsync(60001);
    expect(await result).toBe("AbortError");
    expect(cancel).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("response cancellation aborts upstream immediately", async () => {
    const cancel = vi.fn();
    let upstream: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        upstream = init.signal;
        return Promise.resolve(new Response(new ReadableStream({ cancel })));
      }),
    );
    const response = await providerFetch("https://provider.example", {});
    await response.body?.cancel();
    expect(upstream?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalled();
  });
});
