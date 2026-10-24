import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dayKey } from "./stats/engine";
import { resetTodayKeyForTests, useTodayKey } from "./useTodayKey";

/**
 * "Today" drives every period on the statistics page. Reading the clock during render
 * would make components impure and freeze the day at first paint, so it lives in an
 * external store — and a page left open across midnight must roll over by itself.
 */
describe("today", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetTodayKeyForTests();
  });

  it("supplies the device's own day", () => {
    const { result } = renderHook(() => useTodayKey());
    expect(result.current).toBe(dayKey(Date.now()));
  });

  it("rolls over at local midnight without a reload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 31, 23, 59, 0));
    const { result } = renderHook(() => useTodayKey());
    expect(result.current).toBe("2026-01-31");

    act(() => {
      vi.setSystemTime(new Date(2026, 1, 1, 0, 0, 10));
      vi.advanceTimersByTime(65_000);
    });

    expect(result.current).toBe("2026-02-01");
  });

  it("shares one value across consumers and stops ticking when the last one leaves", () => {
    vi.useFakeTimers();
    const first = renderHook(() => useTodayKey());
    const second = renderHook(() => useTodayKey());
    expect(first.result.current).toBe(second.result.current);
    const timer = vi.getTimerCount();
    expect(timer).toBeGreaterThan(0);
    first.unmount();
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
