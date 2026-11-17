import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CULTURE_SEEN_KEY,
  CULTURE_SEEN_LIMIT,
  CULTURE_SEEN_VERSION,
  clearSeenHistory,
  hasSeenCulture,
  listSeenCultureIds,
  markCultureSeen,
  markCultureSeenMany,
  parseCultureSeenRaw,
  parseCultureSeenValue,
  resetCultureSeenCache,
  seenCultureCount,
  seenCultureSnapshot,
  serializeCultureSeen,
  subscribeSeenCulture,
} from "./seen";

const readStored = (): unknown => JSON.parse(localStorage.getItem(CULTURE_SEEN_KEY) ?? "null");

beforeEach(() => {
  localStorage.clear();
  resetCultureSeenCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetCultureSeenCache();
});

describe("seen culture history", () => {
  it("reads an absent, corrupt or foreign document as empty", () => {
    expect(listSeenCultureIds()).toEqual([]);
    expect(seenCultureCount()).toBe(0);
    expect(hasSeenCulture("met-1")).toBe(false);
    localStorage.setItem(CULTURE_SEEN_KEY, "not-json");
    resetCultureSeenCache();
    expect(listSeenCultureIds()).toEqual([]);
    localStorage.setItem(CULTURE_SEEN_KEY, JSON.stringify({ v: 99, ids: ["met-1"] }));
    resetCultureSeenCache();
    expect(listSeenCultureIds()).toEqual([]);
  });

  it("marks a record seen once and most recent first", async () => {
    expect(await markCultureSeen("met-1")).toBe(true);
    expect(await markCultureSeen("met-2")).toBe(true);
    expect(listSeenCultureIds()).toEqual(["met-2", "met-1"]);
    expect(await markCultureSeen("met-1")).toBe(true);
    expect(listSeenCultureIds()).toEqual(["met-1", "met-2"]);
    expect(hasSeenCulture("met-1")).toBe(true);
    expect(readStored()).toEqual({ v: CULTURE_SEEN_VERSION, ids: ["met-1", "met-2"] });
    resetCultureSeenCache();
    expect(listSeenCultureIds()).toEqual(["met-1", "met-2"]);
  });

  it("marks a page seen in one write, newest supplied id first", async () => {
    await markCultureSeen("met-old");
    await markCultureSeenMany(["met-3", "met-2", "met-2", "met-1", "has space", ""]);
    expect(listSeenCultureIds()).toEqual(["met-3", "met-2", "met-1", "met-old"]);
    await markCultureSeenMany([]);
    await markCultureSeenMany(["met-1"]);
    expect(listSeenCultureIds()).toEqual(["met-1", "met-3", "met-2", "met-old"]);
    // Re-marking the newest record is a no-op (still one write's worth of order).
    await markCultureSeenMany(["met-1"]);
    expect(listSeenCultureIds()).toEqual(["met-1", "met-3", "met-2", "met-old"]);
  });

  it("refuses invalid ids", async () => {
    expect(await markCultureSeen("has space")).toBe(false);
    expect(await markCultureSeen("")).toBe(false);
    expect(await markCultureSeen("x".repeat(129))).toBe(false);
    expect(listSeenCultureIds()).toEqual([]);
  });

  it("bounds the written history and an oversized stored document", async () => {
    for (let i = 0; i <= CULTURE_SEEN_LIMIT; i += 1) {
      await markCultureSeen(`met-${String(i)}`);
    }
    expect(listSeenCultureIds()).toHaveLength(CULTURE_SEEN_LIMIT);
    expect(listSeenCultureIds()[0]).toBe(`met-${String(CULTURE_SEEN_LIMIT)}`);
    expect(listSeenCultureIds()).not.toContain("met-0");

    const oversized = Array.from({ length: CULTURE_SEEN_LIMIT + 10 }, (_, i) => `met-${String(i)}`);
    localStorage.setItem(CULTURE_SEEN_KEY, JSON.stringify({ v: 1, ids: oversized }));
    resetCultureSeenCache();
    expect(listSeenCultureIds()).toHaveLength(CULTURE_SEEN_LIMIT);
  });

  it("validates ids on read instead of trusting the document", () => {
    const document = {
      v: CULTURE_SEEN_VERSION,
      ids: ["met-1", 7, "", "has space", "\u0000met-3", "y".repeat(129), "met-1", "met-2"],
    };
    expect(parseCultureSeenValue(document)).toEqual(["met-1", "met-2"]);
    localStorage.setItem(CULTURE_SEEN_KEY, JSON.stringify(document));
    expect(listSeenCultureIds()).toEqual(["met-1", "met-2"]);
    expect(parseCultureSeenRaw("garbage")).toEqual([]);
    expect(parseCultureSeenValue({ v: CULTURE_SEEN_VERSION, ids: {} })).toBeNull();
    expect(parseCultureSeenRaw(serializeCultureSeen(["met-9"]))).toEqual(["met-9"]);
  });

  it("clears the history and the device document", async () => {
    await markCultureSeen("met-1");
    await markCultureSeen("met-2");
    expect(await clearSeenHistory()).toBe(true);
    expect(listSeenCultureIds()).toEqual([]);
    expect(readStored()).toEqual({ v: CULTURE_SEEN_VERSION, ids: [] });
    resetCultureSeenCache();
    expect(listSeenCultureIds()).toEqual([]);
  });

  it("keeps the write result and the in-memory history on refusal", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(await markCultureSeen("met-1")).toBe(false);
    expect(listSeenCultureIds()).toEqual(["met-1"]);
  });

  it("notifies subscribers and exposes a snapshot", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSeenCulture(listener);
    await markCultureSeen("met-1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(seenCultureSnapshot()).toEqual(["met-1"]);
    unsubscribe();
    await markCultureSeen("met-2");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("leaves other device keys alone", async () => {
    localStorage.setItem("lingua.other.v1", "keep");
    await markCultureSeen("met-1");
    expect(localStorage.getItem("lingua.other.v1")).toBe("keep");
    expect(localStorage.length).toBe(2);
  });
});
