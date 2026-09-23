import { describe, expect, it } from "vitest";
import { verifyTranslation } from "./verify";
import type { TranslationResult } from "./types";

const res = (translation: string): TranslationResult => ({
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
const req = (text: string) => ({ text, source: "de", target: "ar", style: "natural" as const });

describe("verifyTranslation", () => {
  it("flags an empty translation", () => {
    expect(verifyTranslation(req("Hallo"), res("  "))).not.toHaveLength(0);
  });
  it("flags dropped URLs and numbers", () => {
    expect(verifyTranslation(req("Siehe https://a.de"), res("انظر"))).not.toHaveLength(0);
    expect(verifyTranslation(req("Um 15 Uhr"), res("في الساعة"))).not.toHaveLength(0);
  });
  it("accepts a faithful translation", () => {
    expect(
      verifyTranslation(req("Um 15 Uhr auf https://a.de"), res("الساعة 15 على https://a.de")),
    ).toHaveLength(0);
  });
});
