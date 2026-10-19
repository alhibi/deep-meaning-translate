import { describe, expect, it } from "vitest";
import {
  SpeakInput,
  TTS_MODELS,
  buildInteraction,
  deliveryStyle,
  extractAudio,
  isWav,
  normalizeToWav,
  pcmToWav,
  sanitizeTranscript,
  kindForStatus,
  base64ToBytes,
} from "./geminiVoice";
import { parseVoicePrefs } from "./prefs";
import { ClipCache, speechPieces } from "./cloud";
import { chunkText } from "../tts";

describe("gemini voice", () => {
  it("uses gemini-3.8-flash-tts for best and flash-lite for fast", () => {
    expect(TTS_MODELS.best).toBe("gemini-3.8-flash-tts");
    expect(TTS_MODELS.fast).toBe("gemini-3.8-flash-lite-tts");
    const body = buildInteraction({
      text: "Hallo",
      lang: "de",
      voice: "Kore",
      quality: "fast",
      pace: "normal",
    });
    expect(body.model).toBe("gemini-3.8-flash-lite-tts");
    expect(body.generation_config.speech_config[0]!.voice).toBe("Kore");
    expect(body.response_format.mime_type).toBe("audio/wav");
  });
  it("gives each language and pace its own delivery instructions", () => {
    expect(deliveryStyle("de", "normal")).not.toBe(deliveryStyle("ar", "normal"));
    expect(deliveryStyle("de", "slow")).not.toBe(deliveryStyle("de", "fast"));
    expect(deliveryStyle("ar", "normal")).toMatch(/Arabic/);
  });
  it("never lets translation text act as a performance tag", () => {
    expect(sanitizeTranscript("a <sigh> b")).toBe("a ‹sigh› b");
  });
  it("rejects unknown voices, empty text and over-long text", () => {
    const ok = { text: "x", lang: "de", voice: "Kore", quality: "best", pace: "normal" };
    expect(SpeakInput.safeParse(ok).success).toBe(true);
    expect(SpeakInput.safeParse({ ...ok, voice: "Bob" }).success).toBe(false);
    expect(SpeakInput.safeParse({ ...ok, text: " " }).success).toBe(false);
    expect(SpeakInput.safeParse({ ...ok, text: "a".repeat(601) }).success).toBe(false);
  });
  it("wraps raw PCM into a valid WAV and passes WAV through", () => {
    const wav = pcmToWav(new Uint8Array(480), 24000);
    expect(isWav(wav)).toBe(true);
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(24000);
    expect(normalizeToWav(wav, "audio/wav")).toBe(wav);
    expect(
      isWav(normalizeToWav(new Uint8Array(new ArrayBuffer(100)), "audio/l16;rate=24000")!),
    ).toBe(true);
    expect(normalizeToWav(new Uint8Array(new ArrayBuffer(100)), "audio/mpeg")).toBeNull();
  });
  it("reads the last audio block of the model output", () => {
    const b64 = btoa("abc");
    const a = extractAudio({
      steps: [
        { type: "model_output", content: [{ type: "audio", data: b64, mime_type: "audio/wav" }] },
      ],
    });
    expect(a?.data).toBe(b64);
    expect(new TextDecoder().decode(base64ToBytes(a!.data))).toBe("abc");
    expect(extractAudio({ steps: [] })).toBeNull();
  });
  it("maps Google errors: 429 quota, 401/403 config", () => {
    expect(kindForStatus(429)).toBe("quota");
    expect(kindForStatus(403)).toBe("config");
    expect(kindForStatus(500)).toBe("provider");
  });
  it("voice settings fall back to defaults when damaged", () => {
    expect(parseVoicePrefs({ voice: "Nope", pace: 3, engine: "x" })).toEqual({
      engine: "gemini",
      voice: "Kore",
      quality: "best",
      pace: "normal",
    });
    expect(
      parseVoicePrefs({ voice: "Puck", quality: "fast", engine: "device", pace: "slow" }).voice,
    ).toBe("Puck");
  });
  it("memory cache stays within item and size limits", () => {
    const c = new ClipCache(3, 100);
    for (let i = 0; i < 5; i++) c.set(String(i), new Blob(["x".repeat(30)]));
    expect(c.size).toBe(3);
    expect(c.get("0")).toBeUndefined();
    c.set("big", new Blob(["x".repeat(200)]));
    expect(c.get("big")).toBeUndefined();
    expect(c.totalBytes).toBeLessThanOrEqual(100);
  });
  it("splits long text into ordered pieces under the server limit with exact offsets", () => {
    const text = "Das ist ein ziemlich langer Satz über das Wetter in Berlin. ".repeat(20).trim();
    const pieces = speechPieces(text, chunkText);
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces[0]!.text.length).toBeLessThanOrEqual(220);
    for (const p of pieces) {
      expect(p.text.length).toBeLessThanOrEqual(600);
      expect(text.slice(p.offset, p.offset + p.text.length)).toBe(p.text);
    }
  });
});
