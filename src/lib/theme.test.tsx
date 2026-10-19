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

describe("clay dark and light themes", () => {
  it("keeps exactly two choices and cycles between them", () => {
    expect(THEMES).toEqual(["dark", "light"]);
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });

  it("validates saved choices, dropping removed themes and corrupted values", () => {
    for (const value of [null, "garbage", {}, 1]) expect(parseTheme(value)).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    for (const value of ["navy", "burgundy", "forest", "rose"]) expect(parseTheme(value)).toBe("dark");
  });

  it("restores light and dark choices before paint, including removed themes", () => {
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
    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    act(() => result.current.toggle(1, 1));
    expect(result.current.theme).toBe("light");
    act(() => result.current.toggle(1, 1));
    expect(result.current.theme).toBe("dark");
  });
});
