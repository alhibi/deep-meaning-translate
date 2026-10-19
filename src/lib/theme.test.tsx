import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { nextTheme, parseTheme, THEME_BOOT, THEME_KEY, THEMES, useTheme } from "./theme";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

describe("three sequential dark themes", () => {
  it("cycles through exactly three choices and returns to the first", () => {
    expect(THEMES).toHaveLength(3);
    expect(nextTheme("dark")).toBe("forest");
    expect(nextTheme("forest")).toBe("rose");
    expect(nextTheme("rose")).toBe("dark");
  });

  it("validates saved choices and migrates legacy or corrupted values", () => {
    for (const value of [null, "light", "garbage", {}, 1]) expect(parseTheme(value)).toBe("dark");
    expect(parseTheme("forest")).toBe("forest");
    expect(parseTheme("rose")).toBe("rose");
  });

  it("restores all choices before paint, remaining dark on a light system", () => {
    for (const value of ["dark", "forest", "rose", "light", "corrupt"]) {
      localStorage.setItem(THEME_KEY, value);
      new Function(THEME_BOOT)();
      expect(document.documentElement.dataset.theme).toBe(parseTheme(value));
      expect(document.documentElement.style.colorScheme).toBe("dark");
    }
  });

  it("counts rapid clicks sequentially and saves the final choice without animation in reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.toggle(1, 1);
      result.current.toggle(1, 1);
    });
    expect(result.current.theme).toBe("rose");
    expect(localStorage.getItem(THEME_KEY)).toBe("rose");
    expect(document.documentElement.dataset.theme).toBe("rose");
    act(() => result.current.toggle(1, 1));
    expect(result.current.theme).toBe("dark");
  });
});