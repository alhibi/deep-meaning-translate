import { memo, useCallback, useEffect, useRef, useState } from "react";
import { notifyCopied } from "@/lib/clipboardHint";
import { BookOpen, Bookmark, Check, Contrast, Copy, RotateCw, Volume2 } from "lucide-react";
import type { Loss } from "@/lib/translation/shadow";
import { ShadowHits, ShadowInk } from "./SentenceShadow";
import type { TranslationResult } from "@/lib/translation/types";
import { isRtl } from "@/lib/translation/languages";
import type { ErrorKind } from "@/lib/translation/useTranslator";
import { feel } from "@/lib/feel";
import { useI18n } from "@/lib/i18n";
import { speakTranslation, stopSpeaking } from "@/lib/tts";
import { PACE_RATE, getVoicePrefs, useVoicePrefs } from "@/lib/voice/prefs";
import { VoiceSheet } from "./VoiceSheet";
import { warmVoice } from "@/lib/voice/cloud";
import { StreamingText } from "./StreamingText";
import { SpokenText } from "./SpokenText";
import { estimateChar, tokenAt, tokenize } from "./streamingTokens";
import { ELEVEN_VOICES } from "@/lib/voice/elevenVoice";

function Action({
  label,
  onClick,
  onLongPress,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  onLongPress?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
  stale = false,
  streaming = provisional,
  error,
  target,
  onRetry,
  isSaved,
  onSave,
  suggestion,
  idle,
  onDictionary,
  dictionaryReady,
  shadow,
  shadowSummary,
  shadowOn,
  onToggleShadow,
}: {
  result: TranslationResult | null;
  pending: boolean;
  provisional: boolean;
  /** The visible reading belongs to an earlier draft, not the current source. */
  stale?: boolean;
  /** True only while provider words are actually arriving (not the settling pause). */
  streaming?: boolean;
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
  /** Sentence shadow over the settled translation (null hides it). */
  shadow?: { losses: Loss[]; focusId: string | null; onPick: (id: string) => void } | null;
  shadowSummary?: React.ReactNode;
  shadowOn?: boolean;
  onToggleShadow?: () => void;
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
  const unavailable = provisional || pending || stale;
  const textRef = useRef(text);
  // eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered
  textRef.current = text;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
    setShowAlt(false);
    setCopied(false);
    playback.current++;
    stopSpeaking();
    stopSync();
    setSpeaking(false);
    setNoVoice(false);
    setVoiceStarted(false);
    setEngineNote(null);
  }, [text, voiceLang, unavailable]);
  useEffect(
    () => () => {
      playback.current++;
      stopSync();
      stopSpeaking();
    },
    [],
  );

  // A settled translation may be listened to: warm the free connection path, but never
  // synthesize audio or spend a provider request until the person presses Listen.
  useEffect(() => {
    if (!text || unavailable || voicePrefs.engine === "device") return;
    // Never synthesize before the person has touched this page: a restored session
    // would otherwise spend a speech request on audio nobody asked to hear.
    if (!navigator.userActivation?.hasBeenActive) return;
    if (voicePrefs.engine === "gemini") warmVoice();
  }, [text, unavailable, voiceLang, voicePrefs]);

  /**
   * The signature moment: a live stream becoming a settled answer.
   *
   * It fires on the *transition*, not on the state. That distinction is the whole
   * design: a session restored from storage opens already settled, and nothing arrived
   * there, so it must stay silent — while the moment a provisional stream hardens into
   * a final translation is exactly when the app should say "here it is" in the hand.
   * A realtime refinement therefore never counts, and a reload never counts.
   */
  const wasLive = useRef(false);
  useEffect(() => {
    const live = !text || unavailable || !!error;
    if (wasLive.current && !live) feel.arrive();
    wasLive.current = live;
  }, [text, unavailable, error]);

  // Screen readers hear settled results only — never every realtime refinement.
  useEffect(() => {
    if (!text || unavailable || error) return;
    const id = setTimeout(() => setAnnounce(t("ready")), 1200);
    return () => {
      clearTimeout(id);
      setAnnounce("");
    };
  }, [text, unavailable, error, t]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = useCallback(() => {
    const value = textRef.current;
    const generation = playback.current;
    const done = () => {
      if (generation !== playback.current || textRef.current !== value) return;
      setCopied(true);
      notifyCopied();
      feel.confirm();
    };
    const fallback = () => {
      // Plain-text fallback: exact characters and line breaks, no formatting.
      const active = document.activeElement as HTMLElement | null;
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0;top:0";
      document.body.appendChild(ta);
      try {
        ta.focus({ preventScroll: true });
        ta.select();
        if (document.execCommand("copy")) done();
      } catch {
        // A denied legacy clipboard must not disturb the draft or claim success.
      } finally {
        ta.remove();
        active?.focus({ preventScroll: true });
      }
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

  const rtl = isRtl(lang);

  // One readable scale per script, from the first chunk through the final answer.
  // Length thresholds (including the old provisional=120 shortcut) resized the whole
  // paragraph when it settled, and again when deleting across a threshold.
  const textCls = rtl
    ? "font-arabic font-medium text-[24px] leading-[1.75] sm:text-[26px]"
    : "font-medium text-[24px] leading-[1.45] tracking-[-0.015em] sm:text-[26px]";
  const showShadow = !!shadow && shadow.losses.length > 0 && !unavailable && !speaking;
  let body: React.ReactNode;
  if (result) {
    body = (
      <div key="result" className="animate-reveal relative flex min-w-0 flex-1 flex-col">
        {stale ? (
          <p
            aria-hidden
            className="absolute inset-x-0 -top-6 truncate text-[11px] text-muted-foreground"
          >
            {error ? t("previousTranslation") : t("updatingTranslation")}
          </p>
        ) : null}
        <div className="result-wrap relative">
          {showShadow && shadow ? (
            <ShadowInk
              text={text}
              losses={shadow.losses}
              focusId={shadow.focusId}
              className={`whitespace-pre-wrap text-start ${textCls}`}
              rtl={rtl}
              lang={lang}
            />
          ) : null}
          <p
            dir={rtl ? "rtl" : "ltr"}
            lang={lang}
            data-streaming={streaming ? "true" : undefined}
            className={`result-text whitespace-pre-wrap text-start transition-opacity duration-300 ${textCls} ${stale || pending ? "opacity-60" : provisional ? "opacity-80" : "opacity-100"}`}
          >
            {speaking && voiceStarted ? (
              <SpokenText text={text} current={spokenWord} />
            ) : (
              <StreamingText text={text} live={streaming} />
            )}
          </p>
          {showShadow && shadow ? (
            <ShadowHits
              text={text}
              losses={shadow.losses}
              focusId={shadow.focusId}
              className={`whitespace-pre-wrap text-start ${textCls}`}
              rtl={rtl}
              lang={lang}
              onPick={shadow.onPick}
            />
          ) : null}
        </div>
        {!unavailable && !speaking ? shadowSummary : null}

        {!unavailable && result.isAmbiguous && result.alternativeTranslations.length > 0 ? (
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

        {suggestion && !unavailable ? (
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

        {!unavailable && result.notes && result.confidence < 0.75 ? (
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{result.notes}</p>
        ) : null}

        {error && !pending ? (
          <p
            role="alert"
            className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-relaxed text-muted-foreground"
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${error === "offline" || error === "rate" || error === "timeout" ? "bg-warning" : "bg-destructive"}`}
            />
            {t(`err_${error}`)}
            {error !== "auth" ? (
              <button
                type="button"
                onClick={onRetry}
                className="press-soft font-medium text-signal-text underline decoration-signal/40 underline-offset-4"
              >
                {t("retry")}
              </button>
            ) : null}
          </p>
        ) : null}

        <div
          inert={unavailable}
          aria-hidden={unavailable}
          className={`result-actions -ms-0.5 mt-auto flex flex-wrap items-center pt-3 sm:pt-3.5 transition-[opacity,transform] duration-200 ease-[var(--ease-soft)] ${
            unavailable
              ? "pointer-events-none translate-y-2 opacity-0"
              : "translate-y-0 opacity-100"
          }`}
        >
          <button
            type="button"
            onClick={copy}
            disabled={unavailable}
            aria-label={copied ? t("copied") : t("copy")}
            className={`press-soft me-1.5 inline-flex h-9 items-center gap-1.5 rounded-full border border-signal/15 bg-signal-soft px-3 text-[12px] font-medium transition-colors duration-200 ${
              copied ? "text-success" : "text-signal-text"
            }`}
          >
            <span className="relative grid size-3.5 place-items-center">
              <Copy
                className={`swap-icon size-3.5 ${copied ? "scale-75 opacity-0" : "opacity-100"}`}
                strokeWidth={1.8}
              />
              <Check
                className={`swap-icon absolute size-3.5 ${copied ? "opacity-100" : "scale-75 opacity-0"}`}
                strokeWidth={2.2}
              />
            </span>
            {copied ? t("copied") : t("copyShort")}
          </button>
          <Action
            disabled={unavailable}
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
              disabled={unavailable}
              label={isSaved ? t("unsave") : t("save")}
              onClick={() => {
                onSave();
                feel.confirm();
              }}
              active={!!isSaved}
            >
              <Bookmark
                className={`size-[18px] transition-transform duration-200 ${isSaved ? "scale-110 fill-signal text-signal" : ""}`}
                strokeWidth={1.75}
              />
            </Action>
          ) : null}
          {onDictionary ? (
            <Action disabled={unavailable} label={t("lexOpen")} onClick={onDictionary}>
              <BookOpen className="size-[18px]" strokeWidth={1.75} />
              {dictionaryReady ? (
                <span
                  aria-hidden
                  className="absolute end-2.5 top-2.5 size-1.5 rounded-full bg-signal"
                />
              ) : null}
            </Action>
          ) : null}
          {onToggleShadow ? (
            <Action
              disabled={unavailable}
              label={shadowOn ? t("shOff") : t("shOn")}
              onClick={onToggleShadow}
              active={!!shadowOn}
            >
              <Contrast
                className={`size-[18px] transition-opacity ${shadowOn ? "opacity-100" : "opacity-50"}`}
                strokeWidth={1.75}
              />
            </Action>
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
        <p
          role="alert"
          className="flex items-start gap-2.5 text-[15px] leading-relaxed text-muted-foreground"
        >
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
    <div
      className="result-panel relative px-5 pb-4 pt-9"
      data-stale={stale || undefined}
      aria-busy={!error && (pending || provisional || stale)}
      aria-label={t("translationResult")}
      role="region"
    >
      {body}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      <VoiceSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} />
    </div>
  );
});
