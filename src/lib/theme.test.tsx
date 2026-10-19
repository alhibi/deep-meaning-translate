import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { nextTheme, parseTheme, THEME_BOOT, THEME_KEY, THEMES, useTheme } from "./theme";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
  delete document.documentElement.dataset["theme"];
  vi.unstubAllGlobals();
});

describe("light and three sequential dark themes", () => {
  it("retains light and cycles through all four choices", () => {
    expect(THEMES).toHaveLength(4);
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("navy");
    expect(nextTheme("navy")).toBe("burgundy");
    expect(nextTheme("burgundy")).toBe("dark");
  });

  it("validates saved choices and migrates legacy or corrupted values", () => {
    for (const value of [null, "garbage", {}, 1]) expect(parseTheme(value)).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("forest")).toBe("navy");
    expect(parseTheme("rose")).toBe("burgundy");
  });

  it("restores light and dark choices before paint, including migrations", () => {
    for (const value of ["dark", "navy", "burgundy", "forest", "rose", "light", "corrupt"]) {
      localStorage.setItem(THEME_KEY, value);
      new Function(THEME_BOOT)();
      expect(document.documentElement.dataset["theme"]).toBe(parseTheme(value));
      expect(document.documentElement.style.colorScheme).toBe(value === "light" ? "light" : "dark");
    }
  });

  it("counts rapid clicks sequentially and saves the final choice without animation in reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.toggle(1, 1);
      result.current.toggle(1, 1);
    });
    expect(result.current.theme).toBe("navy");
    expect(localStorage.getItem(THEME_KEY)).toBe("navy");
    expect(document.documentElement.dataset["theme"]).toBe("navy");
    act(() => result.current.toggle(1, 1));
    expect(result.current.theme).toBe("burgundy");
    act(() => result.current.toggle(1, 1));
    expect(result.current.theme).toBe("dark");
  });
});