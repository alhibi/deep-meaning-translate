import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  CULTURE_SAVED_KEY,
  CULTURE_SAVED_LIMIT,
  CULTURE_SAVED_VERSION,
  clearCultureSaved,
  isCultureSaved,
  listSavedCultureIds,
  parseCultureSavedRaw,
  parseCultureSavedValue,
  removeCultureItem,
  resetCultureSavedCache,
  saveCultureItem,
  savedCultureCount,
  serializeCultureSaved,
  toggleCultureSaved,
  useSavedCultureIds,
} from "./saved";

const readStored = (): unknown => JSON.parse(localStorage.getItem(CULTURE_SAVED_KEY) ?? "null");

beforeEach(() => {
  localStorage.clear();
  resetCultureSavedCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetCultureSavedCache();
});

describe("saved culture store", () => {
  it("reads an absent, corrupt or foreign document as empty", () => {
    expect(listSavedCultureIds()).toEqual([]);
    expect(savedCultureCount()).toBe(0);
    expect(isCultureSaved("met-1")).toBe(false);
    localStorage.setItem(CULTURE_SAVED_KEY, "{not json");
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toEqual([]);
    localStorage.setItem(CULTURE_SAVED_KEY, JSON.stringify({ v: 2, ids: ["met-1"] }));
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toEqual([]);
    localStorage.setItem(CULTURE_SAVED_KEY, JSON.stringify(["met-1"]));
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toEqual([]);
  });

  it("round-trips saves, most recent first, in the versioned envelope", async () => {
    expect(await saveCultureItem("met-1")).toBe(true);
    expect(await saveCultureItem("met-2")).toBe(true);
    expect(listSavedCultureIds()).toEqual(["met-2", "met-1"]);
    expect(savedCultureCount()).toBe(2);
    expect(isCultureSaved("met-1")).toBe(true);
    expect(readStored()).toEqual({ v: CULTURE_SAVED_VERSION, ids: ["met-2", "met-1"] });
    // A fresh read (page reload) reads the same document back.
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toEqual(["met-2", "met-1"]);
  });

  it("deduplicates a re-save and moves it to the front", async () => {
    await saveCultureItem("met-1");
    await saveCultureItem("met-2");
    await saveCultureItem("met-1");
    expect(listSavedCultureIds()).toEqual(["met-1", "met-2"]);
  });

  it("removes, toggles and refuses invalid ids", async () => {
    await saveCultureItem("met-1");
    await saveCultureItem("met-2");
    expect(await removeCultureItem("met-1")).toBe(true);
    expect(listSavedCultureIds()).toEqual(["met-2"]);
    expect(await removeCultureItem("met-missing")).toBe(true);
    expect(await toggleCultureSaved("met-3")).toBe(true);
    expect(isCultureSaved("met-3")).toBe(true);
    expect(await toggleCultureSaved("met-3")).toBe(false);
    expect(isCultureSaved("met-3")).toBe(false);
    expect(await saveCultureItem("has space")).toBe(false);
    expect(await saveCultureItem("")).toBe(false);
    expect(listSavedCultureIds()).toEqual(["met-2"]);
    await clearCultureSaved();
  });

  it("validates ids on read instead of trusting the document", () => {
    const document = {
      v: CULTURE_SAVED_VERSION,
      ids: ["met-1", 42, "", "has space", "x".repeat(129), "\u0000met-3", "met-1", "met-2", null],
    };
    expect(parseCultureSavedValue(document)).toEqual(["met-1", "met-2"]);
    localStorage.setItem(CULTURE_SAVED_KEY, JSON.stringify(document));
    expect(listSavedCultureIds()).toEqual(["met-1", "met-2"]);
    expect(parseCultureSavedRaw("garbage")).toEqual([]);
    expect(parseCultureSavedRaw(null)).toEqual([]);
    expect(parseCultureSavedValue({ v: CULTURE_SAVED_VERSION, ids: "met-1" })).toBeNull();
  });

  it("bounds both the written list and an oversized stored document", async () => {
    for (let i = 0; i <= CULTURE_SAVED_LIMIT; i += 1) {
      await saveCultureItem(`met-${String(i)}`);
    }
    expect(listSavedCultureIds()).toHaveLength(CULTURE_SAVED_LIMIT);
    expect(listSavedCultureIds()[0]).toBe(`met-${String(CULTURE_SAVED_LIMIT)}`);
    expect(listSavedCultureIds()).not.toContain("met-0");

    const oversized = Array.from(
      { length: CULTURE_SAVED_LIMIT + 25 },
      (_, i) => `met-${String(i)}`,
    );
    localStorage.setItem(CULTURE_SAVED_KEY, JSON.stringify({ v: 1, ids: oversized }));
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toHaveLength(CULTURE_SAVED_LIMIT);
  });

  it("clears the list and the device document", async () => {
    await saveCultureItem("met-1");
    await saveCultureItem("met-2");
    expect(await clearCultureSaved()).toBe(true);
    expect(listSavedCultureIds()).toEqual([]);
    expect(readStored()).toEqual({ v: CULTURE_SAVED_VERSION, ids: [] });
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toEqual([]);
  });

  it("reports a refused device write without silently dropping the in-memory save", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(await saveCultureItem("met-1")).toBe(false);
    expect(listSavedCultureIds()).toEqual(["met-1"]);
  });

  it("serialises exactly the document it validates", () => {
    const raw = serializeCultureSaved(["met-1", "met-2"]);
    expect(parseCultureSavedRaw(raw)).toEqual(["met-1", "met-2"]);
    expect(JSON.parse(raw)).toEqual({ v: 1, ids: ["met-1", "met-2"] });
  });

  it("leaves other device keys alone", async () => {
    localStorage.setItem("lingua.other.v1", "keep");
    await saveCultureItem("met-1");
    expect(localStorage.getItem("lingua.other.v1")).toBe("keep");
    expect(localStorage.length).toBe(2);
  });

  it("drives a React consumer through the subscription", async () => {
    const { result } = renderHook(() => useSavedCultureIds());
    expect(result.current).toEqual([]);
    await act(async () => {
      await saveCultureItem("met-1");
    });
    expect(result.current).toEqual(["met-1"]);
    await act(async () => {
      await removeCultureItem("met-1");
    });
    expect(result.current).toEqual([]);
  });
});
