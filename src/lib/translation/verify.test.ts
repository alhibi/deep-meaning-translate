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

describe("deterministic checks a native reader would notice", () => {
  const req = (text: string, source = "de", target = "ar") =>
    ({ text, source, target, style: "natural" }) as const;
  const res = (translation: string) =>
    ({ translation, sourceLanguage: "de", targetLanguage: "ar" }) as unknown as Parameters<
      typeof verifyTranslation
    >[1];

  it("accepts Arabic-Indic digits as the same number", () => {
    // ٣٥ and 35 are the same value; a faithful translation may use either.
    expect(verifyTranslation(req("Das kostet 35 Euro"), res("يكلف ٣٥ يورو"))).toEqual([]);
  });

  it("flags a price that changed", () => {
    const issues = verifyTranslation(req("Das kostet 35 Euro"), res("يكلف ٣٦ يورو"));
    expect(issues.join(" ")).toContain("Numbers");
  });

  it("flags a dropped name in a Latin-script pair", () => {
    const issues = verifyTranslation(
      req("Frau Müller kommt morgen", "de", "en"),
      res("The woman is coming tomorrow"),
    );
    expect(issues.join(" ")).toContain("Müller");
  });

  it("never flags a name merely because Arabic transliterated it", () => {
    // Transliteration is the correct behaviour for ar output, not a loss.
    expect(
      verifyTranslation(req("Frau Müller kommt morgen"), res("السيدة مولر تأتي غداً")),
    ).toEqual([]);
  });

  it("flags a question that turned into a statement", () => {
    const issues = verifyTranslation(req("Kannst du kommen?"), res("هل يمكنك القدوم"));
    expect(issues.join(" ")).toContain("question mark");
  });

  it("flags an explanation the user never wrote", () => {
    const issues = verifyTranslation(
      req("Ich komme später"),
      res("سآتي لاحقاً\nNote: this keeps the casual tone"),
    );
    expect(issues.join(" ")).toContain("explanation");
  });

  it("keeps Arabic punctuation in Arabic and out of German", () => {
    expect(
      verifyTranslation(req("Wirklich، das ist gut", "de", "ar"), res("حقاً، هذا جيد")),
    ).toEqual([]);
    // Same mixed punctuation in a German result is wrong, and must be reported.
    const leaked = verifyTranslation(req("Wirklich gut", "ar", "de"), res("Wirklich gut، oder"));
    expect(leaked.join(" ")).toContain("non-Arabic");
  });

  it("leaves a clean translation alone: no noise, no false alarms", () => {
    expect(
      verifyTranslation(
        req("Bitte schicken Sie mir die Rechnung bis Freitag."),
        res("يرجى إرسال الفاتورة إليّ حتى الجمعة."),
      ),
    ).toEqual([]);
  });
});
