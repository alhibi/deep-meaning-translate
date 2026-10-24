import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  DEFAULT_FEEL,
  getFeelPrefs,
  parseFeelPrefs,
  resetFeelPrefs,
  setFeelPrefs,
  useFeelPrefs,
} from "./prefs";

beforeEach(() => {
  resetFeelPrefs();
  localStorage.clear();
});
afterEach(() => {
  resetFeelPrefs();
  localStorage.clear();
});

describe("feel preferences", () => {
  it("defaults to silent and haptic: sound is opt-in, vibration is not", () => {
    expect(DEFAULT_FEEL).toEqual({ sound: false, haptics: true });
    expect(getFeelPrefs()).toEqual(DEFAULT_FEEL);
  });

  it("validates on read so damaged storage cannot reach the audio or vibration APIs", () => {
    for (const value of [null, "garbage", 42, [], {}])
      expect(parseFeelPrefs(value)).toEqual(DEFAULT_FEEL);
    // A non-boolean must fall back per-field, not wipe the other field with it.
    expect(parseFeelPrefs({ sound: "yes", haptics: false })).toEqual({
      sound: false,
      haptics: false,
    });
    expect(parseFeelPrefs({ sound: true, haptics: 1 })).toEqual({ sound: true, haptics: true });
  });

  it("persists a change and reads it back as a fresh module would", async () => {
    setFeelPrefs({ sound: true });
    expect(JSON.parse(localStorage.getItem("lingua.feel.v1") ?? "{}")).toEqual({
      sound: true,
      haptics: true,
    });
    // A real reload: drop every module instance and read the device again.
    // (`resetFeelPrefs` is not this — it clears the stored value too, by design.)
    vi.resetModules();
    const fresh = await import("./prefs");
    expect(fresh.getFeelPrefs()).toEqual({ sound: true, haptics: true });
  });

  it("survives storage that cannot be written", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setFeelPrefs({ sound: true })).not.toThrow();
    // The choice still applies for this session even though it could not be saved.
    expect(getFeelPrefs().sound).toBe(true);
    spy.mockRestore();
  });

  it("notifies subscribers so an open settings sheet updates immediately", () => {
    const { result } = renderHook(() => useFeelPrefs());
    expect(result.current).toEqual(DEFAULT_FEEL);
    act(() => {
      setFeelPrefs({ haptics: false });
    });
    expect(result.current).toEqual({ sound: false, haptics: false });
  });
});
