import { useSyncExternalStore } from "react";
import { DEFAULT_ELEVEN_VOICE, ELEVEN_VOICES } from "./elevenVoice";
import {
  DEFAULT_VOICE,
  PACES,
  VOICE_NAMES,
  type GeminiVoice,
  type Pace,
  type VoiceQuality,
} from "./geminiVoice";

/** Device-only voice settings. Validated on read; damaged values fall back to defaults. */
export type VoiceEngine = "elevenlabs" | "gemini" | "device";
export interface VoicePrefs {
  engine: VoiceEngine;
  voice: GeminiVoice;
  quality: VoiceQuality;
  pace: Pace;
  elevenVoice: string;
}
const KEY = "lingua.voice.v2";
export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  engine: "elevenlabs",
  voice: DEFAULT_VOICE,
  quality: "best",
  pace: "normal",
  elevenVoice: DEFAULT_ELEVEN_VOICE,
};

export function parseVoicePrefs(v: unknown): VoicePrefs {
  const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    engine:
      p["engine"] === "device" ? "device" : p["engine"] === "gemini" ? "gemini" : "elevenlabs",
    elevenVoice: ELEVEN_VOICES.some(([id]) => id === p["elevenVoice"])
      ? String(p["elevenVoice"])
      : DEFAULT_ELEVEN_VOICE,
    voice: (VOICE_NAMES as readonly string[]).includes(p["voice"] as string)
      ? (p["voice"] as GeminiVoice)
      : DEFAULT_VOICE,
    quality: p["quality"] === "fast" ? "fast" : "best",
    pace: (PACES as readonly string[]).includes(p["pace"] as string)
      ? (p["pace"] as Pace)
      : "normal",
  };
}

let current: VoicePrefs | null = null;
const subs = new Set<() => void>();

export function getVoicePrefs(): VoicePrefs {
  if (current) return current;
  if (typeof window === "undefined") return DEFAULT_VOICE_PREFS;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) current = parseVoicePrefs(JSON.parse(saved));
    else {
      const old = parseVoicePrefs(JSON.parse(localStorage.getItem("lingua.voice.v1") ?? "null"));
      current = { ...old, engine: old.engine === "device" ? "device" : "elevenlabs" };
    }
  } catch {
    current = DEFAULT_VOICE_PREFS;
  }
  return current;
}

export function setVoicePrefs(patch: Partial<VoicePrefs>) {
  current = parseVoicePrefs({ ...getVoicePrefs(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage full or blocked: keep in memory */
  }
  subs.forEach((f) => f());
}

export function useVoicePrefs(): VoicePrefs {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getVoicePrefs,
    () => DEFAULT_VOICE_PREFS,
  );
}

export const PACE_RATE: Record<Pace, number> = { slow: 0.8, normal: 0.95, fast: 1.1 };
