import { memo, useCallback, useEffect, useRef, useState } from "react";
import { notifyCopied } from "@/lib/clipboardHint";
import { BookOpen, Bookmark, Flag, Check, Copy, RotateCw, Share2, Volume2 } from "lucide-react";
import type { TranslationResult } from "@/lib/translation/types";
import { isRtl } from "@/lib/translation/languages";
import type { ErrorKind } from "@/lib/translation/useTranslator";
import { tick } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";
import { StreamingText } from "./StreamingText";

const LOCALE: Record<string, string> = {
  ar: "ar-SA",
  de: "de-DE",
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  tr: "tr-TR",
};

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
  if (len < 60)
    return rtl ? "text-[32px] leading-[1.6]" : "text-[30px] leading-[1.25] tracking-[-0.02em]";
  if (len < 220)
    return rtl ? "text-[26px] leading-[1.7]" : "text-[24px] leading-[1.35] tracking-[-0.015em]";
  return rtl ? "text-[21px] leading-[1.8]" : "text-[19px] leading-[1.5]";
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
  isSaved,
  onSave,
  suggestion,
  idle,
  onDictionary,
  dictionaryReady,
  onFlag,
  flagLabel,
}: {
  result: TranslationResult | null;
  pending: boolean;
  provisional: boolean;
  error: ErrorKind | null;
  target: string;
  onRetry: () => void;
  isSaved?: boolean;
  onSave?: () => void;
  /** Quiet one-tap style suggestion from the detected situation. */
  suggestion?: { label: string; onApply: () => void; onDismiss: () => void } | null;
  /** Shown in place of the idle hint (e.g. phrase of the day). */
  idle?: React.ReactNode;
  /** Opens the mini dictionary; omitted when the text isn't a word/term. */
  onDictionary?: (() => void) | undefined;
  dictionaryReady?: boolean;
  /** Opens the "inaccurate" marking window. */
  onFlag?: () => void;
  flagLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();
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
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [text]);

  // Screen readers hear settled results only — never every realtime refinement.
  useEffect(() => {
    if (!text || provisional || pending) return;
    const id = setTimeout(() => setAnnounce(t("ready")), 1200);
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
      notifyCopied();
      tick();
    };
    const fallback = () => {
      // Plain-text fallback: exact characters and line breaks, no formatting.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0;top:0";
      document.body.appendChild(ta);
      ta.select();
      if (document.execCommand("copy")) done();
      ta.remove();
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value).then(done, fallback);
    } else fallback();
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
            rtl ? "font-arabic font-medium" : "font-medium"
          } ${sizeFor(text.length, rtl)} ${pending ? "opacity-60" : provisional ? "opacity-80" : "opacity-100"}`}
        >
          <StreamingText text={text} />
        </p>

        {result.isAmbiguous && result.alternativeTranslations.length > 0 ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowAlt((v) => !v)}
              aria-expanded={showAlt}
              className="press-soft text-[12px] text-muted-foreground underline decoration-border-strong underline-offset-4"
            >
              {showAlt ? t("hideAlt") : t("showAlt")}
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

        {suggestion && !provisional && !pending ? (
          <div className="animate-fade mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span aria-hidden className="size-1 rotate-45 bg-signal" />
              {suggestion.label}
            </span>
            <button
              type="button"
              onClick={suggestion.onApply}
              className="press-soft font-medium text-signal-text underline decoration-signal/40 underline-offset-4"
            >
              {t("sit_apply")}
            </button>
            <button type="button" onClick={suggestion.onDismiss} className="press-soft text-faint">
              {t("sit_dismiss")}
            </button>
          </div>
        ) : null}

        {result.notes && result.confidence < 0.75 ? (
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{result.notes}</p>
        ) : null}

        <div
          className={`-ms-0.5 mt-5 flex items-center transition-[opacity,transform] duration-300 ${
            provisional || pending
              ? "pointer-events-none translate-y-1 opacity-0"
              : "translate-y-0 opacity-100"
          }`}
        >
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? t("copied") : t("copy")}
            className={`press me-2 inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors duration-200 ${
              copied ? "bg-card text-success" : "bg-signal text-signal-foreground"
            }`}
          >
            <span className="relative grid size-4 place-items-center">
              <Copy
                className={`swap-icon size-4 ${copied ? "scale-75 opacity-0" : "opacity-100"}`}
                strokeWidth={1.8}
              />
              <Check
                className={`swap-icon absolute size-4 ${copied ? "opacity-100" : "scale-75 opacity-0"}`}
                strokeWidth={2.2}
              />
            </span>
            {copied ? t("copied") : t("copyShort")}
          </button>
          <Action label={speaking ? t("stop") : t("listen")} onClick={speak} active={speaking}>
            <Volume2
              className={`size-[18px] ${speaking ? "animate-breathe text-signal-text" : ""}`}
              strokeWidth={1.75}
            />
          </Action>
          {onSave ? (
            <Action
              label={isSaved ? t("unsave") : t("save")}
              onClick={() => {
                onSave();
                tick();
              }}
              active={!!isSaved}
            >
              <Bookmark
                className={`size-[18px] transition-transform duration-200 ${isSaved ? "scale-110 fill-signal text-signal" : ""}`}
                strokeWidth={1.75}
              />
            </Action>
          ) : null}
          <Action label={t("share")} onClick={share}>
            <Share2 className="size-[18px]" strokeWidth={1.75} />
          </Action>
          {onDictionary ? (
            <Action label={t("lexOpen")} onClick={onDictionary}>
              <BookOpen className="size-[18px]" strokeWidth={1.75} />
              {dictionaryReady ? (
                <span
                  aria-hidden
                  className="absolute end-2.5 top-2.5 size-1.5 rounded-full bg-signal"
                />
              ) : null}
            </Action>
          ) : null}
          {onFlag ? (
            <Action label={flagLabel ?? "Inaccurate"} onClick={onFlag}>
              <Flag className="size-[18px]" strokeWidth={1.75} />
            </Action>
          ) : null}
          <span
            aria-live="polite"
            className={`ms-1 text-[12px] ${noVoice ? "text-muted-foreground" : "text-success"} transition-[opacity,transform] duration-200 ${
              copied || noVoice ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0"
            }`}
          >
            {noVoice ? "" : ""}
          </span>
          {error ? (
            <button
              type="button"
              onClick={onRetry}
              title={error === "offline" ? t("err_offline") : undefined}
              className="press-soft animate-fade ms-auto inline-flex whitespace-nowrap items-center gap-1.5 text-[12px] text-muted-foreground"
            >
              <RotateCw className="size-3" strokeWidth={1.75} />
              {error === "offline" ? t("offline") : t("retry")}
            </button>
          ) : null}
        </div>
      </div>
    );
  } else if (error) {
    body = (
      <div key="error" className="animate-rise">
        <p className="flex items-start gap-2.5 text-[15px] leading-relaxed text-muted-foreground">
          <span
            aria-hidden
            className={`mt-[0.6em] size-1.5 shrink-0 rounded-full ${error === "offline" || error === "rate" || error === "timeout" ? "bg-warning" : "bg-destructive"}`}
          />
          {t(`err_${error}`)}
        </p>
        {error !== "auth" ? (
          <button
            type="button"
            onClick={onRetry}
            className="press ms-4 mt-3 inline-flex items-center gap-2 rounded-full bg-signal px-4 py-2 text-[13px] font-medium text-signal-foreground"
          >
            <RotateCw className="size-3.5" strokeWidth={1.75} /> {t("tryAgain")}
          </button>
        ) : null}
      </div>
    );
  } else if (pending) {
    body = <Skeleton key="pending" />;
  } else {
    body = idle ? (
      <div key="idle-extra" className="animate-fade">
        {idle}
      </div>
    ) : (
      <p key="idle" className="animate-fade text-[15px] text-faint">
        {t("idle")}
      </p>
    );
  }

  return (
    <div className="relative min-h-[200px] px-5 pb-5 pt-5" aria-busy={pending}>
      {body}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
});
