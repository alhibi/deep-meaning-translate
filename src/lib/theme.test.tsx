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

describe("the three themes", () => {
  it("cycles clay dark → paper light → vivid and back", () => {
    expect(THEMES).toEqual(["dark", "light", "vivid"]);
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("vivid");
    expect(nextTheme("vivid")).toBe("dark");
  });

  it("validates saved choices, dropping retired themes and corrupted values", () => {
    for (const value of [null, "garbage", {}, 1]) expect(parseTheme(value)).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("vivid")).toBe("vivid");
    // navy and burgundy shipped once and were removed: an old preference must land on
    // a palette that exists, not on a half-applied one.
    for (const value of ["navy", "burgundy", "forest", "rose"])
      expect(parseTheme(value)).toBe("dark");
  });

  it("restores every saved choice before paint, including retired themes", () => {
    for (const value of [
      "dark",
      "navy",
      "burgundy",
      "forest",
      "rose",
      "light",
      "vivid",
      "corrupt",
    ]) {
      localStorage.setItem(THEME_KEY, value);
      new Function(THEME_BOOT)();
      const expected = parseTheme(value);
      expect(document.documentElement.dataset["theme"]).toBe(expected);
      // vivid is a dark palette: the UA colour scheme follows dark, as does clay dark.
      expect(document.documentElement.style.colorScheme).toBe(value === "light" ? "light" : "dark");
      // The class name is the theme name, so the stylesheet needs no mapping table.
      expect(document.documentElement.classList.contains(expected)).toBe(true);
      expect(document.documentElement.classList.length).toBe(1);
    }
  });

  it("counts rapid clicks sequentially and saves the final choice without animation in reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.toggle(1, 1);
      result.current.toggle(1, 1);
    });
    expect(result.current.theme).toBe("vivid");
    expect(localStorage.getItem(THEME_KEY)).toBe("vivid");
    expect(document.documentElement.dataset["theme"]).toBe("vivid");
    act(() => {
      result.current.toggle(1, 1);
    });
    expect(result.current.theme).toBe("dark");
    act(() => {
      result.current.toggle(1, 1);
    });
    expect(result.current.theme).toBe("light");
  });

  it("applies the vivid class and leaves no stale theme class behind", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.documentElement.classList.add("light");
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.toggle(1, 1);
    });
    expect(result.current.theme).toBe("light");
    act(() => {
      result.current.toggle(1, 1);
    });
    expect(result.current.theme).toBe("vivid");
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("vivid")).toBe(true);
  });
});
