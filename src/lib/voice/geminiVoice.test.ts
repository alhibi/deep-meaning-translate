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
      engine: "elevenlabs",
      elevenVoice: "EXAVITQu4vr4xnSDxMaL",
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

import { createSseAudioParser, pcm16ToFloat } from "./geminiVoice";
describe("streamed speech", () => {
  it("decodes audio deltas even when events are split across network chunks", () => {
    const parse = createSseAudioParser();
    const ev = `event: step.delta\ndata: {"event_type":"step.delta","delta":{"type":"audio","data":"${btoa("\u0001\u0002\u0003\u0004")}"}}\n\n`;
    const a = parse(ev.slice(0, 30));
    const b = parse(ev.slice(30) + 'data: {"event_type":"interaction.completed"}\n');
    expect(a.audio.length).toBe(0);
    expect(Array.from(b.audio[0]!)).toEqual([1, 2, 3, 4]);
    expect(b.done).toBe(true);
  });
  it("reports stream errors", () => {
    expect(
      createSseAudioParser()('data: {"event_type":"error","error":{"message":"x"}}\n').error,
    ).toBe("x");
  });
  it("converts 16-bit PCM and carries an odd byte to the next chunk", () => {
    const carry: number[] = [];
    const f1 = pcm16ToFloat(new Uint8Array([0x00, 0x40, 0xff]), carry);
    expect(f1.length).toBe(1);
    expect(f1[0]).toBeCloseTo(0.5);
    const f2 = pcm16ToFloat(new Uint8Array([0xbf]), carry);
    expect(f2[0]).toBeCloseTo(-0.5, 2);
  });
  it("asks Google for raw PCM when streaming", () => {
    const b = buildInteraction(
      { text: "Hi", lang: "en", voice: "Kore", quality: "best", pace: "normal" },
      true,
    ) as { stream?: boolean; response_format: { mime_type: string } };
    expect(b.stream).toBe(true);
    expect(b.response_format.mime_type).toBe("audio/l16");
  });
});
