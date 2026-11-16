import { describe, expect, it } from "vitest";
import { isEcho, languagePartner, normalizeEcho, shouldHoldForReroute } from "./echo";
import type { TranslationResult } from "./types";

const result = (translation: string): TranslationResult => ({
  sourceLanguage: "auto",
  targetLanguage: "de",
  translation,
  tone: "",
  formality: "",
  confidence: 1,
  isAmbiguous: false,
  alternativeTranslations: [],
  notes: "",
});

describe("echo detection", () => {
  it("treats punctuation and whitespace variants as the same text", () => {
    expect(normalizeEcho("  Hallo  ")).toBe("hallo");
    expect(normalizeEcho("Hallo.")).toBe("hallo");
    expect(isEcho("Hallo", result(" Hallo. "))).toBe(true);
    expect(isEcho("مرحبا", result("مرحبا؟"))).toBe(true);
  });

  it("does not treat a real translation or transliteration as an echo", () => {
    expect(isEcho("Hallo", result("مرحبا"))).toBe(false);
    expect(isEcho("Hallo", result("Hallo zusammen"))).toBe(false);
    expect(isEcho("Berlin", result("برلين"))).toBe(false);
  });

  it("knows only the product pair as an echo partner", () => {
    expect(languagePartner("de")).toBe("ar");
    expect(languagePartner("ar")).toBe("de");
    expect(languagePartner("en")).toBeNull();
    expect(languagePartner("")).toBeNull();
  });

  it("never holds a provisional auto-source result on a skeleton", () => {
    // The exact "Hallo" / default Deutsch case: sourceLanguage is still "auto" while
    // streaming, and the text is identical — the old inline rule returned true forever.
    expect(
      shouldHoldForReroute({
        source: "auto",
        target: "de",
        provisional: true,
        result: result("Hallo"),
      }),
    ).toBe(false);
    expect(
      shouldHoldForReroute({
        source: "auto",
        target: "de",
        provisional: false,
        result: { ...result("Hallo"), sourceLanguage: "auto" },
      }),
    ).toBe(false);
  });

  it("holds only a settled result that detected the target language", () => {
    expect(
      shouldHoldForReroute({
        source: "auto",
        target: "de",
        provisional: false,
        result: { ...result("Hallo"), sourceLanguage: "de" },
      }),
    ).toBe(true);
    expect(
      shouldHoldForReroute({
        source: "auto",
        target: "de",
        provisional: false,
        result: { ...result("Hallo"), sourceLanguage: "en" },
      }),
    ).toBe(false);
    expect(
      shouldHoldForReroute({
        source: "de",
        target: "de",
        provisional: false,
        result: { ...result("Hallo"), sourceLanguage: "de" },
      }),
    ).toBe(false);
  });
});
