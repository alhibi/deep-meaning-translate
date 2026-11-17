import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
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
  useSeenCultureIds,
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
    expect(hasSeenCulture("culture-1")).toBe(false);
    localStorage.setItem(CULTURE_SEEN_KEY, "not-json");
    resetCultureSeenCache();
    expect(listSeenCultureIds()).toEqual([]);
    localStorage.setItem(CULTURE_SEEN_KEY, JSON.stringify({ version: 99, ids: ["culture-1"] }));
    resetCultureSeenCache();
    expect(listSeenCultureIds()).toEqual([]);
  });

  it("marks an article seen once, most recent first", async () => {
    expect(await markCultureSeen("culture-1")).toBe(true);
    expect(await markCultureSeen("culture-2")).toBe(true);
    expect(listSeenCultureIds()).toEqual(["culture-2", "culture-1"]);
    expect(await markCultureSeen("culture-1")).toBe(true);
    expect(listSeenCultureIds()).toEqual(["culture-1", "culture-2"]);
    expect(hasSeenCulture("culture-1")).toBe(true);
    expect(readStored()).toEqual({
      version: CULTURE_SEEN_VERSION,
      ids: ["culture-1", "culture-2"],
    });
    resetCultureSeenCache();
    expect(listSeenCultureIds()).toEqual(["culture-1", "culture-2"]);
  });

  it("marks a page seen in one write, newest supplied id first", async () => {
    await markCultureSeen("culture-old");
    await markCultureSeenMany([
      "culture-3",
      "culture-2",
      "culture-2",
      "culture-1",
      "has space",
      "",
    ]);
    expect(listSeenCultureIds()).toEqual(["culture-3", "culture-2", "culture-1", "culture-old"]);
    await markCultureSeenMany([]);
    await markCultureSeenMany(["culture-1"]);
    expect(listSeenCultureIds()).toEqual(["culture-1", "culture-3", "culture-2", "culture-old"]);
    await markCultureSeenMany(["culture-1"]);
    expect(listSeenCultureIds()).toEqual(["culture-1", "culture-3", "culture-2", "culture-old"]);
    await markCultureSeenMany(["culture-new", "culture-old"]);
    expect(listSeenCultureIds()).toEqual([
      "culture-new",
      "culture-old",
      "culture-1",
      "culture-3",
      "culture-2",
    ]);
  });

  it("refuses invalid ids", async () => {
    expect(await markCultureSeen("has space")).toBe(false);
    expect(await markCultureSeen("")).toBe(false);
    expect(await markCultureSeen("x".repeat(129))).toBe(false);
    expect(listSeenCultureIds()).toEqual([]);
  });

  it("bounds the written history and an oversized stored document", async () => {
    for (let index = 0; index <= CULTURE_SEEN_LIMIT; index += 1) {
      await markCultureSeen("culture-" + String(index));
    }
    expect(listSeenCultureIds()).toHaveLength(CULTURE_SEEN_LIMIT);
    expect(listSeenCultureIds()[0]).toBe("culture-" + String(CULTURE_SEEN_LIMIT));
    expect(listSeenCultureIds()).not.toContain("culture-0");

    const oversized = Array.from(
      { length: CULTURE_SEEN_LIMIT + 10 },
      (_, index) => "culture-" + String(index),
    );
    localStorage.setItem(
      CULTURE_SEEN_KEY,
      JSON.stringify({ version: CULTURE_SEEN_VERSION, ids: oversized }),
    );
    resetCultureSeenCache();
    expect(listSeenCultureIds()).toHaveLength(CULTURE_SEEN_LIMIT);
  });

  it("validates ids on read instead of trusting the document", () => {
    const document = {
      version: CULTURE_SEEN_VERSION,
      ids: [
        "culture-1",
        7,
        "",
        "has space",
        "\u0000culture-3",
        "y".repeat(129),
        "culture-1",
        "culture-2",
      ],
    };
    expect(parseCultureSeenValue(document)).toEqual(["culture-1", "culture-2"]);
    localStorage.setItem(CULTURE_SEEN_KEY, JSON.stringify(document));
    expect(listSeenCultureIds()).toEqual(["culture-1", "culture-2"]);
    expect(parseCultureSeenRaw("garbage")).toEqual([]);
    expect(parseCultureSeenValue({ version: CULTURE_SEEN_VERSION, ids: {} })).toBeNull();
    expect(parseCultureSeenRaw(serializeCultureSeen(["culture-9"]))).toEqual(["culture-9"]);
  });

  it("clears the history and removes the device document", async () => {
    await markCultureSeen("culture-1");
    await markCultureSeen("culture-2");
    expect(await clearSeenHistory()).toBe(true);
    expect(listSeenCultureIds()).toEqual([]);
    expect(localStorage.getItem(CULTURE_SEEN_KEY)).toBeNull();
    resetCultureSeenCache();
    expect(listSeenCultureIds()).toEqual([]);
  });

  it("keeps the write result and the in-memory history on refusal", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(await markCultureSeen("culture-1")).toBe(false);
    expect(listSeenCultureIds()).toEqual(["culture-1"]);
  });

  it("notifies subscribers, exposes a snapshot and rereads a cross-tab write", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSeenCulture(listener);
    await markCultureSeen("culture-1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(seenCultureSnapshot()).toEqual(["culture-1"]);
    localStorage.setItem(CULTURE_SEEN_KEY, serializeCultureSeen(["culture-7"]));
    window.dispatchEvent(new StorageEvent("storage", { key: CULTURE_SEEN_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(seenCultureSnapshot()).toEqual(["culture-7"]);
    unsubscribe();
    await markCultureSeen("culture-2");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("leaves other device keys alone", async () => {
    localStorage.setItem("lingua.other.v1", "keep");
    await markCultureSeen("culture-1");
    expect(localStorage.getItem("lingua.other.v1")).toBe("keep");
  });

  it("drives a React consumer through useSyncExternalStore", async () => {
    const { result } = renderHook(() => useSeenCultureIds());
    expect(result.current).toEqual([]);
    await act(async () => {
      await markCultureSeen("culture-1");
    });
    expect(result.current).toEqual(["culture-1"]);
    await act(async () => {
      await clearSeenHistory();
    });
    expect(result.current).toEqual([]);
  });
});
