import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  TARGET_LANGUAGES,
  isRtl,
  languageByCode,
  languageLabel,
  normalizeLanguageQuery,
  partnerCandidates,
} from "./languages";

describe("language table", () => {
  it("keeps every code inside the server's two-letter contract and never duplicates one", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z]{2}$|^auto$/);
    expect(TARGET_LANGUAGES.every((l) => l.code !== "auto")).toBe(true);
    expect(TARGET_LANGUAGES.length).toBe(LANGUAGES.length - 1);
  });

  it("includes the designed pair plus a broad, real set of native names", () => {
    for (const code of ["ar", "de", "en", "fr", "es", "tr", "ru", "zh", "hi", "ur", "fa", "vi"])
      expect(languageByCode(code)?.native, code).toBeTruthy();
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(70);
    expect(new Set(LANGUAGES.map((l) => l.native)).size).toBe(LANGUAGES.length);
  });

  it("marks right-to-left languages and resolves tagged codes from speech", () => {
    for (const code of ["ar", "fa", "he", "ur", "ps", "sd", "ug", "yi"])
      expect(isRtl(code)).toBe(true);
    expect(isRtl("de")).toBe(false);
    expect(isRtl("ar-SA")).toBe(true);
    expect(languageByCode("de-DE")?.native).toBe("Deutsch");
    expect(languageLabel("de-DE")).toBe("Deutsch");
    expect(languageLabel("xx")).toBe("xx");
  });

  it("suggests the natural partners without ever suggesting the source itself", () => {
    expect(partnerCandidates("ar")).toEqual(["de", "en"]);
    expect(partnerCandidates("de")).toEqual(["ar", "en"]);
    expect(partnerCandidates("en")).toEqual(["ar", "de"]);
    expect(partnerCandidates("ja")).toEqual(["ar", "de"]);
    expect(partnerCandidates("de")).not.toContain("de");
  });
});

describe("language search normalization", () => {
  it("collapses case, German diacritics and Arabic letter variants", () => {
    expect(normalizeLanguageQuery("  DEUTSCH ")).toBe("deutsch");
    expect(normalizeLanguageQuery("Türkçe")).toBe("turkce");
    expect(normalizeLanguageQuery("الألمانية")).toBe(normalizeLanguageQuery("الالمانيه"));
    expect(normalizeLanguageQuery("فارسی")).toBe(normalizeLanguageQuery("فارسی"));
    expect(normalizeLanguageQuery("العربيَّة")).toBe(normalizeLanguageQuery("العربيه"));
  });

  it("finds a language through aliases, native name and localized name", () => {
    const q = normalizeLanguageQuery("المانيه");
    const german = LANGUAGES.find((l) => l.code === "de")!;
    const haystack = [german.native, german.name, ...(german.aliases ?? [])].map(
      normalizeLanguageQuery,
    );
    expect(haystack.some((s) => s.includes(q))).toBe(true);
    expect(normalizeLanguageQuery("mandarin")).toContain("mandarin");
  });
});
