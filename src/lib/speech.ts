import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal typing for the browser's built-in speech recognition. */
interface Alt { transcript: string; confidence?: number }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; length: number; [i: number]: Alt }> }) => void) | null;
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
  ku: "ku", ur: "ur-PK", hi: "hi-IN", el: "el-GR", sv: "sv-SE", ro: "ro-RO", he: "he-IL",
};
/** Arabic listening follows the chosen dialect so spoken dialect words are recognised. */
const AR_DIALECT: Record<string, string> = {
  levant: "ar-LB", egypt: "ar-EG", gulf: "ar-AE", iraq: "ar-IQ", maghreb: "ar-MA", msa: "ar-SA",
};

/** Which language to listen for: the chosen source, or when detecting, the likely other side of the pair. */
export function speechLang(source: string, target: string, uiLocale: string, dialect = "auto"): string {
  const code = source !== "auto" ? source : target === "ar" ? "de" : target === uiLocale ? "ar" : uiLocale;
  if (code === "ar" && AR_DIALECT[dialect]) return AR_DIALECT[dialect]!;
  return TAGS[code] ?? code;
}

/** Join recognised chunks cleanly: one space between, no doubled spaces. */
export function joinSpeech(...parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
}

export type MicError = "denied" | "nospeech" | "failed" | "nomic" | null;
type Perm = "granted" | "denied" | "prompt" | "unknown";

const TRANSIENT = new Set(["network", "audio-capture", "aborted-unexpectedly"]);
const MAX_RETRIES = 2;

export function useSpeech(opts: { lang: string; onText: (text: string, final: boolean) => void; onDone: () => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<MicError>(null);
  const [perm, setPerm] = useState<Perm>("unknown");
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(opts);
  cb.current = opts;
  // Session memory survives restarts, so a dropped connection never loses what was said.
  const said = useRef("");
  const wanted = useRef(false);
  const retries = useRef(0);
  const heard = useRef(false);

  useEffect(() => setSupported(!!ctor()), []);
  useEffect(() => () => { wanted.current = false; rec.current?.abort(); }, []);

  // Track microphone permission live where the browser allows it.
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const sync = () => status && setPerm(status.state as Perm);
    navigator.permissions?.query({ name: "microphone" as PermissionName })
      .then((s) => { status = s; sync(); s.addEventListener("change", sync); })
      .catch(() => {});
    return () => status?.removeEventListener("change", sync);
  }, []);
  useEffect(() => { if (perm === "granted" && error === "denied") setError(null); }, [perm, error]);

  const launch = useCallback(() => {
    const C = ctor();
    if (!C || rec.current) return;
    const r = new C();
    r.lang = cb.current.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    let finals = "";
    let failed: string | null = null;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const alt = res?.[0];
        if (!res || !alt) continue;
        if (res.isFinal) finals = joinSpeech(finals, alt.transcript);
        else interim = joinSpeech(interim, alt.transcript);
      }
      heard.current = true;
      retries.current = 0;
      cb.current.onText(joinSpeech(said.current, finals, interim), !interim);
    };
    r.onerror = (e) => {
      failed = e.error;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { wanted.current = false; setError("denied"); setPerm("denied"); }
      else if (e.error === "no-speech") setError(heard.current ? null : "nospeech");
      else if (e.error === "audio-capture") setError("nomic");
      else if (e.error !== "aborted") setError("failed");
    };
    r.onend = () => {
      rec.current = null;
      said.current = joinSpeech(said.current, finals);
      // Unexpected end while the user still wants to talk: quietly resume, keeping all text.
      const transient = failed === null || TRANSIENT.has(failed) || failed === "no-speech";
      if (wanted.current && transient && retries.current < MAX_RETRIES && failed !== "no-speech") {
        retries.current++;
        setTimeout(() => wanted.current && launch(), 250 * retries.current);
        return;
      }
      wanted.current = false;
      setListening(false);
      if (heard.current) cb.current.onDone();
    };
    try {
      r.start();
      rec.current = r;
      setListening(true);
    } catch {
      setError("failed");
      wanted.current = false;
      setListening(false);
    }
  }, []);

  /** Ask for the microphone once, clearly, before listening. */
  const ensureMic = useCallback(async (): Promise<boolean> => {
    if (perm === "granted") return true;
    if (perm === "denied") { setError("denied"); return false; }
    if (!navigator.mediaDevices?.getUserMedia) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      s.getTracks().forEach((t) => t.stop());
      setPerm("granted");
      return true;
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") { setError("denied"); setPerm("denied"); }
      else if (name === "NotFoundError") setError("nomic");
      else setError("failed");
      return false;
    }
  }, [perm]);

  const start = useCallback(async (resume = false) => {
    if (rec.current || starting) return;
    setError(null);
    if (!resume) said.current = "";
    heard.current = resume && !!said.current;
    retries.current = 0;
    setStarting(true);
    const ok = await ensureMic();
    setStarting(false);
    if (!ok) return;
    wanted.current = true;
    launch();
  }, [ensureMic, launch, starting]);

  const stop = useCallback(() => { wanted.current = false; rec.current?.stop(); }, []);

  return {
    supported, listening, starting, error, perm,
    start: () => start(false),
    /** Continue after a failure — earlier speech stays in place. */
    retry: () => start(true),
    stop,
    dismiss: () => setError(null),
    toggle: () => (rec.current || wanted.current ? stop() : start(false)),
  };
}
