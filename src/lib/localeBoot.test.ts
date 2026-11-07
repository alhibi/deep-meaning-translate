import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALE_BOOT, normalizeLocale } from "./i18n";

afterEach(() => {
  localStorage.clear();
  document.documentElement.lang = "";
  document.documentElement.dir = "";
  vi.unstubAllGlobals();
});

const boot = () => new Function(LOCALE_BOOT)();

describe("locale boot", () => {
  it("accepts only the three shipped interface languages", () => {
    expect(normalizeLocale("ar")).toBe("ar");
    expect(normalizeLocale("de")).toBe("de");
    expect(normalizeLocale("en")).toBe("en");
    for (const value of ["fr", "AR", "", null, 2, {}]) expect(normalizeLocale(value)).toBeNull();
  });

  it("sets document direction before paint for a saved Arabic choice", () => {
    localStorage.setItem("lingua.ui-locale", "ar");
    boot();
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("falls back to the browser language, then English", () => {
    vi.stubGlobal("navigator", { languages: ["de-DE", "en-US"], language: "de-DE" });
    boot();
    expect(document.documentElement.lang).toBe("de");
    expect(document.documentElement.dir).toBe("ltr");

    vi.stubGlobal("navigator", { languages: ["fr-FR"], language: "fr-FR" });
    document.documentElement.lang = "";
    boot();
    expect(document.documentElement.lang).toBe("en");
  });

  it("survives storage that throws", () => {
    vi.stubGlobal("navigator", { languages: ["ar"], language: "ar" });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => boot()).not.toThrow();
    expect(document.documentElement.lang).toBe("ar");
    vi.restoreAllMocks();
  });
});
