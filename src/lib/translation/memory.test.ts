import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  memoryClear,
  memoryDrop,
  memoryGet,
  memoryResetForTests,
  memorySet,
  memorySize,
} from "./memory";
import type { TranslationResult } from "./types";

const result = (translation: string): TranslationResult => ({
  sourceLanguage: "de",
  targetLanguage: "ar",
  translation,
  tone: "",
  formality: "neutral",
  confidence: 0.9,
  isAmbiguous: false,
  alternativeTranslations: [],
  notes: "",
});

const KEY = "lingua.memory.v1";
/** Read the on-disk rows directly, bypassing the module cache. */
const raw = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown[];
/** Write rows straight to storage to simulate a previous session or tampering. */
const writeRaw = (rows: unknown) => localStorage.setItem(KEY, JSON.stringify(rows));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T10:00:00Z"));
  memoryClear();
  localStorage.clear();
});
afterEach(() => {
  memoryClear();
  localStorage.clear();
  vi.useRealTimers();
});

describe("translation memory", () => {
  it("returns a settled translation for its exact key and nothing for another", () => {
    memorySet("de|ar|natural|Hallo", result("مرحباً"));
    expect(memoryGet("de|ar|natural|Hallo")?.translation).toBe("مرحباً");
    // A different style is a different translation, so it must not answer for it.
    expect(memoryGet("de|ar|formal|Hallo")).toBeNull();
    expect(memoryGet("")).toBeNull();
  });

  it("survives a reload: the same rows answer after the module forgets its cache", () => {
    memorySet("k1", result("واحدة"));
    expect(raw()).toHaveLength(1);
    memoryResetForTests(); // as if the page had been closed and reopened
    expect(memoryGet("k1")?.translation).toBe("واحدة");
  });

  it("drops rows whose payload no longer validates instead of rendering them", () => {
    writeRaw([
      { k: "good", v: result("سليمة"), at: Date.now() },
      { k: "no-translation", v: { sourceLanguage: "de" }, at: Date.now() },
      { k: "wrong-type", v: "a string", at: Date.now() },
      { k: "no-key", v: result("بلا مفتاح"), at: "yesterday" },
      null,
      42,
    ]);
    memoryResetForTests();
    expect(memoryGet("good")?.translation).toBe("سليمة");
    expect(memoryGet("no-translation")).toBeNull();
    expect(memoryGet("wrong-type")).toBeNull();
    expect(memoryGet("no-key")).toBeNull();
    expect(memorySize()).toBe(1);
  });

  it("starts clean when storage holds something that is not even JSON", () => {
    localStorage.setItem(KEY, "{not json");
    memoryResetForTests();
    expect(memorySize()).toBe(0);
    memorySet("k", result("بعد التلف"));
    expect(memoryGet("k")?.translation).toBe("بعد التلف");
  });

  it("expires a row after 30 days so a stale model answer cannot outlive its model", () => {
    memorySet("k", result("قديمة"));
    expect(memoryGet("k")?.translation).toBe("قديمة");
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);
    expect(memoryGet("k")).toBeNull();
    expect(memorySize()).toBe(0); // the dead row is removed, not merely skipped
  });

  it("evicts the least recently used row, and a hit protects its row", () => {
    memorySet("a", result("أ"));
    memorySet("b", result("ب"));
    memorySet("c", result("ج"));
    // Recency order is now c, b, a. Reading "a" makes it the *most* recent, so the
    // two eviction candidates become c and b — exactly two, which is what 119 new
    // rows displace against a cap of 120.
    expect(memoryGet("a")?.translation).toBe("أ");
    for (let i = 0; i < 119; i++) memorySet(`filler-${i}`, result("حشو"));
    expect(memorySize()).toBe(120);
    expect(memoryGet("b")).toBeNull();
    expect(memoryGet("c")).toBeNull();
    expect(memoryGet("a")?.translation).toBe("أ");
  });

  it("stays inside the byte budget by dropping from the oldest end", () => {
    const big = "ن".repeat(4000);
    for (let i = 0; i < 80; i++) memorySet(`k${i}`, result(big));
    expect(JSON.stringify(raw()).length).toBeLessThanOrEqual(200_000);
    // The newest row is always the one that survives.
    expect(memoryGet("k79")?.translation).toBe(big);
  });

  it("replaces a key in place rather than storing a second copy", () => {
    memorySet("k", result("قبل المراجعة"));
    memorySet("k", result("بعد المراجعة"));
    expect(memorySize()).toBe(1);
    expect(memoryGet("k")?.translation).toBe("بعد المراجعة");
    expect(raw()).toHaveLength(1);
  });

  it("drops and clears on request", () => {
    memorySet("a", result("أ"));
    memorySet("b", result("ب"));
    memoryDrop("a");
    expect(memoryGet("a")).toBeNull();
    expect(memoryGet("b")?.translation).toBe("ب");
    memoryDrop("never-stored"); // must not throw
    memoryClear();
    expect(memorySize()).toBe(0);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("refuses to store a payload that is not a translation result", () => {
    memorySet("k", { translation: "بلا بقية الحقول" } as unknown as TranslationResult);
    expect(memoryGet("k")).toBeNull();
    expect(memorySize()).toBe(0);
  });

  it("de-duplicates keys when reading storage written by an older version", () => {
    writeRaw([
      { k: "dup", v: result("الأحدث"), at: Date.now() },
      { k: "dup", v: result("الأقدم"), at: Date.now() - 1000 },
    ]);
    memoryResetForTests();
    expect(memoryGet("dup")?.translation).toBe("الأحدث");
    expect(memorySize()).toBe(1);
  });
});
