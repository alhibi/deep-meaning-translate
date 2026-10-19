/**
 * Device text-to-speech (free, on-device Web Speech API), hardened for the
 * browsers that misbehave:
 * - Voices load late (Chrome/Android return [] at first) → wait for them.
 * - Android reports locales as "de_DE" → normalise before matching.
 * - Chrome garbage-collects an utterance mid-speech and drops its events → keep a reference.
 * - Chrome stops long utterances after ~15 s → speak sentence-sized chunks in order.
 * - speak() right after cancel() is silently dropped on Android → small gap.
 * - Some engines never fire onstart → a watchdog retries once without a fixed voice, then reports failure.
 * Word events (onboundary) give exact read-along timing; their offsets are mapped
 * back to the full text across chunks.
 */

import {
  cloudAvailable,
  fetchClip,
  silentClip,
  speechPieces,
  CloudSpeakError,
} from "./voice/cloud";
import { PACE_RATE, type VoicePrefs } from "./voice/prefs";

export const LOCALE: Record<string, string> = {
  ar: "ar-SA",
  de: "de-DE",
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  tr: "tr-TR",
  it: "it-IT",
  nl: "nl-NL",
  pt: "pt-PT",
  ru: "ru-RU",
  fa: "fa-IR",
  he: "he-IL",
  ur: "ur-PK",
  zh: "zh-CN",
  ja: "ja-JP",
};

export const normLang = (l: string) => l.replace(/_/g, "-").toLowerCase();

type VoiceLike = Pick<SpeechSynthesisVoice, "lang" | "localService" | "name">;

/** Best voice for a language: exact locale + on-device first, then any of that language. */
export function pickVoice<V extends VoiceLike>(voices: V[], lang: string): V | undefined {
  const base = lang.toLowerCase().slice(0, 2);
  const matches = voices.filter((v) => normLang(v.lang).split("-")[0] === base);
  const preferred = (LOCALE[base] ?? "").toLowerCase();
  return (
    matches.find((v) => normLang(v.lang) === preferred && v.localService) ??
    matches.find((v) => normLang(v.lang) === preferred) ??
    matches.find((v) => v.localService) ??
    matches[0]
  );
}

/** Split into ≤ max-char pieces at sentence, then clause, then word boundaries, keeping offsets. */
export function chunkText(text: string, max = 180): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + max);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const cut =
        Math.max(...[".", "!", "?", "؟", "…", "\n"].map((c) => slice.lastIndexOf(c))) + 1 ||
        Math.max(...[",", "،", ";", "؛", ":"].map((c) => slice.lastIndexOf(c))) + 1 ||
        slice.lastIndexOf(" ") + 1;
      if (cut > max * 0.3) end = start + cut;
    }
    const piece = text.slice(start, end);
    if (piece.trim()) out.push({ text: piece, offset: start });
    start = end;
  }
  return out;
}

function voicesReady(synth: SpeechSynthesis, timeout = 1500): Promise<SpeechSynthesisVoice[]> {
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      synth.removeEventListener?.("voiceschanged", done);
      resolve(synth.getVoices());
    };
    const t = setTimeout(done, timeout);
    synth.addEventListener?.("voiceschanged", done);
  });
}

export type SpeakFailure = "unsupported" | "novoice" | "blocked";

export interface SpeakHandlers {
  onStart?: () => void;
  /**
   * Character offset (in the full text) of the word being spoken now.
   * exact = reported by the voice; false = only the start of a new chunk.
   */
  onWord?: (charIndex: number, exact: boolean) => void;
  onEnd?: () => void;
  onFail?: (why: SpeakFailure) => void;
  /** Which engine is speaking; reason is set when Gemini was skipped or failed. */
  onEngine?: (engine: "gemini" | "device", reason?: string) => void;
}

// Module-level reference: Chrome otherwise collects the utterance and its events vanish.
let live: SpeechSynthesisUtterance | null = null;
let session = 0;

let audioEl: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let raf = 0;
function stopAudio() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (audioEl) {
    audioEl.onended = audioEl.onerror = audioEl.onplaying = null;
    audioEl.pause();
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
}

export function stopSpeaking() {
  session++;
  live = null;
  stopAudio();
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Speak text in a language; returns a stop function. */
export function speak(text: string, lang: string, h: SpeakHandlers, rate = 0.95): () => void {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance === "undefined"
  ) {
    h.onFail?.("unsupported");
    return () => {};
  }
  const synth = window.speechSynthesis;
  const id = ++session;
  const alive = () => id === session;
  const chunks = chunkText(text);
  let started = false;
  let retried = false;

  const run = async (useVoice: boolean) => {
    const voices = await voicesReady(synth);
    if (!alive()) return;
    const voice = useVoice ? pickVoice(voices, lang) : undefined;
    // No listed voice for the language: still try by locale — many engines
    // (Google TTS on Android) speak languages they don't list.
    if (synth.speaking || synth.pending) {
      synth.cancel();
      await new Promise((r) => setTimeout(r, 80));
      if (!alive()) return;
    }
    if (synth.paused) synth.resume();

    let i = 0;
    const next = () => {
      if (!alive()) return;
      const c = chunks[i];
      if (!c) {
        live = null;
        h.onEnd?.();
        return;
      }
      const u = new SpeechSynthesisUtterance(c.text);
      u.lang = voice?.lang ?? LOCALE[lang] ?? lang;
      if (voice) u.voice = voice;
      u.rate = rate;
      u.onstart = () => {
        if (!alive()) return;
        if (!started) {
          started = true;
          h.onStart?.();
        }
        h.onWord?.(c.offset, false);
      };
      u.onboundary = (e) => {
        if (!alive() || (e.name && e.name !== "word")) return;
        h.onWord?.(c.offset + e.charIndex, true);
      };
      u.onend = () => {
        i++;
        next();
      };
      u.onerror = (e) => {
        if (!alive()) return;
        if (e.error === "interrupted" || e.error === "canceled") return;
        if (!started && !retried) return; // the watchdog decides
        session++;
        live = null;
        h.onFail?.(
          e.error === "language-unavailable" || e.error === "voice-unavailable"
            ? "novoice"
            : "blocked",
        );
      };
      live = u;
      synth.speak(u);
    };
    next();

    // Watchdog: nothing started within 2.5 s.
    setTimeout(() => {
      if (!alive() || started) return;
      if (synth.speaking) {
        // Speaking but the engine never announced it: run the read-along anyway.
        started = true;
        h.onStart?.();
        return;
      }
      if (!retried && voice) {
        retried = true;
        synth.cancel();
        void run(false);
        return;
      }
      session++;
      live = null;
      synth.cancel();
      h.onFail?.(voices.length > 0 && !pickVoice(voices, lang) ? "novoice" : "blocked");
    }, 2500);
  };
  void run(true);
  return () => {
    if (alive()) stopSpeaking();
  };
}

/** Keeps the reference observable for tests. */
export const _liveUtterance = () => live;

/**
 * Speak a translation: Gemini voice when enabled and available, otherwise (or on any
 * failure) the device voice continues from the same place. Returns a stop function.
 */
export function speakTranslation(
  text: string,
  lang: string,
  h: SpeakHandlers,
  prefs: VoicePrefs,
): () => void {
  const rate = PACE_RATE[prefs.pace];
  if (
    prefs.engine === "device" ||
    typeof window === "undefined" ||
    typeof Audio === "undefined" ||
    !cloudAvailable()
  ) {
    h.onEngine?.(
      "device",
      prefs.engine === "device" ? undefined : navigator.onLine === false ? "offline" : "paused",
    );
    return speak(text, lang, h, rate);
  }
  stopSpeaking();
  const id = session;
  const alive = () => id === session;
  // Unlock playback inside the tap (mobile autoplay rules), before any await.
  audioEl ??= new Audio();
  const el = audioEl;
  el.src = silentClip();
  void el.play().catch(() => undefined);

  const pieces = speechPieces(text, chunkText);
  const req = (i: number) => ({
    text: pieces[i]!.text,
    lang,
    voice: prefs.voice,
    quality: prefs.quality,
    pace: prefs.pace,
  });
  let started = false;
  let deviceStop: (() => void) | null = null;
  h.onEngine?.("gemini");

  const fallback = (from: number, err: unknown) => {
    if (!alive()) return;
    stopAudio();
    const kind = err instanceof CloudSpeakError ? err.kind : "provider";
    h.onEngine?.("device", kind);
    const offset = pieces[from]?.offset ?? 0;
    const restText = text.slice(offset);
    // Continue with the device voice from the unspoken part, keeping offsets in the full text.
    deviceStop = speak(
      restText,
      lang,
      {
        onStart: () => {
          if (!started) {
            started = true;
            h.onStart?.();
          }
        },
        onWord: (ci, exact) => h.onWord?.(offset + ci, exact),
        onEnd: () => h.onEnd?.(),
        onFail: (why) => h.onFail?.(why),
      },
      rate,
    );
  };

  const play = async (i: number) => {
    if (!alive()) return;
    const piece = pieces[i];
    if (!piece) {
      stopAudio();
      h.onEnd?.();
      return;
    }
    let blob: Blob;
    try {
      blob = await fetchClip(req(i));
    } catch (e) {
      fallback(i, e);
      return;
    }
    if (!alive()) return;
    if (pieces[i + 1]) void fetchClip(req(i + 1)).catch(() => undefined); // prefetch the next piece
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(blob);
    el.src = audioUrl;
    el.onplaying = () => {
      if (!alive()) return;
      if (!started) {
        started = true;
        h.onStart?.();
      }
      // Read-along: position in the clip mapped onto the characters of this piece.
      const tickFn = () => {
        if (!alive()) return;
        const d = el.duration;
        if (d && Number.isFinite(d)) {
          const frac = Math.min(1, el.currentTime / d);
          h.onWord?.(piece.offset + Math.floor(frac * piece.text.length * 0.97), true);
        }
        raf = requestAnimationFrame(tickFn);
      };
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tickFn);
    };
    el.onended = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      void play(i + 1);
    };
    el.onerror = () => fallback(i, new CloudSpeakError("provider"));
    try {
      await el.play();
    } catch (e) {
      if (!alive()) return;
      fallback(i, (e as Error)?.name === "NotAllowedError" ? new CloudSpeakError("provider") : e);
    }
  };
  void play(0);
  return () => {
    if (deviceStop) deviceStop();
    if (alive()) stopSpeaking();
  };
}
