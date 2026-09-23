import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal typing for the browser's built-in speech recognition. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

function ctor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w["SpeechRecognition"] ?? w["webkitSpeechRecognition"] ?? null) as (new () => Recognition) | null;
}

const TAGS: Record<string, string> = {
  ar: "ar-SA", de: "de-DE", en: "en-US", fr: "fr-FR", es: "es-ES", it: "it-IT", tr: "tr-TR",
  fa: "fa-IR", ru: "ru-RU", uk: "uk-UA", pt: "pt-PT", nl: "nl-NL", pl: "pl-PL", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR",
};

/** Which language to listen for: the chosen source, or when detecting, the likely other side of the pair. */
export function speechLang(source: string, target: string, uiLocale: string): string {
  const code = source !== "auto" ? source : target === "ar" ? "de" : target === uiLocale ? "ar" : uiLocale;
  return TAGS[code] ?? code;
}

export type MicError = "denied" | "nospeech" | "failed" | null;

export function useSpeech(opts: { lang: string; onText: (text: string, final: boolean) => void; onDone: () => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<MicError>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(opts);
  cb.current = opts;

  useEffect(() => setSupported(!!ctor()), []);
  useEffect(() => () => rec.current?.abort(), []);

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    const C = ctor();
    if (!C || rec.current) return;
    const r = new C();
    r.lang = cb.current.lang;
    r.continuous = true;
    r.interimResults = true;
    let finals = "";
    let heard = false;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        if (res.isFinal) finals += res[0].transcript;
        else interim += res[0].transcript;
      }
      heard = true;
      cb.current.onText((finals + interim).trim(), !interim);
    };
    r.onerror = (e) => {
      setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : e.error === "no-speech" ? "nospeech" : e.error === "aborted" ? null : "failed");
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      if (heard) cb.current.onDone();
    };
    setError(null);
    try {
      r.start();
      rec.current = r;
      setListening(true);
    } catch {
      setError("failed");
    }
  }, []);

  return { supported, listening, error, start, stop, toggle: () => (rec.current ? stop() : start()) };
}
