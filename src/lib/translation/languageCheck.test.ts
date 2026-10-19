import { describe, expect, it } from "vitest";
import { checkSource, dominantScript } from "./languageCheck";

describe("source language check", () => {
  it("the reported case: Arabic text with English picked → suggest Arabic, certain", () => {
    expect(checkSource("وينك", "en")).toEqual({ suggest: "ar", strong: true });
  });

  it("stays quiet when the text matches the picked language", () => {
    const ok: [string, string][] = [
      ["وينك يا صاحبي", "ar"],
      ["Wie geht es dir heute?", "de"],
      ["How are you doing today?", "en"],
      ["Je suis très fatigué aujourd'hui", "fr"],
      ["Hola, ¿cómo estás hoy?", "es"],
      ["Bugün çok yorgunum", "tr"],
      ["Ciao, come stai oggi?", "it"],
      ["Hoe gaat het vandaag met je?", "nl"],
      ["Olá, você está bem hoje?", "pt"],
      ["Как у тебя дела сегодня?", "ru"],
      ["امروز خیلی خسته‌ام", "fa"],
      ["آپ کیسے ہیں؟ میں ٹھیک ہوں", "ur"],
      ["מה שלומך היום?", "he"],
      ["你今天好吗", "zh"],
      ["今日はとても疲れています", "ja"],
    ];
    for (const [text, code] of ok) expect(checkSource(text, code), `${code}: ${text}`).toBeNull();
  });

  it("every writing system catches the wrong pick", () => {
    const wrong: [string, string, string][] = [
      ["Как у тебя дела сегодня?", "de", "ru"],
      ["מה שלומך היום?", "ar", "he"],
      ["今日はとても疲れています", "en", "ja"],
      ["你今天好吗", "de", "zh"],
      ["Wie geht es dir?", "ar", "de"],
      ["امروز خیلی خسته‌ام", "de", "fa"],
      ["آپ کیسے ہیں؟ میں ٹھیک ہوں", "en", "ur"],
    ];
    for (const [text, picked, expected] of wrong) {
      const m = checkSource(text, picked);
      expect(m?.strong, `${picked}: ${text}`).toBe(true);
      expect(m?.suggest, `${picked}: ${text}`).toBe(expected);
    }
  });

  it("Latin languages: clear common-word evidence suggests the other language", () => {
    expect(checkSource("Ich bin heute sehr müde und habe keine Zeit", "en")).toEqual({ suggest: "de", strong: false });
    expect(checkSource("I am very tired today and I have no time", "de")).toEqual({ suggest: "en", strong: false });
    expect(checkSource("Je suis très fatigué aujourd'hui", "es")).toEqual({ suggest: "fr", strong: false });
  });

  it("uses the model's detection for a finished sentence", () => {
    expect(checkSource("Kino morgen?", "en", "de")).toEqual({ suggest: "de", strong: false });
    expect(checkSource("Wie geht es dir heute?", "de", "de")).toBeNull();
  });

  it("never warns on names, single words or mixed text it can't be sure about", () => {
    expect(checkSource("Mohammed", "de")).toBeNull();
    // Latin letters can't be Arabic; without evidence for a language, offer detection.
    expect(checkSource("Berlin", "ar")).toEqual({ suggest: "auto", strong: true });
    expect(checkSource("Ok", "en")).toBeNull();
    expect(checkSource("Hallo", "en")).toBeNull();
    expect(checkSource("123 !!", "en")).toBeNull();
    expect(dominantScript("Ich sage مرحبا zu dir heute")?.script).toBe("latin");
    expect(checkSource("مرحبا", "auto")).toBeNull();
  });
});
