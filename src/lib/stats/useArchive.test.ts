import { beforeEach, describe, expect, it, vi } from "vitest";
import { readStatsPrefs, writeStatsPrefs } from "./useArchive";

/**
 * The statistics route reads its one local preference during render
 * (routes/stats.tsx:162). Reading and parsing the JSON value on every render is wasted
 * work on a screen that re-renders for every sheet, metric toggle and URL sync; the
 * stored string is the source of truth, so a cached parse is compared against it.
 */

const KEY = "lingua.stats.v1";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("statistics preferences", () => {
  it("parses the stored value once, not on every render read", () => {
    localStorage.setItem(KEY, JSON.stringify({ insightsHidden: true }));
    expect(readStatsPrefs().insightsHidden).toBe(true); // warm the cache
    const parse = vi.spyOn(JSON, "parse");
    for (let i = 0; i < 100; i++) expect(readStatsPrefs().insightsHidden).toBe(true);
    expect(parse.mock.calls.length).toBe(0);
  });

  it("still sees the stored value when another tab changes it", () => {
    localStorage.setItem(KEY, JSON.stringify({ insightsHidden: true }));
    expect(readStatsPrefs().insightsHidden).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({ insightsHidden: false }));
    expect(readStatsPrefs().insightsHidden).toBe(false);
  });

  it("forgets the cached value when device data is cleared", () => {
    localStorage.setItem(KEY, JSON.stringify({ insightsHidden: true }));
    expect(readStatsPrefs().insightsHidden).toBe(true);
    localStorage.removeItem(KEY);
    expect(readStatsPrefs().insightsHidden).toBe(false);
  });

  it("writes through without re-parsing its own value", () => {
    writeStatsPrefs({ insightsHidden: true });
    const parse = vi.spyOn(JSON, "parse");
    expect(readStatsPrefs().insightsHidden).toBe(true);
    expect(parse.mock.calls.length).toBe(0);
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify({ insightsHidden: true }));
  });

  it("treats damaged JSON as the default, never as hidden", () => {
    localStorage.setItem(KEY, "{broken");
    expect(readStatsPrefs()).toEqual({ insightsHidden: false });
  });
});
