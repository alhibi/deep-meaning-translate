import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyze = vi.fn();
vi.mock("../native/rpc", () => ({ callShadow: (...args: unknown[]) => analyze(...args) }));
const { useShadow, SHADOW_DELAY } = await import("./useShadow");
const { enqueueEnrichment, resetEnrichmentQueueForTests } = await import("./enrichment");

const L = (id: string, quote: string) => ({
  id,
  kind: "loss" as const,
  category: "warmth",
  severity: 2,
  confidence: 0.8,
  source: { start: 0, end: 3 },
  target: { start: 0, end: quote.length },
  sourceQuote: "abc",
  targetQuote: quote,
  explanation: "x",
  restores: [],
});
const base = {
  text: "wie geht es dir",
  translation: "كيف حالك يا صديقي",
  source: "de",
  target: "ar",
  style: "natural" as "natural" | "formal" | "casual",
  dialect: "auto" as const,
  uiLocale: "ar" as const,
  settled: true,
  enabled: true,
};
const flush = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  analyze.mockReset();
  // Quiet work goes through a shared queue; each test starts from an empty one.
  resetEnrichmentQueueForTests(0, 250);
});
afterEach(() => {
  resetEnrichmentQueueForTests(0);
  vi.useRealTimers();
});

describe("useShadow", () => {
  it("never asks while the translation is still streaming", async () => {
    renderHook(() => useShadow({ ...base, settled: false }));
    await flush(SHADOW_DELAY * 3);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("makes no request when switched off", async () => {
    const { result } = renderHook(() => useShadow({ ...base, enabled: false }));
    await flush(SHADOW_DELAY * 3);
    expect(analyze).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe("off");
  });

  it("waits for the translation to rest, then shows the losses", async () => {
    analyze.mockResolvedValue({ shadow: { losses: [L("a", "كيف")] } });
    const { result } = renderHook(() => useShadow(base));
    await flush(SHADOW_DELAY - 50);
    expect(analyze).not.toHaveBeenCalled();
    await flush(100);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ status: "ready", losses: [{ id: "a" }] });
  });

  it("ignores an older analysis after the translation changed", async () => {
    let resolveOld: (v: unknown) => void = () => undefined;
    analyze.mockReturnValueOnce(new Promise((r) => (resolveOld = r)));
    analyze.mockResolvedValueOnce({ shadow: { losses: [] } });
    const { result, rerender } = renderHook((p) => useShadow(p), { initialProps: base });
    await flush(SHADOW_DELAY + 10);
    rerender({ ...base, translation: "كيفك يا صاحبي" });
    await flush(SHADOW_DELAY + 10);
    await act(async () => resolveOld({ shadow: { losses: [L("old", "كيف")] } }));
    expect(result.current.state).toEqual({ status: "ready", losses: [] });
  });

  it("never reuses another (text, translation) pair's cached losses", async () => {
    // Both tuples serialize to the same "|"-joined string:
    //   "de|ar|natural|auto|ar|ab cd ef|x|y"
    // The cache then answered the second sentence with the first sentence's findings.
    analyze
      .mockResolvedValueOnce({ shadow: { losses: [L("pair1", "x")] } })
      .mockResolvedValueOnce({ shadow: { losses: [L("pair2", "y")] } });
    const { result, rerender } = renderHook((p) => useShadow(p), {
      initialProps: { ...base, text: "ab cd ef", translation: "x|y" },
    });
    await flush(SHADOW_DELAY + 10);
    expect(result.current.state).toMatchObject({ losses: [{ id: "pair1" }] });
    rerender({ ...base, text: "ab cd ef|x", translation: "y" });
    await flush(SHADOW_DELAY + 10);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(result.current.state).toMatchObject({ losses: [{ id: "pair2" }] });
  });

  it("swapping back to an analysed sentence reuses the cached shadow", async () => {
    analyze.mockResolvedValue({ shadow: { losses: [] } });
    const { rerender } = renderHook((p) => useShadow(p), { initialProps: base });
    await flush(SHADOW_DELAY + 10);
    rerender({ ...base, style: "formal" });
    await flush(SHADOW_DELAY + 10);
    rerender(base);
    await flush(SHADOW_DELAY + 10);
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it("keep-as-is hides that loss for this sentence only", async () => {
    analyze.mockResolvedValue({ shadow: { losses: [L("a", "كيف"), L("b", "صديقي")] } });
    const { result } = renderHook(() => useShadow(base));
    await flush(SHADOW_DELAY + 10);
    act(() => result.current.dismiss("a"));
    expect(result.current.state).toMatchObject({ losses: [{ id: "b" }] });
  });

  it("after applying a fix, the other losses stay visible while re-checking", async () => {
    analyze.mockResolvedValueOnce({ shadow: { losses: [L("a", "كيف"), L("b", "صديقي")] } });
    analyze.mockReturnValueOnce(new Promise(() => undefined));
    const { result, rerender } = renderHook((p) => useShadow(p), { initialProps: base });
    await flush(SHADOW_DELAY + 10);
    act(() => result.current.prepareApply("a", "ما أخبارك يا صديقي"));
    rerender({ ...base, translation: "ما أخبارك يا صديقي" });
    expect(result.current.state).toMatchObject({
      status: "ready",
      carried: true,
      losses: [{ id: "b" }],
    });
  });

  it("aborts the running analysis transport when the screen goes away", async () => {
    resetEnrichmentQueueForTests(0, 5_000);
    analyze.mockImplementation(
      () =>
        new Promise(() => {
          // only the forwarded signal can stop a provider that never answers
        }),
    );
    const { unmount } = renderHook(() => useShadow(base));
    await flush(SHADOW_DELAY + 10);
    expect(analyze).toHaveBeenCalledTimes(1);
    const forwarded = analyze.mock.calls[0]![0].signal as AbortSignal | undefined;
    expect(forwarded).toBeInstanceOf(AbortSignal);
    expect(forwarded!.aborted).toBe(false);
    unmount();
    expect(forwarded!.aborted).toBe(true);
  });

  it("joins an identical in-flight analysis instead of paying twice", async () => {
    resetEnrichmentQueueForTests(0, 5_000);
    analyze.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ shadow: { losses: [L("a", "كيف")] } }), 20);
        }),
    );
    const first = renderHook(() => useShadow(base));
    const second = renderHook(() => useShadow(base));
    await flush(SHADOW_DELAY + 200);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(first.result.current.state).toMatchObject({ status: "ready" });
    expect(second.result.current.state).toMatchObject({ status: "ready" });
  });

  it("cancels a queued analysis when the screen unmounts, before any request", async () => {
    resetEnrichmentQueueForTests(0, 5_000);
    let releaseBlocker: () => void = () => {};
    const blocker = enqueueEnrichment(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve)),
    );
    await flush(10);
    analyze.mockResolvedValue({ shadow: { losses: [] } });
    const { unmount } = renderHook(() => useShadow(base));
    await flush(SHADOW_DELAY + 10);
    expect(analyze).not.toHaveBeenCalled();
    unmount();
    releaseBlocker();
    await blocker;
    await flush(100);
    expect(analyze).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not leave its rest timer behind on unmount", async () => {
    analyze.mockResolvedValue({ shadow: { losses: [] } });
    const { unmount } = renderHook(() => useShadow(base));
    await flush(100); // the 600 ms rest delay is still pending
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isolates a shadow failure: the sentence stays, the hint is simply absent", async () => {
    analyze.mockRejectedValue(new Error("provider down"));
    const { result } = renderHook(() => useShadow(base));
    await flush(SHADOW_DELAY + 50);
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("keeps the cache bounded and evicts the least recently used sentence", async () => {
    analyze.mockResolvedValue({ shadow: { losses: [] } });
    const translation = (i: number) => "ترجمة " + i;
    const { rerender } = renderHook((p) => useShadow(p), {
      initialProps: { ...base, translation: translation(0) },
    });
    for (let i = 0; i < 30; i++) {
      rerender({ ...base, translation: translation(i) });
      await flush(SHADOW_DELAY + 10);
    }
    expect(analyze).toHaveBeenCalledTimes(30);
    // Touch the first-inserted sentence: it becomes the most recently used.
    rerender({ ...base, translation: translation(0) });
    await flush(SHADOW_DELAY + 10);
    expect(analyze).toHaveBeenCalledTimes(30);
    rerender({ ...base, translation: translation(30) });
    await flush(SHADOW_DELAY + 10);
    expect(analyze).toHaveBeenCalledTimes(31);
    // The touched sentence survived; the untouched second sentence was evicted.
    rerender({ ...base, translation: translation(0) });
    await flush(SHADOW_DELAY + 10);
    expect(analyze).toHaveBeenCalledTimes(31);
    rerender({ ...base, translation: translation(1) });
    await flush(SHADOW_DELAY + 10);
    expect(analyze).toHaveBeenCalledTimes(32);
  });
});
