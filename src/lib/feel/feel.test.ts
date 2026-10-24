import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFeelPrefs, setFeelPrefs } from "./prefs";

const buzz = vi.fn();
const speak = vi.fn();
vi.mock("./haptics", () => ({ buzz: (...a: unknown[]) => buzz(...a) }));
vi.mock("./sound", () => ({ speak: (...a: unknown[]) => speak(...a) }));

const { feel } = await import("./index");

beforeEach(() => {
  buzz.mockReset();
  speak.mockReset();
  resetFeelPrefs();
  localStorage.clear();
});
afterEach(() => {
  resetFeelPrefs();
  localStorage.clear();
});

describe("the feel façade", () => {
  it("routes a gesture to vibration only while sound is switched off (the default)", () => {
    feel.confirm();
    expect(buzz).toHaveBeenCalledWith("confirm", true);
    expect(speak).not.toHaveBeenCalled();
  });

  it("routes a gesture to both channels once sound is switched on", () => {
    setFeelPrefs({ sound: true });
    feel.arrive();
    expect(buzz).toHaveBeenCalledWith("arrive", true);
    expect(speak).toHaveBeenCalledWith("arrive");
  });

  it("honours haptics off without silencing sound: the two are independent", () => {
    setFeelPrefs({ sound: true, haptics: false });
    feel.tap();
    expect(buzz).not.toHaveBeenCalled();
    expect(speak).toHaveBeenCalledWith("tap");
  });

  it("is completely silent when both are off", () => {
    setFeelPrefs({ sound: false, haptics: false });
    feel.dismiss();
    expect(buzz).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("reads settings at call time, so a toggle applies to the very next tap", () => {
    feel.swap();
    expect(speak).not.toHaveBeenCalled();
    setFeelPrefs({ sound: true });
    feel.swap();
    expect(speak).toHaveBeenCalledWith("swap");
  });

  it("names one gesture per kind of thing that can happen", () => {
    expect(Object.keys(feel).sort()).toEqual(
      ["arrive", "confirm", "dismiss", "swap", "tap"].sort(),
    );
  });
});
