import { z } from "zod";
import { base64ToBytes, PACES, MAX_SPEAK_CHARS } from "./geminiVoice";

export const ELEVEN_VOICES = [
  ["EXAVITQu4vr4xnSDxMaL", "Sarah"],
  ["CwhRBWXzGAHq8TQ4Fs17", "Roger"],
  ["FGY2WhTYpPnrIDTdsKH5", "Laura"],
  ["IKne3meq5aSn9XLyUdCD", "Charlie"],
  ["JBFqnCBsd6RMkjVDRZzb", "George"],
  ["N2lVS1w4EtoT3dr4eOWO", "Callum"],
  ["SAz9YHcvj6GT2YYXdXww", "River"],
  ["TX3LPaxmHKxFdv7VOQHJ", "Liam"],
  ["Xb7hH8MSUJpSbSDYk0k2", "Alice"],
  ["XrExE9yKIg1WjnnlVkGX", "Matilda"],
  ["bIHbv24MWmeRgasZH58o", "Will"],
  ["cgSgspJ2msm6clMCkdW9", "Jessica"],
  ["cjVigY5qzO86Huf0OWal", "Eric"],
  ["iP95p4xoKVk53GoZ742B", "Chris"],
  ["nPczCjzI2devNBz1zQrb", "Brian"],
  ["onwK4e9ZLuTAKqWW03F9", "Daniel"],
  ["pFZP5JQG7iQjIQuC4Bku", "Lily"],
  ["pqHfZKP75CvOlQylNhV4", "Bill"],
] as const;
export const DEFAULT_ELEVEN_VOICE = ELEVEN_VOICES[0][0];
export const ElevenInput = z.object({
  engine: z.literal("elevenlabs"),
  text: z.string().trim().min(1).max(MAX_SPEAK_CHARS),
  lang: z.enum([
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
  ]),
  voice: z.string().refine((v) => ELEVEN_VOICES.some(([id]) => id === v)),
  quality: z.enum(["best", "fast"]),
  pace: z.enum(PACES),
});
export type ElevenRequest = z.infer<typeof ElevenInput>;
export const ELEVEN_MODELS = { best: "eleven_v4", fast: "eleven_v4_turbo" } as const;
export function elevenBody(r: ElevenRequest) {
  return {
    text: r.text,
    model_id: ELEVEN_MODELS[r.quality],
    language_code: r.lang,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      speed: { slow: 0.8, normal: 1, fast: 1.15 }[r.pace],
    },
    enable_logging: false,
  };
}
export interface CharTiming {
  char: number;
  start: number;
  end: number;
}
const Alignment = z.object({
  characters: z.array(z.string().max(16)).max(10000),
  character_start_times_seconds: z.array(z.number().finite().nonnegative()).max(10000),
  character_end_times_seconds: z.array(z.number().finite().nonnegative()).max(10000),
});
const Packet = z.object({
  audio_base64: z.string().max(8 * 1024 * 1024),
  alignment: Alignment.nullable().optional(),
});
/** Incremental NDJSON; validation also covers cached/network-derived metadata. */
export function elevenParser() {
  let pending = "";
  let offset = 0;
  return (input: string, final = false) => {
    pending += input;
    if (pending.length > 12 * 1024 * 1024) throw new Error("provider");
    const lines = pending.split("\n");
    pending = final ? "" : (lines.pop() ?? "");
    const output: { audio: Uint8Array; timing: CharTiming[] }[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const p = Packet.parse(JSON.parse(line));
      const audio = base64ToBytes(p.audio_base64);
      const timing: CharTiming[] = [];
      const a = p.alignment;
      if (a) {
        if (
          a.characters.length !== a.character_start_times_seconds.length ||
          a.characters.length !== a.character_end_times_seconds.length
        )
          throw new Error("provider");
        a.characters.forEach((c, i) => {
          const start = a.character_start_times_seconds[i];
          const end = a.character_end_times_seconds[i];
          if (start === undefined || end === undefined || end < start) throw new Error("provider");
          timing.push({ char: offset, start, end });
          offset += c.length;
        });
      }
      output.push({ audio, timing });
    }
    return output;
  };
}
export function timedChar(timing: CharTiming[], seconds: number): number | undefined {
  let lo = 0,
    hi = timing.length - 1;
  if (hi < 0 || seconds < (timing[0]?.start ?? 0)) return undefined;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((timing[mid]?.start ?? Infinity) <= seconds) lo = mid;
    else hi = mid - 1;
  }
  return timing[lo]?.char;
}
