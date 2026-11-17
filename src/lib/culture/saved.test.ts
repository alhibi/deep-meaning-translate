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
  subscribeCultureSaved,
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
    expect(isCultureSaved("culture-1")).toBe(false);
    localStorage.setItem(CULTURE_SAVED_KEY, "{not json");
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toEqual([]);
    localStorage.setItem(CULTURE_SAVED_KEY, JSON.stringify({ version: 1, ids: ["culture-1"] }));
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toEqual([]);
    localStorage.setItem(CULTURE_SAVED_KEY, JSON.stringify(["culture-1"]));
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toEqual([]);
  });

  it("round-trips saves, most recent first, in the versioned envelope", async () => {
    expect(await saveCultureItem("culture-1")).toBe(true);
    expect(await saveCultureItem("culture-2")).toBe(true);
    expect(listSavedCultureIds()).toEqual(["culture-2", "culture-1"]);
    expect(savedCultureCount()).toBe(2);
    expect(isCultureSaved("culture-1")).toBe(true);
    expect(readStored()).toEqual({
      version: CULTURE_SAVED_VERSION,
      ids: ["culture-2", "culture-1"],
    });
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toEqual(["culture-2", "culture-1"]);
  });

  it("deduplicates a re-save and moves it to the front", async () => {
    await saveCultureItem("culture-1");
    await saveCultureItem("culture-2");
    await saveCultureItem("culture-1");
    expect(listSavedCultureIds()).toEqual(["culture-1", "culture-2"]);
  });

  it("removes, toggles and refuses invalid ids", async () => {
    await saveCultureItem("culture-1");
    await saveCultureItem("culture-2");
    expect(await removeCultureItem("culture-1")).toBe(true);
    expect(listSavedCultureIds()).toEqual(["culture-2"]);
    expect(await removeCultureItem("culture-missing")).toBe(true);
    expect(await toggleCultureSaved("culture-3")).toBe(true);
    expect(isCultureSaved("culture-3")).toBe(true);
    expect(await toggleCultureSaved("culture-3")).toBe(false);
    expect(isCultureSaved("culture-3")).toBe(false);
    expect(await saveCultureItem("has space")).toBe(false);
    expect(await saveCultureItem("")).toBe(false);
    expect(await saveCultureItem("x".repeat(129))).toBe(false);
    expect(listSavedCultureIds()).toEqual(["culture-2"]);
    await clearCultureSaved();
  });

  it("validates ids on read instead of trusting the document", () => {
    const document = {
      version: CULTURE_SAVED_VERSION,
      ids: [
        "culture-1",
        42,
        "",
        "has space",
        "x".repeat(129),
        "\u0000culture-3",
        "culture-1",
        "culture-2",
        null,
      ],
    };
    expect(parseCultureSavedValue(document)).toEqual(["culture-1", "culture-2"]);
    localStorage.setItem(CULTURE_SAVED_KEY, JSON.stringify(document));
    expect(listSavedCultureIds()).toEqual(["culture-1", "culture-2"]);
    expect(parseCultureSavedRaw("garbage")).toEqual([]);
    expect(parseCultureSavedRaw(null)).toEqual([]);
    expect(parseCultureSavedValue({ version: CULTURE_SAVED_VERSION, ids: "culture-1" })).toBeNull();
  });

  it("bounds both the written list and an oversized stored document", async () => {
    for (let index = 0; index <= CULTURE_SAVED_LIMIT; index += 1) {
      await saveCultureItem("culture-" + String(index));
    }
    expect(listSavedCultureIds()).toHaveLength(CULTURE_SAVED_LIMIT);
    expect(listSavedCultureIds()[0]).toBe("culture-" + String(CULTURE_SAVED_LIMIT));
    expect(listSavedCultureIds()).not.toContain("culture-0");

    const oversized = Array.from(
      { length: CULTURE_SAVED_LIMIT + 25 },
      (_, index) => "culture-" + String(index),
    );
    localStorage.setItem(
      CULTURE_SAVED_KEY,
      JSON.stringify({ version: CULTURE_SAVED_VERSION, ids: oversized }),
    );
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toHaveLength(CULTURE_SAVED_LIMIT);
  });

  it("clears the list and removes the device document", async () => {
    await saveCultureItem("culture-1");
    await saveCultureItem("culture-2");
    expect(await clearCultureSaved()).toBe(true);
    expect(listSavedCultureIds()).toEqual([]);
    expect(localStorage.getItem(CULTURE_SAVED_KEY)).toBeNull();
    resetCultureSavedCache();
    expect(listSavedCultureIds()).toEqual([]);
  });

  it("reports a refused device write without silently dropping the in-memory save", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(await saveCultureItem("culture-1")).toBe(false);
    expect(listSavedCultureIds()).toEqual(["culture-1"]);
  });

  it("serialises exactly the document it validates", () => {
    const raw = serializeCultureSaved(["culture-1", "culture-2"]);
    expect(parseCultureSavedRaw(raw)).toEqual(["culture-1", "culture-2"]);
    expect(JSON.parse(raw)).toEqual({
      version: CULTURE_SAVED_VERSION,
      ids: ["culture-1", "culture-2"],
    });
  });

  it("leaves other device keys alone", async () => {
    localStorage.setItem("lingua.other.v1", "keep");
    await saveCultureItem("culture-1");
    expect(localStorage.getItem("lingua.other.v1")).toBe("keep");
  });

  it("notifies subscribers for every mutation and rereads a cross-tab write", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCultureSaved(listener);
    await saveCultureItem("culture-1");
    expect(listener).toHaveBeenCalledTimes(1);
    await removeCultureItem("culture-1");
    expect(listener).toHaveBeenCalledTimes(2);
    localStorage.setItem(CULTURE_SAVED_KEY, serializeCultureSaved(["culture-9"]));
    window.dispatchEvent(new StorageEvent("storage", { key: CULTURE_SAVED_KEY }));
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listSavedCultureIds()).toEqual(["culture-9"]);
    unsubscribe();
    await saveCultureItem("culture-10");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("drives a React consumer through useSyncExternalStore", async () => {
    const { result } = renderHook(() => useSavedCultureIds());
    expect(result.current).toEqual([]);
    await act(async () => {
      await saveCultureItem("culture-1");
    });
    expect(result.current).toEqual(["culture-1"]);
    await act(async () => {
      await removeCultureItem("culture-1");
    });
    expect(result.current).toEqual([]);
    await act(async () => {
      await saveCultureItem("culture-2");
    });
    expect(result.current).toEqual(["culture-2"]);
  });
});
