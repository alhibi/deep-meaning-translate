import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, RotateCw, Share2, Volume2 } from "lucide-react";
import type { TranslationResult } from "@/lib/translation/types";
import { isRtl } from "@/lib/translation/languages";
import type { ErrorKind } from "@/lib/translation/useTranslator";
import { tick } from "@/lib/haptics";

const ERROR_COPY: Record<ErrorKind, string> = {
  auth: "Translation isn't connected yet.",
  quota: "The translation account is out of credit.",
  rate: "A lot of requests at once. Give it a moment.",
  network: "The connection dropped before the translation finished.",
  timeout: "That took too long. Your text is still here.",
  offline: "You're offline. Your text is safe — translation resumes when you're back.",
  provider: "Something interrupted the translation.",
  input: "That text couldn't be translated as written.",
};

const LOCALE: Record<string, string> = { ar: "ar-SA", de: "de-DE", en: "en-US", fr: "fr-FR", es: "es-ES", tr: "tr-TR" };

/** Prefer a local, high-quality voice for the exact language; fall back gracefully. */
function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const matches = voices.filter((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
  const preferred = LOCALE[lang]?.toLowerCase();
  return (
    matches.find((v) => v.lang.toLowerCase() === preferred && v.localService) ??
    matches.find((v) => v.lang.toLowerCase() === preferred) ??
    matches.find((v) => v.localService) ??
    matches[0]
  );
}

/** Scale the hero text by length so short phrases feel weighty and long text stays readable. */
function sizeFor(len: number, rtl: boolean) {
  if (len < 70) return rtl ? "text-[27px] leading-[1.7]" : "text-[30px] leading-[1.25]";
  if (len < 220) return rtl ? "text-[22px] leading-[1.75]" : "text-[24px] leading-[1.32]";
  return rtl ? "text-[18px] leading-[1.85]" : "text-[20px] leading-[1.45]";
}

function Action({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="press relative grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground aria-pressed:text-foreground"
    >
      {children}
    </button>
  );
}

function Skeleton() {
  return (
    <div aria-hidden className="animate-fade space-y-3 pt-2">
      <div className="shimmer h-[18px] w-[78%] rounded-full" />
      <div className="shimmer h-[18px] w-[52%] rounded-full" />
    </div>
  );
}

export const ResultPanel = memo(function ResultPanel({
  result,
  pending,
  provisional,
  error,
  target,
  onRetry,
}: {
  result: TranslationResult | null;
  pending: boolean;
  provisional: boolean;
  error: ErrorKind | null;
  target: string;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showAlt, setShowAlt] = useState(false);
  const [noVoice, setNoVoice] = useState(false);
  const [announce, setAnnounce] = useState("");
  const text = result?.translation ?? "";
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    setShowAlt(false);
    setCopied(false);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [text]);

  // Screen readers hear settled results only — never every realtime refinement.
  useEffect(() => {
    if (!text || provisional || pending) return;
    const id = setTimeout(() => setAnnounce("Translation ready"), 1200);
    return () => {
      clearTimeout(id);
      setAnnounce("");
    };
  }, [text, provisional, pending]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = useCallback(() => {
    const value = textRef.current;
    const done = () => {
      setCopied(true);
      tick();
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value).then(done, () => undefined);
    }
  }, []);

  const lang = result?.targetLanguage || target;
  const speak = useCallback(() => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    if (synth.speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const voice = pickVoice(lang);
    if (!voice && synth.getVoices().length > 0) {
      setNoVoice(true);
      setTimeout(() => setNoVoice(false), 2200);
      return;
    }
    const u = new SpeechSynthesisUtterance(textRef.current);
    u.lang = voice?.lang ?? LOCALE[lang] ?? lang;
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onend = u.onerror = () => setSpeaking(false);
    synth.speak(u);
    setSpeaking(true);
  }, [lang]);

  const share = useCallback(() => {
    if (navigator.share) void navigator.share({ text: textRef.current }).catch(() => undefined);
    else copy();
  }, [copy]);

  const rtl = isRtl(lang);

  let body: React.ReactNode;
  if (result) {
    body = (
      <div key="result" className="animate-reveal">
        <p
          dir={rtl ? "rtl" : "ltr"}
          lang={lang}
          className={`result-text whitespace-pre-wrap text-start transition-opacity duration-300 ${
            rtl ? "font-arabic" : "font-display tracking-[-0.01em]"
          } ${sizeFor(text.length, rtl)} ${pending ? "opacity-55" : provisional ? "opacity-80" : "opacity-100"}`}
        >
          {text}
        </p>

        {result.isAmbiguous && result.alternativeTranslations.length > 0 ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowAlt((v) => !v)}
              aria-expanded={showAlt}
              className="press-soft text-[12px] text-muted-foreground underline decoration-border-strong underline-offset-4"
            >
              {showAlt ? "Hide other reading" : "This could also mean…"}
            </button>
            {showAlt ? (
              <ul className="animate-rise mt-2 space-y-2 border-s border-border ps-3">
                {result.alternativeTranslations.map((alt) => (
                  <li
                    key={alt}
                    dir={rtl ? "rtl" : "ltr"}
                    lang={lang}
                    className="result-text text-start text-[15px] leading-relaxed text-muted-foreground"
                  >
                    {alt}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {result.notes && result.confidence < 0.75 ? (
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{result.notes}</p>
        ) : null}

        <div className="animate-reveal-late -ms-3 mt-3 flex items-center">
          <Action label={copied ? "Copied" : "Copy translation"} onClick={copy}>
            <Copy
              className={`swap-icon size-[18px] ${copied ? "scale-75 opacity-0" : "opacity-100"}`}
              strokeWidth={1.75}
            />
            <Check
              className={`swap-icon absolute size-[18px] text-accent ${
                copied ? "opacity-100" : "scale-75 opacity-0"
              }`}
              strokeWidth={2}
            />
          </Action>
          <Action label={speaking ? "Stop" : "Listen"} onClick={speak} active={speaking}>
            <Volume2
              className={`size-[18px] ${speaking ? "animate-breathe text-accent" : ""}`}
              strokeWidth={1.75}
            />
          </Action>
          <Action label="Share" onClick={share}>
            <Share2 className="size-[18px]" strokeWidth={1.75} />
          </Action>
          <span
            aria-live="polite"
            className={`ms-1 text-[12px] ${noVoice ? "text-muted-foreground" : "text-accent"} transition-[opacity,transform] duration-200 ${
              copied || noVoice ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0"
            }`}
          >
            {copied ? "Copied" : ""}
          </span>
          {error ? (
            <button
              type="button"
              onClick={onRetry}
              title={error === "offline" ? ERROR_COPY.offline : undefined} className="press-soft animate-fade ms-auto inline-flex whitespace-nowrap items-center gap-1.5 text-[12px] text-muted-foreground"
            >
              <RotateCw className="size-3" strokeWidth={1.75} />
              {error === "offline" ? "Offline" : "Retry"}
            </button>
          ) : null}
        </div>
      </div>
    );
  } else if (error) {
    body = (
      <div key="error" className="animate-rise">
        <p className="text-[15px] leading-relaxed text-muted-foreground">{ERROR_COPY[error]}</p>
        {error !== "auth" ? (
          <button
            type="button"
            onClick={onRetry}
            className="press mt-3 inline-flex items-center gap-2 rounded-full border border-border-strong px-4 py-2 text-[13px]"
          >
            <RotateCw className="size-3.5" strokeWidth={1.75} /> Try again
          </button>
        ) : null}
      </div>
    );
  } else if (pending) {
    body = <Skeleton key="pending" />;
  } else {
    body = (
      <p key="idle" className="animate-fade text-[15px] text-muted-foreground/70">
        Translation appears here.
      </p>
    );
  }

  return (
    <div className="relative min-h-[176px] px-5 pb-4 pt-5" aria-busy={pending}>
      <div
        aria-hidden
        className={`progress-line absolute inset-x-0 top-0 transition-opacity duration-300 ${
          pending ? "opacity-100" : "opacity-0"
        }`}
      />
      {body}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
});
