import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ElevenInput,
  ELEVEN_MODELS,
  elevenBody,
  elevenParser,
  timedChar,
  DEFAULT_ELEVEN_VOICE,
} from "./elevenVoice";
import { getFeed, clipKey, Feed } from "./cloud";
import { parseVoicePrefs } from "./prefs";
import { resumeWordOffset } from "../tts";

const req = {
  engine: "elevenlabs" as const,
  text: "Hallo",
  lang: "de" as const,
  voice: DEFAULT_ELEVEN_VOICE,
  quality: "best" as const,
  pace: "normal" as const,
};
const packet = (chars = ["H", "i"], start = [0, 0.1], end = [0.1, 0.2]) =>
  JSON.stringify({
    audio_base64: btoa("\x00\x01".repeat(100)),
    alignment: {
      characters: chars,
      character_start_times_seconds: start,
      character_end_times_seconds: end,
    },
  });
afterEach(() => vi.unstubAllGlobals());
describe("ElevenLabs speech", () => {
  it("provides both verified models with explicit native language and speed", () => {
    expect(ELEVEN_MODELS.best).toBe("eleven_v4");
    expect(elevenBody({ ...req, quality: "fast", pace: "slow" })).toMatchObject({
      model_id: "eleven_v4_turbo",
      language_code: "de",
      voice_settings: { speed: 0.8 },
      enable_logging: false,
    });
  });
  it("accepts every app language, including Persian, Hebrew and Urdu", () => {
    for (const lang of [
      "ar",
      "de",
      "en",
      "fr",
      "es",
      "tr",
      "it",
      "nl",
      "pt",
      "ru",
      "fa",
      "he",
      "ur",
      "zh",
      "ja",
    ])
      expect(ElevenInput.safeParse({ ...req, lang }).success).toBe(true);
  });
  it("rejects corrupted voice settings and invalid server input", () => {
    for (const patch of [
      { voice: "../../bad" },
      { text: "" },
      { text: "x".repeat(601) },
      { lang: "xx" },
      { pace: "bad" },
    ])
      expect(ElevenInput.safeParse({ ...req, ...patch }).success).toBe(false);
    expect(parseVoicePrefs({ engine: "broken", elevenVoice: "bad" })).toMatchObject({
      engine: "elevenlabs",
      elevenVoice: DEFAULT_ELEVEN_VOICE,
    });
    expect(parseVoicePrefs({ engine: "device" }).engine).toBe("device");
    expect(parseVoicePrefs({ engine: "gemini" }).engine).toBe("gemini");
  });
  it("decodes split packets and a final packet without newline", () => {
    const p = elevenParser(),
      line = packet();
    expect(p(line.slice(0, 30))).toEqual([]);
    const first = p(line.slice(30) + "\n");
    expect(first[0]?.audio.length).toBe(200);
    const final = p(packet(["!"], [0.2], [0.3]), true);
    expect(final[0]?.timing).toEqual([{ char: 2, start: 0.2, end: 0.3 }]);
  });
  it("maps UTF-16 offsets to actual provider timestamps", () => {
    const timing = elevenParser()(packet(["😀", "ب"], [0, 0.5], [0.5, 1]), true)[0]?.timing ?? [];
    expect(timedChar(timing, 0.1)).toBe(0);
    expect(timedChar(timing, 0.7)).toBe(2);
    expect(timedChar(timing, -1)).toBeUndefined();
  });
  it("rejects malformed timestamps rather than feeding stale metadata to playback", () => {
    expect(() => elevenParser()(packet(["a"], [1], [0]), true)).toThrow();
    expect(() => elevenParser()(packet(["a"], [], []), true)).toThrow();
    expect(() => elevenParser()("not JSON", true)).toThrow();
  });
  it("shares advance preparation with listening and preserves timing on cache replay", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(packet() + "\n"));
    vi.stubGlobal("fetch", fetcher);
    const r = { ...req, text: "unique-prefetch-test" };
    const a = getFeed(r),
      b = getFeed(r);
    expect(a).toBe(b);
    await a.next(Number.MAX_SAFE_INTEGER);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/eleven-speak");
    const replay = getFeed(r);
    await replay.next(Number.MAX_SAFE_INTEGER);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(replay.timing).toEqual(a.timing);
  });
  it("never mixes Gemini and ElevenLabs cache identities", () => {
    const { engine: _engine, ...gemini } = req;
    expect(clipKey(req)).not.toBe(clipKey({ ...gemini, voice: "Kore" }));
  });
  it("does not cache a broken stream as successful audio", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response("broken\n")));
    vi.stubGlobal("fetch", fetcher);
    const r = { ...req, text: "unique-failure-test" };
    await expect(getFeed(r).next(0)).rejects.toMatchObject({ kind: "provider" });
    await expect(getFeed(r).next(0)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps the replacement feed when an older failed feed cleans up", async () => {
    let oldController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let newController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              oldController = c;
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              newController = c;
            },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const r = { ...req, text: "replacement-feed-race" };
    const old = getFeed(r);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const waiting = old.next(0).catch(() => {
      // Register before the registry's terminal-error callback finishes.
      return getFeed(r);
    });
    oldController?.error(new Error("broken stream"));
    const replacement = await waiting;
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(getFeed(r)).toBe(replacement);
    newController?.enqueue(new TextEncoder().encode(packet() + "\n"));
    newController?.close();
    if (!(replacement instanceof Feed)) throw new Error("Expected replacement feed");
    await replacement.next(Number.MAX_SAFE_INTEGER);
  });
  it("resumes at the audible word instead of repeating the sentence or skipping queued text", () => {
    expect(resumeWordOffset("Hallo schöne Welt", 9)).toBe(6);
    expect(resumeWordOffset("أهلاً كيف حالك", 8)).toBe(6);
    expect(resumeWordOffset("Hallo", 0)).toBe(0);
  });
});
