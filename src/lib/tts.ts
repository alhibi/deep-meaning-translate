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

import { cloudAvailable, speechPieces, CloudSpeakError, getFeed, type Feed } from "./voice/cloud";
import { PcmPlayer, unlockAudio } from "./voice/pcmPlayer";
import { PACE_RATE, type VoicePrefs } from "./voice/prefs";
import { timedChar, ElevenInput } from "./voice/elevenVoice";
import { SpeakInput } from "./voice/geminiVoice";

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

/** Resume at the current word, never skip unplayed pieces already being generated. */
export function resumeWordOffset(text: string, char: number) {
  let offset = Math.min(text.length, Math.max(0, char));
  while (offset > 0 && !/\s/u.test(text.charAt(offset - 1))) offset--;
  return offset;
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
  onEngine?: (engine: VoicePrefs["engine"], reason?: string) => void;
}

// Module-level reference: Chrome otherwise collects the utterance and its events vanish.
let live: SpeechSynthesisUtterance | null = null;
let session = 0;

let raf = 0;
let stopCloud: (() => void) | null = null;
function stopAudio() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  stopCloud?.();
  stopCloud = null;
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
  let spokenChar = 0;
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

/** Rough speaking seconds per character, until real pieces teach the actual rate. */
function secPerChar(lang: string, pace: VoicePrefs["pace"]) {
  const base =
    lang === "ar" || lang === "fa" || lang === "ur" || lang === "he"
      ? 0.1
      : lang === "zh" || lang === "ja"
        ? 0.22
        : 0.055;
  return base * { slow: 1.3, normal: 1, fast: 0.85 }[pace];
}

function speechRequest(text: string, lang: string, prefs: VoicePrefs) {
  const common = { text, lang, quality: prefs.quality, pace: prefs.pace };
  return prefs.engine === "elevenlabs"
    ? ElevenInput.parse({ ...common, engine: "elevenlabs", voice: prefs.elevenVoice })
    : SpeakInput.parse({ ...common, voice: prefs.voice });
}

/**
 * Speak a translation: Gemini voice when enabled and available, streamed so it starts as
 * soon as the first audio arrives; the next piece is fetched while the current one plays,
 * and pieces join gaplessly. On any failure the device voice continues from the same place.
 * Returns a stop function.
 */
export function speakTranslation(
  text: string,
  lang: string,
  h: SpeakHandlers,
  prefs: VoicePrefs,
): () => void {
  const rate = PACE_RATE[prefs.pace];
  const ctx = prefs.engine !== "device" && cloudAvailable(prefs.engine) ? unlockAudio() : null;
  if (!ctx) {
    h.onEngine?.(
      "device",
      prefs.engine === "device"
        ? undefined
        : typeof navigator !== "undefined" && navigator.onLine === false
          ? "offline"
          : "paused",
    );
    return speak(text, lang, h, rate);
  }
  stopSpeaking();
  const id = session;
  const alive = () => id === session;
  const pieces = speechPieces(text, chunkText);
  const feeds: (Feed | undefined)[] = [];
  const feed = (i: number) => {
    if (i >= pieces.length) return undefined;
    const piece = pieces[i];
    if (!piece) return undefined;
    feeds[i] ??= getFeed(speechRequest(piece.text, lang, prefs));
    return feeds[i];
  };
  const player = new PcmPlayer(ctx);
  // Timeline: where each piece starts/ends in the audio, to map playback onto characters.
  const starts: number[] = [];
  const ends: number[] = [];
  let started = false;
  let deviceStop: (() => void) | null = null;
  h.onEngine?.(prefs.engine);

  player.onStart = () => {
    if (!alive()) return;
    if (!started) {
      started = true;
      h.onStart?.();
    }
    const tickFn = () => {
      if (!alive()) return;
      const pos = player.position;
      let i = 0;
      while (i + 1 < starts.length && (starts[i + 1] ?? Infinity) <= pos) i++;
      const p = pieces[i];
      if (!p) return;
      const aligned = timedChar(feeds[i]?.timing ?? [], pos - (starts[i] ?? 0));
      if (aligned !== undefined) {
        spokenChar = p.offset + aligned;
        h.onWord?.(spokenChar, true);
        raf = requestAnimationFrame(tickFn);
        return;
      }
      // Learned rate from finished pieces, else a per-language estimate.
      let spc = secPerChar(lang, prefs.pace);
      const doneChars = ends.reduce((n, _e, k) => n + (pieces[k]?.text.length ?? 0), 0);
      if (ends.length && doneChars > 0) spc = (ends[ends.length - 1] ?? 0) / doneChars;
      const dur =
        ends[i] !== undefined
          ? (ends[i] ?? 0) - (starts[i] ?? 0)
          : Math.max(player.queuedSeconds - (starts[i] ?? 0), p.text.length * spc);
      const frac = Math.min(1, Math.max(0, (pos - (starts[i] ?? 0)) / dur));
      spokenChar = p.offset + Math.floor(frac * p.text.length * 0.97);
      h.onWord?.(spokenChar, true);
      raf = requestAnimationFrame(tickFn);
    };
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tickFn);
  };

  const fallback = (_from: number, err: unknown) => {
    if (!alive()) return;
    player.stop();
    if (raf) cancelAnimationFrame(raf);
    const kind = err instanceof CloudSpeakError ? err.kind : "provider";
    h.onEngine?.("device", kind);
    const offset = resumeWordOffset(text, spokenChar);
    deviceStop = speak(
      text.slice(offset),
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

  stopCloud = () => {
    player.stop();
  };

  void (async () => {
    try {
      for (let i = 0; i < pieces.length; i++) {
        const f = feed(i);
        if (!f) return;
        feed(i + 1); // pipeline: the next piece generates while this one plays
        starts[i] = player.queuedSeconds;
        try {
          for (let c = 0; ; c++) {
            const chunk = await f.next(c);
            if (!alive()) return;
            if (!chunk) break;
            player.push(chunk);
          }
        } catch (e) {
          // Resume from the audible word, not the failed prefetch piece.
          fallback(i, e);
          return;
        }
        ends[i] = player.queuedSeconds;
      }
      await player.finish();
      if (!alive()) return;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      stopCloud = null;
      h.onEnd?.();
    } catch (e) {
      fallback(0, e);
    }
  })();

  return () => {
    if (deviceStop) deviceStop();
    if (alive()) stopSpeaking();
  };
}

/**
 * Prepare a settled translation's voice in the background so Listen plays instantly.
 * Every piece is requested; a later tap joins the running streams or hits the cache.
 */
export function prefetchSpeech(text: string, lang: string, prefs: VoicePrefs) {
  if (prefs.engine === "device" || !text.trim() || !cloudAvailable(prefs.engine)) return;
  try {
    for (const p of speechPieces(text, chunkText)) getFeed(speechRequest(p.text, lang, prefs));
  } catch {
    /* An unsupported/stale language must never crash the translation canvas. */
  }
}
