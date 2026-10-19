import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyze = vi.fn();
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => analyze }));
vi.mock("./shadow.functions", () => ({ analyzeShadow: {} }));
const { useShadow, SHADOW_DELAY } = await import("./useShadow");

const L = (id: string, quote: string) => ({
  id,
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
});
afterEach(() => vi.useRealTimers());

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
    expect(result.current.state).toMatchObject({ status: "ready", carried: true, losses: [{ id: "b" }] });
  });
});
