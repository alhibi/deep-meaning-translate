import { memo, useCallback, useEffect, useRef, useState } from "react";
import { notifyCopied } from "@/lib/clipboardHint";
import { BookOpen, Bookmark, Flag, Check, Copy, RotateCw, Share2, Volume2 } from "lucide-react";
import type { TranslationResult } from "@/lib/translation/types";
import { isRtl } from "@/lib/translation/languages";
import type { ErrorKind } from "@/lib/translation/useTranslator";
import { tick } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";
import { prefetchSpeech, speakTranslation, stopSpeaking } from "@/lib/tts";
import { PACE_RATE, getVoicePrefs, useVoicePrefs } from "@/lib/voice/prefs";
import { VoiceSheet } from "./VoiceSheet";
import { warmVoice } from "@/lib/voice/cloud";
import { StreamingText } from "./StreamingText";
import { SpokenText } from "./SpokenText";
import { estimateChar, tokenAt, tokenize } from "./streamingTokens";
import { ELEVEN_VOICES } from "@/lib/voice/elevenVoice";

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
  onLongPress,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  onLongPress?: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={
        onLongPress
          ? (e) => {
              e.preventDefault();
              onLongPress();
            }
          : undefined
      }
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
  const [noVoice, setNoVoice] = useState<false | "novoice" | "blocked">(false);
  const [spokenWord, setSpokenWord] = useState(0);
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [engineNote, setEngineNote] = useState<{
    engine: "elevenlabs" | "gemini" | "device";
    reason?: string | undefined;
  } | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const voicePrefs = useVoicePrefs();
  const voiceLang = result?.targetLanguage || target;
  const syncTimer = useRef<number | null>(null);
  const playback = useRef(0);
  const stopSync = () => {
    if (syncTimer.current !== null) cancelAnimationFrame(syncTimer.current);
    syncTimer.current = null;
  };
  const [announce, setAnnounce] = useState("");
  const text = result?.translation ?? "";
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    setShowAlt(false);
    setCopied(false);
    playback.current++;
    stopSpeaking();
    stopSync();
    setSpeaking(false);
  }, [text, voiceLang]);
  useEffect(
    () => () => {
      playback.current++;
      stopSync();
      stopSpeaking();
    },
    [],
  );

  // A settled translation may be listened to: open the path to the voice service (free, once).
  useEffect(() => {
    if (!text || provisional || pending || voicePrefs.engine === "device") return;
    if (voicePrefs.engine === "gemini") warmVoice();
    // Prepare the voice as soon as the translation settles, so Listen is instant.
    const id = setTimeout(() => prefetchSpeech(text, voiceLang, voicePrefs), 350);
    return () => clearTimeout(id);
  }, [text, provisional, pending, voiceLang, voicePrefs]);

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
  const stopRef = useRef<(() => void) | null>(null);
  const speak = useCallback(() => {
    if (speaking) {
      playback.current++;
      stopRef.current?.();
      stopRef.current = null;
      stopSync();
      setSpeaking(false);
      return;
    }
    const value = textRef.current;
    const tokens = tokenize(value);
    const rtlVoice = isRtl(lang);
    const prefs = getVoicePrefs();
    const generation = ++playback.current;
    const current = () => playback.current === generation;
    const rate = PACE_RATE[prefs.pace];
    // Read-along: exact word events when the voice sends them; otherwise an
    // estimate from speaking time since the current chunk began.
    let exact = false;
    let chunkAt = 0;
    let chunkOffset = 0;
    const tickEstimate = () => {
      if (!current()) return;
      if (!exact) {
        const c = chunkOffset + estimateChar(performance.now() - chunkAt, rate, rtlVoice);
        setSpokenWord(tokenAt(tokens, c));
      }
      syncTimer.current = exact ? null : requestAnimationFrame(tickEstimate);
    };
    setNoVoice(false);
    setSpokenWord(0);
    setVoiceStarted(false);
    setEngineNote(null);
    setSpeaking(true); // instant feedback; the glow starts with the voice
    stopRef.current = speakTranslation(
      value,
      lang,
      {
        onEngine: (engine, reason) => {
          if (!current()) return;
          setEngineNote({ engine, reason });
          exact = false;
          stopSync();
        },
        onStart: () => {
          if (!current()) return;
          setVoiceStarted(true);
          chunkAt = performance.now();
          stopSync();
          syncTimer.current = requestAnimationFrame(tickEstimate);
        },
        onWord: (ci, isExact) => {
          if (!current()) return;
          if (isExact) {
            exact = true;
            stopSync();
          } else {
            exact = false;
            chunkAt = performance.now();
            chunkOffset = ci;
            stopSync();
            syncTimer.current = requestAnimationFrame(tickEstimate);
          }
          setSpokenWord(tokenAt(tokens, ci));
        },
        onEnd: () => {
          if (!current()) return;
          stopSync();
          setSpeaking(false);
          stopRef.current = null;
        },
        onFail: (why) => {
          if (!current()) return;
          stopSync();
          setSpeaking(false);
          stopRef.current = null;
          setNoVoice(why === "novoice" ? "novoice" : "blocked");
          setTimeout(() => {
            if (current()) setNoVoice(false);
          }, 3200);
        },
      },
      prefs,
    );
  }, [lang, speaking]);

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
          {speaking && voiceStarted ? (
            <SpokenText text={text} current={spokenWord} />
          ) : (
            <StreamingText text={text} />
          )}
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
          <Action
            label={speaking ? t("stop") : t("listen")}
            onClick={speak}
            onLongPress={() => setVoiceOpen(true)}
            active={speaking}
          >
            <Volume2
              className={`size-[18px] ${speaking ? (voiceStarted ? "animate-breathe text-signal-text" : "animate-pulse text-signal-text") : ""}`}
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
        <p
          aria-live="polite"
          className="min-h-0 text-[12.5px] leading-relaxed text-muted-foreground"
        >
          {speaking && engineNote ? (
            <span className="animate-fade mt-2 flex flex-wrap items-center gap-x-2">
              <span aria-hidden className="size-1 shrink-0 rotate-45 bg-signal" />
              {engineNote.reason
                ? t(
                    (["quota", "offline", "paused", "config"].includes(engineNote.reason)
                      ? `vFb_${engineNote.reason}`
                      : "vFb_other") as Parameters<typeof t>[0],
                  )
                : !voiceStarted && engineNote.engine !== "device"
                  ? t("voicePreparing")
                  : null}
              <button
                type="button"
                onClick={() => setVoiceOpen(true)}
                className="press-soft text-faint underline decoration-border-strong underline-offset-4"
              >
                {engineNote.engine === "elevenlabs"
                  ? `ElevenLabs · ${ELEVEN_VOICES.find(([id]) => id === voicePrefs.elevenVoice)?.[1] ?? "Sarah"}`
                  : engineNote.engine === "gemini"
                    ? `Gemini · ${voicePrefs.voice}`
                    : t("vDevice")}
              </button>
            </span>
          ) : null}
          {noVoice ? (
            <span className="animate-fade mt-2 flex items-start gap-2">
              <span aria-hidden className="mt-[0.55em] size-1 shrink-0 rotate-45 bg-warning" />
              {noVoice === "novoice" ? t("noVoice") : t("voiceBlocked")}
            </span>
          ) : null}
        </p>
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
      <VoiceSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} />
    </div>
  );
});
