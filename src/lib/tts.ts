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
}

// Module-level reference: Chrome otherwise collects the utterance and its events vanish.
let live: SpeechSynthesisUtterance | null = null;
let session = 0;

export function stopSpeaking() {
  session++;
  live = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Speak text in a language; returns a stop function. */
export function speak(text: string, lang: string, h: SpeakHandlers, rate = 0.95): () => void {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
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
        h.onFail?.(e.error === "language-unavailable" || e.error === "voice-unavailable" ? "novoice" : "blocked");
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
