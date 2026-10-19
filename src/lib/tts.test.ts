import { afterEach, describe, expect, it, vi } from "vitest";
import { chunkText, normLang, pickVoice, speak, stopSpeaking } from "./tts";

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

describe("device playback session", () => {
  afterEach(() => { stopSpeaking(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("ignores the old utterance end after stop and starts no more old chunks", async () => {
    const utterances: SpeechSynthesisUtterance[] = [];
    const synth = {
      speaking: false, pending: false, paused: false,
      getVoices: () => [{ lang: "de-DE", name: "de", localService: true }],
      cancel: vi.fn(),
      speak: (u: SpeechSynthesisUtterance) => utterances.push(u),
    };
    vi.stubGlobal("speechSynthesis", synth);
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    const end = vi.fn();
    const stop = speak("Ein langer Satz. ".repeat(30), "de", { onEnd: end });
    await Promise.resolve();
    expect(utterances).toHaveLength(1);
    stop();
    utterances[0]?.onend?.({} as SpeechSynthesisEvent);
    expect(utterances).toHaveLength(1);
    expect(end).not.toHaveBeenCalled();
  });
});
