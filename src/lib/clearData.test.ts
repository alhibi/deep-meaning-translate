import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

const result = {
  sourceLanguage: "de",
  targetLanguage: "ar",
  translation: "مرحبا",
  tone: "",
  formality: "",
  confidence: 1,
  isAmbiguous: false,
  alternativeTranslations: [],
  notes: "",
};

describe("clearing device data", () => {
  it("clears every store, including caches that storage removal cannot reach", async () => {
    const { persist } = await import("./persist");
    const { saved } = await import("./saved");
    const { history } = await import("./history");
    const { memoryGet, memorySet } = await import("./translation/memory");
    const { clearDeviceData } = await import("./clearData");
    const { readStatsPrefs, writeStatsPrefs } = await import("./stats/useArchive");

    writeStatsPrefs({ insightsHidden: true });
    expect(readStatsPrefs().insightsHidden).toBe(true); // parsed into the module cache
    persist.saveSession({ text: "Hallo", result, source: "de", target: "ar", style: "natural" });
    await saved.toggle({ source: "de", target: "ar", original: "Hallo", translated: "مرحبا" });
    await history.add({ source: "de", target: "ar", original: "Hallo", translated: "مرحبا" });
    memorySet("de|ar|Hallo", result);

    await clearDeviceData();

    expect(persist.session()).toBeNull();
    expect(persist.remembered()).toEqual({ prefs: null, session: null });
    expect(saved.list()).toEqual([]);
    expect(history.list()).toEqual([]);
    expect(memoryGet("de|ar|Hallo")).toBeNull();
    expect(readStatsPrefs().insightsHidden).toBe(false); // no cached preference survives
    expect(Object.keys(localStorage).filter((k) => k.startsWith("lingua."))).toEqual([]);
  });

  it("drops translation memory when another tab clears storage", async () => {
    const { memoryGet, memorySet } = await import("./translation/memory");
    memorySet("de|ar|Hallo", result);
    localStorage.removeItem("lingua.memory.v1");
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(memoryGet("de|ar|Hallo")).toBeNull();
  });
});
