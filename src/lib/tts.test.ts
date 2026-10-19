import { describe, expect, it } from "vitest";
import { chunkText, normLang, pickVoice } from "./tts";

const v = (lang: string, localService = false, name = lang) => ({ lang, localService, name });

describe("device voice", () => {
  it("matches Android-style locales (de_DE)", () => {
    expect(normLang("de_DE")).toBe("de-de");
    expect(pickVoice([v("en_US"), v("de_DE")], "de")?.lang).toBe("de_DE");
  });
  it("prefers the exact on-device locale voice", () => {
    const voices = [v("ar-EG"), v("ar-SA"), v("ar-SA", true, "local")];
    expect(pickVoice(voices, "ar")?.name).toBe("local");
  });
  it("finds no voice for a language the device lacks", () => {
    expect(pickVoice([v("en-US"), v("de-DE")], "ar")).toBeUndefined();
  });
  it("splits long text at sentence ends and keeps exact offsets", () => {
    const text = "Erster Satz ist hier. ".repeat(20).trim();
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
      expect(c.text.length).toBeLessThanOrEqual(100);
    }
    expect(chunks[0]!.text.trimEnd().endsWith(".")).toBe(true);
  });
  it("short text is one chunk", () => {
    expect(chunkText("مرحبا بك")).toEqual([{ text: "مرحبا بك", offset: 0 }]);
  });
});
