import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buzz, canVibrate } from "./haptics";

const vibrate = vi.fn();
let reduceMotion = false;

beforeEach(() => {
  vibrate.mockReset();
  reduceMotion = false;
  Object.defineProperty(navigator, "vibrate", {
    value: vibrate,
    configurable: true,
    writable: true,
  });
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduceMotion && /reduced-motion/.test(q),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("haptic vocabulary", () => {
  it("gives each gesture its own rhythm so two actions never feel identical", () => {
    const seen: string[] = [];
    for (const g of ["tap", "confirm", "arrive", "swap", "dismiss"] as const) {
      buzz(g);
      seen.push(JSON.stringify(vibrate.mock.calls.at(-1)?.[0]));
    }
    expect(new Set(seen).size).toBe(5);
    // Every rhythm stays short: two quick taps must not blur into one another.
    for (const raw of seen) {
      const total = (JSON.parse(raw) as number[]).reduce((a, b) => a + b, 0);
      expect(total).toBeLessThan(60);
    }
  });

  it("stays silent when the person asked for reduced motion", () => {
    reduceMotion = true;
    expect(canVibrate()).toBe(false);
    buzz("confirm");
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("honours the caller's own setting independently of the device", () => {
    buzz("tap", false);
    expect(vibrate).not.toHaveBeenCalled();
    buzz("tap", true);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the device has no motor or blocks the call", () => {
    Object.defineProperty(navigator, "vibrate", {
      value: () => {
        throw new Error("blocked");
      },
      configurable: true,
      writable: true,
    });
    expect(() => buzz("arrive")).not.toThrow();
    Object.defineProperty(navigator, "vibrate", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(canVibrate()).toBe(false);
    expect(() => buzz("arrive")).not.toThrow();
  });
});
