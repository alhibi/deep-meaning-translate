import { ThemeToggle } from "@/components/ThemeToggle";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Bookmark,
  ChevronDown,
  ClipboardPaste,
  ChartNoAxesCombined,
  Mic,
  X,
} from "lucide-react";
import { initServiceWorker } from "@/lib/pwa";
import { useInstallPrompt } from "@/lib/useInstallPrompt";
import { LanguageBar } from "@/components/translator/LanguageBar";
import { StyleToggle } from "@/components/translator/StyleToggle";
import { ResultPanel } from "@/components/translator/ResultPanel";
import { LanguageSheet } from "@/components/translator/LanguageSheet";
import { SavedSheet } from "@/components/translator/SavedSheet";
import { SafeArea } from "@/components/SafeArea";
import { Intro } from "@/components/Intro";
import { tick } from "@/lib/haptics";
import { useClipboardHint } from "@/lib/clipboardHint";
import { joinSpeech } from "@/lib/speech";
import { useAssemblySpeech } from "@/lib/useAssemblySpeech";
import { speechLang } from "@/lib/speech";
import { saved, useSaved, type SavedPhrase } from "@/lib/saved";
import { useTranslator } from "@/lib/translation/useTranslator";
import { useLexicon } from "@/lib/translation/useLexicon";
import { useShadow } from "@/lib/translation/useShadow";
import type { Loss } from "@/lib/translation/shadow";
import { ShadowSummary } from "@/components/translator/SentenceShadow";
import { ShadowMap, ShadowSheet } from "@/components/translator/ShadowSheet";
import { LexiconSheet } from "@/components/translator/LexiconSheet";
import { FlagSheet } from "@/components/translator/FlagSheet";
import { useFlags } from "@/lib/flags";
import { DEFAULT_BRAIN, effectiveBrain, type Brain, type Dialect, StyleOverride, TranslationResult } from "@/lib/translation/types";
import { BrainPicker } from "@/components/translator/BrainPicker";
import { LanguageNotice } from "@/components/translator/LanguageNotice";
import { checkSource } from "@/lib/translation/languageCheck";
import { history } from "@/lib/history";
import { takePendingPick } from "@/lib/stats/useArchive";
import { statsT } from "@/lib/stats/labels";
import { persist } from "@/lib/persist";
import { shouldShowIntro } from "@/lib/intro";
import { LOCALES, LOCALE_NAME, LOCALE_SHORT, initLocale, setLocale, useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "today — Meaning-first Arabic–German Translator" },
      {
        name: "description",
        content:
          "Translate between Arabic and German with attention to meaning, tone and idioms. Choose natural, formal or casual wording, explore word meanings and hear translations.",
      },
      { property: "og:title", content: "today — Meaning-first Arabic–German Translator" },
      {
        property: "og:description",
        content:
          "Translate what you actually mean. Tone, idioms and cultural nuance preserved, Arabic ⇄ German first.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://fluently.today/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://fluently.today/" }],
  }),
  component: Translator,
});

const MAX_CHARS = 5000;

function Translator() {
  const [text, setText] = useState("");
  const [source, setSource] = useState("auto");
  const [target, setTarget] = useState("de");
  const [style, setStyle] = useState<StyleOverride>("natural");
  const [dialect, setDialect] = useState<Dialect>("auto");
  const [dialectOpen, setDialectOpen] = useState(false);
  const [brain, setBrain] = useState<Brain>(DEFAULT_BRAIN);
  const [shadowOn, setShadowOn] = useState(true);
  const [savedOpen, setSavedOpen] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const flagList = useFlags();
  const [introOpen, setIntroOpen] = useState(false);
  // Stable handlers: the sheet re-subscribes (and pops history) whenever onClose changes identity.
  const closeDialect = useCallback(() => setDialectOpen(false), []);
  const selectDialect = useCallback((c: string) => setDialect(c as Dialect), []);
  const savedList = useSaved();
  const [dismissedFor, setDismissedFor] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { canInstall, install } = useInstallPrompt();

  // A restored draft re-shows its old translation: recorded quietly, never as a new use.
  const quietRef = useRef<string | null>(null);
  const handleSuccess = useCallback(
    (result: TranslationResult, original: string, provisional: boolean) => {
      if (provisional) return; // only settled thoughts reach the archive
      if (lang2(result.sourceLanguage) === lang2(target)) return; // about to re-route
      if (!result.translation.trim()) return;
      const quiet = quietRef.current !== null && quietRef.current === original.trim();
      quietRef.current = null;
      history.add(
        {
          source: result.sourceLanguage || source,
          target,
          original,
          translated: result.translation,
          style,
          formality: result.formality || undefined,
          situation: result.situation,
          tags: result.tags as Parameters<typeof history.add>[0]["tags"],
        },
        { quiet },
      );
    },
    [source, target, style],
  );

  // Text in another writing system than the picked source (Arabic typed with
  // "English" chosen): the pick can't be right, so the model detects the language
  // itself instead of being told something false. The user still gets a hint.
  const scriptMismatch = text.trim() ? checkSource(text, source) : null;
  const requestSource = scriptMismatch?.strong ? "auto" : source;

  const {
    result: raw,
    pending: rawPending,
    provisional,
    error,
    retry,
    submitNext,
    prime,
  } = useTranslator({
    text,
    source: requestSource,
    target,
    style,
    dialect,
    brain,
    onSuccess: handleSuccess,
  });

  // Boot: restore the device-local session, or open around text shared into the app.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    void persist.requestDurable();
    initServiceWorker();
    initLocale();
    const prefs = persist.prefs();
    if (prefs) {
      setSource(prefs.source);
      setTarget(prefs.target);
      setStyle(prefs.style);
      if (prefs.dialect) setDialect(prefs.dialect);
      if (prefs.brain) setBrain(effectiveBrain(prefs.brain));
      if (prefs.shadow === false) setShadowOn(false);
    }
    const params = new URLSearchParams(window.location.search);
    const shared = [params.get("title"), params.get("text"), params.get("url")]
      .filter(Boolean)
      .join("\n")
      .trim();
    const pick = takePendingPick();
    if (pick && pick.target !== pick.source) {
      // Opened from Translation Statistics: show that translation, not the old draft.
      if (pick.source !== "auto") setSource(pick.source);
      setTarget(pick.target);
      submitNext();
      quietRef.current = pick.original.trim();
      setText(pick.original.slice(0, MAX_CHARS));
    } else if (shared) {
      window.history.replaceState(null, "", "/");
      submitNext();
      setText(shared.slice(0, MAX_CHARS));
    } else {
      const session = persist.session();
      if (session?.text) {
        if (session.result)
          prime(session.text, session.source, session.target, session.style, session.result);
        submitNext();
        quietRef.current = session.text.trim();
        setText(session.text);
      } else if (shouldShowIntro()) {
        setIntroOpen(true);
      }
    }
    setRestored(true);
  }, [submitNext, prime]);

  useEffect(() => {
    if (restored) persist.savePrefs({ source, target, style, dialect, brain, shadow: shadowOn });
  }, [restored, source, target, style, dialect, brain, shadowOn]);

  // Debounced while typing, but flushed when the app is hidden or closed so the
  // last keystrokes are never lost to the debounce window.
  const sessionRef = useRef<Parameters<typeof persist.saveSession>[0]>(null);
  useEffect(() => {
    if (!restored) return;
    const snapshot = { text, result: provisional ? null : raw, source, target, style };
    sessionRef.current = snapshot;
    const id = setTimeout(() => persist.saveSession(snapshot), 400);
    return () => clearTimeout(id);
  }, [restored, text, raw, provisional, source, target, style]);
  useEffect(() => {
    if (!restored) return;
    const flush = () => {
      if (document.visibilityState === "hidden") persist.saveSession(sessionRef.current);
    };
    const onHide = () => persist.saveSession(sessionRef.current);
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", onHide);
    };
  }, [restored]);

  const detected = raw?.sourceLanguage;
  // Same-language result (auto-detect hit the target): hold it back while we re-route.
  const rerouting =
    source === "auto" &&
    !!raw &&
    (lang2(raw.sourceLanguage) === lang2(raw.targetLanguage) ||
      raw.translation.trim() === text.trim());
  // Never present a translation into a language the user no longer asked for.
  const staleTarget = !!raw && !!raw.targetLanguage && lang2(raw.targetLanguage) !== target;
  const baseResult = rerouting || staleTarget ? null : raw;
  // Sentence shadow fix: shown over the model's translation it was made for, and only that one.
  const [applied, setApplied] = useState<{ base: string; original: string; text: string } | null>(
    null,
  );
  const result =
    baseResult && applied && applied.base === baseResult.translation && applied.original === text
      ? { ...baseResult, translation: applied.text }
      : baseResult;
  const pending = rawPending || rerouting || (staleTarget && !!text.trim());

  // Keyboard-aware layout: --vvh tracks the visible viewport so the canvas
  // lifts above the on-screen keyboard instead of hiding behind it.
  const scrollRef = useRef<HTMLDivElement>(null);
  const kbOpen = useRef(false);
  const [kbUp, setKbUp] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
      const open = vv.height < window.innerHeight - 150;
      if (open && !kbOpen.current)
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      kbOpen.current = open;
      setKbUp(open);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--vvh");
    };
  }, []);
  // While the keyboard is up, keep the newest translation pinned in view.
  useEffect(() => {
    if (!kbOpen.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [result, provisional]);

  // Auto-detected source equals target: flip to the Arabic↔German partner.
  useEffect(() => {
    if (source === "auto" && detected && detected === target) {
      setTarget(
        detected === "ar" ? "de" : detected === "de" ? "ar" : target === "de" ? "ar" : "de",
      );
    }
  }, [source, detected, target]);

  // Arabic script is unambiguous: route before the first request instead of after a wasted one.
  const arabicScript = text.trim() ? startsRtl(text) : false;
  useEffect(() => {
    if (source === "auto" && arabicScript && target === "ar") setTarget("de");
  }, [source, arabicScript, target]);

  // Gentle hint when the text isn't in the picked source language; the model's own
  // detection on a finished sentence refines it for same-script languages.
  const modelDetected = raw && !provisional && source !== "auto" ? raw.sourceLanguage : undefined;
  const mismatch = text.trim() ? checkSource(text, source, modelDetected) : null;
  const [langDismissed, setLangDismissed] = useState("");
  const mismatchKey = mismatch ? `${source}>${mismatch.suggest}` : "";
  useEffect(() => {
    if (!text.trim()) setLangDismissed("");
  }, [text]);

  // Picking the language already on the other side trades places instead of translating X→X.
  const chooseSource = useCallback(
    (code: string) => {
      if (code === target) setTarget(source === "auto" ? (code === "ar" ? "de" : "ar") : source);
      setSource(code);
    },
    [source, target],
  );
  const chooseTarget = useCallback(
    (code: string) => {
      if (code === source) setSource(target);
      setTarget(code);
    },
    [source, target],
  );

  const swap = useCallback(() => {
    const nextSource = target;
    const nextTarget =
      source === "auto"
        ? (detected ?? (arabicScript ? "ar" : target === "ar" ? "de" : "ar"))
        : source;
    setSource(nextSource);
    setTarget(nextTarget === nextSource ? (nextSource === "de" ? "ar" : "de") : nextTarget);
    if (result?.translation) {
      submitNext();
      setText(result.translation);
    }
  }, [source, target, detected, arabicScript, result, submitNext]);

  // Fallback autosize only for browsers without CSS field-sizing.
  useLayoutEffectSafe(() => {
    const el = inputRef.current;
    if (!el || SUPPORTS_FIELD_SIZING) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const onInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value.slice(0, MAX_CHARS));
  }, []);

  // A paste is a deliberate submission: translate the whole thing right away.
  const onPaste = useCallback(() => submitNext(), [submitNext]);
  const canReadClipboard =
    restored && typeof navigator !== "undefined" && !!navigator.clipboard?.readText;
  const pasteClipboard = useCallback(async () => {
    try {
      const value = (await navigator.clipboard.readText()).trim();
      if (!value) return;
      submitNext();
      setText(value.slice(0, MAX_CHARS));
    } catch {
      inputRef.current?.focus(); // permission declined — let the user paste normally
    }
  }, [submitNext]);

  const clear = useCallback(() => {
    setText("");
    inputRef.current?.focus();
  }, []);

  const { t, locale, rtl: uiRtl } = useI18n();
  const { lexicon, loading: lexiconLoading } = useLexicon({
    text,
    source: result?.sourceLanguage || source,
    target,
    uiLocale: locale,
    settled: !!result && !provisional && !pending && !error,
    translation: result?.translation,
    dialect,
  });
  const shadowSettled = !!result && !provisional && !pending && !error;
  const { state: shadowState, dismiss: dismissShadow, prepareApply } = useShadow({
    text,
    translation: result?.translation ?? "",
    source: result?.sourceLanguage || source,
    target,
    style,
    dialect,
    uiLocale: locale,
    settled: shadowSettled,
    enabled: shadowOn,
  });
  const shadowLosses = shadowState.status === "ready" ? shadowState.losses : [];
  const [shadowFocus, setShadowFocus] = useState<string | null>(null);
  const [shadowMapOpen, setShadowMapOpen] = useState(false);
  const [undo, setUndo] = useState<{ prev: typeof applied } | null>(null);
  const focusLoss = shadowLosses.find((l) => l.id === shadowFocus) ?? null;
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(id);
  }, [undo]);
  const closeShadow = useCallback(() => setShadowFocus(null), []);
  const closeShadowMap = useCallback(() => setShadowMapOpen(false), []);
  const pickShadow = useCallback((id: string) => {
    setShadowMapOpen(false);
    setShadowFocus(id);
  }, []);
  const archiveFix = useCallback(
    (translated: string) => {
      if (!result) return;
      history.add(
        { source: result.sourceLanguage || source, target, original: text, translated, style },
        { quiet: true },
      );
      const hit = saved.find(text, target);
      if (hit) saved.update(hit.id, translated);
    },
    [result, source, target, text, style],
  );
  const applyShadow = useCallback(
    (loss: Loss, index: number) => {
      const restore = loss.restores[index];
      if (!baseResult || !result || !restore) return;
      prepareApply(loss.id, restore.text);
      setUndo({ prev: applied });
      setApplied({ base: baseResult.translation, original: text, text: restore.text });
      archiveFix(restore.text);
      setShadowFocus(null);
      tick();
    },
    [baseResult, result, applied, text, prepareApply, archiveFix],
  );
  const undoShadow = useCallback(() => {
    if (!undo) return;
    setApplied(undo.prev);
    archiveFix(undo.prev?.text ?? baseResult?.translation ?? "");
    setUndo(null);
  }, [undo, archiveFix, baseResult]);
  const keepShadow = useCallback(
    (loss: Loss) => {
      dismissShadow(loss.id);
      setShadowFocus(null);
    },
    [dismissShadow],
  );
  const [lexOpen, setLexOpen] = useState(false);
  const openLex = useCallback(() => setLexOpen(true), []);
  const closeLex = useCallback(() => setLexOpen(false), []);
  useEffect(() => setLexOpen(false), [text]);
  const hasClip = useClipboardHint();

  // Voice input: speech joins whatever is already written, and translates the moment you stop.
  const speechBase = useRef("");
  const speech = useAssemblySpeech({
    lang: source === "auto" ? "auto" : speechLang(source, target, locale, dialect),
    onText: (spoken, final) => {
      if (final) submitNext(); // a finished phrase translates right away
      setText(joinSpeech(speechBase.current, spoken).slice(0, MAX_CHARS));
    },
    onDone: () => inputRef.current?.focus({ preventScroll: true }),
  });
  const toggleMic = useCallback(() => {
    if (!speech.listening && !speech.starting) speechBase.current = inputRef.current?.value.trim() ?? "";
    tick();
    speech.toggle();
  }, [speech]);
  const retryMic = useCallback(() => {
    tick();
    speech.retry(); // keeps both the typed text and what was already heard
  }, [speech]);
  const [tagline, setTagline] = useState(false);
  const taglineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taglinePlayed = useRef(false);
  const clearTaglineTimer = useCallback(() => {
    if (taglineTimer.current) {
      clearTimeout(taglineTimer.current);
      taglineTimer.current = null;
    }
  }, []);
  useEffect(() => clearTaglineTimer, [clearTaglineTimer]);
  // Play one full gust: the storm sweep in, hold, then hand the name back.
  const playTagline = useCallback(() => {
    clearTaglineTimer();
    setTagline(true);
    taglineTimer.current = setTimeout(() => setTagline(false), 1500);
  }, [clearTaglineTimer]);
  const toggleTagline = useCallback(() => {
    setTagline((v) => {
      if (v) {
        clearTaglineTimer();
        return false;
      }
      playTagline();
      return true;
    });
  }, [clearTaglineTimer, playTagline]);
  const [localeOpen, setLocaleOpen] = useState(false);
  const closeLocale = useCallback(() => setLocaleOpen(false), []);
  const rtlInput = text.trim() ? startsRtl(text) : uiRtl;
  const hasText = text.length > 0;
  // The name introduces itself on its own: once 4s after arrival, then a quiet
  // 16s rhythm — but only while the page rests (nothing written, no sheet open).
  useEffect(() => {
    if (tagline || hasText || localeOpen || savedOpen || dialectOpen) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const delay = taglinePlayed.current ? 16000 : 4000;
    const id = setTimeout(() => {
      taglinePlayed.current = true;
      playTagline();
    }, delay);
    return () => clearTimeout(id);
  }, [tagline, hasText, localeOpen, savedOpen, dialectOpen, playTagline]);

  const isSaved = !!result && !!savedList && !!saved.find(text, target);
  const toggleSave = useCallback(() => {
    if (!result) return;
    saved.toggle({
      source: result.sourceLanguage || source,
      target,
      original: text,
      translated: result.translation,
    });
  }, [result, source, target, text]);
  const pickSaved = useCallback(
    (p: SavedPhrase) => {
      setSavedOpen(false);
      setSource(p.source === "auto" ? "auto" : p.source);
      setTarget(p.target);
      submitNext();
      setText(p.original);
    },
    [submitNext],
  );

  // Situation detection → one quiet suggestion, only when it disagrees with the chosen style.
  const sit = result?.situation;
  const suggestKey = `${text.trim()}|${style}`;
  const suggestion =
    result && dismissedFor !== suggestKey
      ? (sit === "official" || sit === "work") && style !== "formal"
        ? { label: t(sit === "official" ? "sit_official" : "sit_work"), next: "formal" as const }
        : sit === "chat" && style === "formal"
          ? { label: t("sit_chat"), next: "casual" as const }
          : null
      : null;

  const today = restored && !hasText ? (savedList.length ? saved.ofTheDay() : null) : null;

  return (
    <>
      {introOpen ? <Intro onComplete={() => setIntroOpen(false)} /> : null}
      <main className="mx-auto flex h-[100dvh] max-h-[var(--vvh,100dvh)] w-full max-w-xl flex-col overflow-hidden bg-background">
        <header className="flex items-center justify-between px-5 pad-safe-top pb-1">
          <button
            type="button"
            onClick={toggleTagline}
            aria-expanded={tagline}
            className="press-soft -ms-2 inline-flex items-center gap-2 rounded-full px-2 py-1 text-[15px] font-semibold tracking-[-0.01em] text-foreground"
          >
            {/* Signature mark: a small clay diamond that spins into the gust. */}
            <span
              aria-hidden
              className="grid size-2 shrink-0 place-items-center transition-[transform,opacity] duration-[700ms] ease-[cubic-bezier(0.65,0,0.35,1)]"
              style={{
                transform: tagline ? "rotate(225deg) scale(0.7)" : "rotate(0deg) scale(1)",
                opacity: tagline ? 0.55 : 1,
              }}
            >
              <span className="size-1.5 rotate-45 rounded-[1.5px] bg-signal" />
            </span>
            {/* Storm swap: the outgoing word is swept away (blur + skew + stretch) while the incoming one condenses out of the blur — overlapped, never a pause. */}
            <span className="relative block h-[19px]">
              <span
                aria-hidden
                className="font-literary block h-0 overflow-hidden whitespace-nowrap text-start text-[16px] italic lowercase leading-[19px]"
              >
                say it naturally.
              </span>
              <span
                aria-hidden={tagline}
                className="block origin-left whitespace-nowrap text-start leading-[19px] will-change-[transform,filter,opacity] rtl:origin-right"
                style={{
                  transition: tagline
                    ? "transform 480ms cubic-bezier(0.7,0,0.84,0), filter 420ms cubic-bezier(0.5,0,0.75,0), opacity 460ms cubic-bezier(0.5,0,0.75,0), letter-spacing 480ms cubic-bezier(0.7,0,0.84,0)"
                    : "transform 760ms cubic-bezier(0.16,1,0.3,1) 140ms, filter 700ms cubic-bezier(0.16,1,0.3,1) 140ms, opacity 520ms ease-out 140ms, letter-spacing 760ms cubic-bezier(0.16,1,0.3,1) 140ms",
                  transform: tagline ? "translateX(55%) skewX(-24deg) scaleX(1.35)" : "none",
                  filter: tagline ? "blur(9px)" : "blur(0)",
                  opacity: tagline ? 0 : 1,
                  letterSpacing: tagline ? "0.45em" : "-0.01em",
                }}
              >
                today
              </span>
              <span
                aria-hidden={!tagline}
                className="font-literary absolute inset-0 block origin-left whitespace-nowrap text-start text-[16px] font-normal italic lowercase leading-[19px] tracking-[0.01em] text-muted-foreground will-change-[transform,filter,opacity] rtl:origin-right"
                style={{
                  transition: tagline
                    ? "transform 820ms cubic-bezier(0.16,1,0.3,1) 120ms, filter 760ms cubic-bezier(0.16,1,0.3,1) 120ms, opacity 560ms ease-out 120ms"
                    : "transform 460ms cubic-bezier(0.7,0,0.84,0), filter 400ms cubic-bezier(0.5,0,0.75,0), opacity 440ms cubic-bezier(0.5,0,0.75,0)",
                  transform: tagline ? "none" : "translateX(-18%) skewX(16deg) scaleX(1.2)",
                  filter: tagline ? "blur(0)" : "blur(10px)",
                  opacity: tagline ? 1 : 0,
                }}
              >
                say it naturally.
              </span>
            </span>
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLocaleOpen(true)}
              aria-haspopup="dialog"
              aria-label={t("uiLanguage")}
              className="press-soft grid h-9 min-w-9 place-items-center rounded-full px-2 text-[12px] font-medium tracking-wide text-muted-foreground"
            >
              <span aria-hidden className={locale === "ar" ? "font-arabic text-[14px]" : ""}>
                {LOCALE_SHORT[locale]}
              </span>
            </button>
            <LanguageSheet
              open={localeOpen}
              title={t("uiLanguage")}
              searchable={false}
              items={LOCALES.map((l) => ({
                code: l,
                native: LOCALE_NAME[l],
                name: LOCALE_NAME[l],
                rtl: l === "ar",
              }))}
              value={locale}
              onSelect={(c) => setLocale(c as typeof locale)}
              onClose={closeLocale}
            />
            {canInstall ? (
              <button
                type="button"
                onClick={() => void install()}
                className="press-soft animate-fade inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] text-muted-foreground"
              >
                <ArrowDownToLine className="size-3.5" strokeWidth={1.75} />
                {t("install")}
              </button>
            ) : null}
            <ThemeToggle label={t("theme")} />
            <button
              type="button"
              onClick={() => setSavedOpen(true)}
              aria-label={t("savedTitle")}
              className="press grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <Bookmark className="size-[18px]" strokeWidth={1.75} />
            </button>
            <Link
              to="/stats"
              aria-label={statsT(locale)("open")}
              className="press grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <ChartNoAxesCombined className="size-[18px]" strokeWidth={1.75} />
            </Link>
          </div>
        </header>

        <div
          ref={scrollRef}
          className={`flex flex-1 flex-col overflow-y-auto overscroll-contain ${
            kbUp ? "justify-start pb-3 pt-1" : "justify-start pb-[6dvh] pt-[3dvh]"
          }`}
        >
          <h1 dir={uiRtl ? "rtl" : "ltr"} className="sr-only">
            {t("translatorTitle")}
          </h1>
          <LanguageBar
            source={source}
            target={target}
            detected={detected}
            onSource={chooseSource}
            onTarget={chooseTarget}
            onSwap={swap}
          />

          {/* One canvas: source writing surface, a live seam, then the result. */}
          <div className="mx-3 flex flex-col overflow-hidden rounded-[22px] bg-surface">
            <section dir={uiRtl ? "rtl" : "ltr"} className="input-shell relative px-5 pb-2 pt-5">
              <textarea
                ref={inputRef}
                value={text}
                onChange={onInput}
                onPaste={onPaste}
                dir={rtlInput ? "rtl" : "ltr"}
                rows={2}
                autoCapitalize="sentences"
                autoComplete="off"
                enterKeyHint="done"
                spellCheck
                placeholder={t("placeholder")}
                aria-label={t("inputLabel")}
                className={`autogrow block w-full resize-none bg-transparent pe-14 outline-none ${
                  rtlInput
                    ? "font-arabic text-[24px] leading-[1.7]"
                    : "text-[22px] leading-[1.45] tracking-[-0.015em]"
                } ${speech.listening ? "text-transparent caret-transparent" : ""}`}
              />
              {speech.listening ? (
                /* Spoken words surface softly: each new word condenses out of a blur instead of popping in. */
                <div
                  aria-hidden
                  dir={rtlInput ? "rtl" : "ltr"}
                  className={`pointer-events-none absolute inset-x-5 top-5 whitespace-pre-wrap break-words pe-14 ${
                    rtlInput
                      ? "font-arabic text-[24px] leading-[1.7]"
                      : "text-[22px] leading-[1.45] tracking-[-0.015em]"
                  }`}
                >
                  {(() => {
                    const baseLen = speechBase.current ? speechBase.current.split(/\s+/).length : 0;
                    return text
                      .split(/\s+/)
                      .filter(Boolean)
                      .map((w, i) => (
                        <span key={i} className={i < baseLen ? undefined : "speech-word"}>
                          {w}{" "}
                        </span>
                      ));
                  })()}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => { speech.cancel(); speechBase.current = ""; clear(); }}
                aria-label={t("clearText")}
                tabIndex={hasText ? 0 : -1}
                className={`press absolute end-3 top-4 grid size-10 place-items-center rounded-full text-faint transition-[opacity,transform] duration-200 hover:text-foreground ${
                  hasText ? "opacity-100" : "pointer-events-none scale-90 opacity-0"
                }`}
              >
                <X className="size-[18px]" strokeWidth={1.6} />
              </button>
              <div className="flex h-10 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {speech.supported ? (
                    <button
                      type="button"
                      onClick={toggleMic}
                      aria-label={speech.listening ? t("micStop") : t("mic")}
                      aria-pressed={speech.listening}
                      aria-busy={speech.starting}
                      data-live={speech.listening || undefined}
                      className={`mic-orb press -ms-2 relative grid size-10 place-items-center rounded-full ${
                        speech.listening
                          ? "text-signal-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span aria-hidden className="mic-halo" />
                      <span aria-hidden className="mic-halo mic-halo-2" />
                      <span aria-hidden className="mic-core" />
                      <Mic className="relative size-[18px]" strokeWidth={1.7} />
                    </button>
                  ) : null}
                  {speech.listening ? (
                    <span className="mic-wave text-[12px] text-signal-text" aria-live="polite">
                      {t("micListening")}
                    </span>
                  ) : speech.error ? (
                    <span
                      className="animate-fade flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground"
                      aria-live="polite"
                    >
                      <span className="break-words">
                        {speech.message ?? t(
                          speech.error === "denied"
                            ? "micDenied"
                            : speech.error === "nospeech"
                              ? "micNoSpeech"
                              : speech.error === "nomic"
                                ? "micNoDevice"
                                : "micFailed",
                        )}
                      </span>
                      {speech.error !== "denied" ? (
                        <button
                          type="button"
                          onClick={retryMic}
                          className="press-soft shrink-0 rounded-full px-2 py-1 text-signal-text"
                        >
                          {t("micRetry")}
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  {!hasText && canReadClipboard && hasClip && !speech.listening ? (
                    <button
                      type="button"
                      onClick={() => void pasteClipboard()}
                      className="press-soft animate-fade inline-flex h-9 items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground"
                    >
                      <ClipboardPaste className="size-4" strokeWidth={1.6} />
                      {t("paste")}
                    </button>
                  ) : null}
                  {text.length > MAX_CHARS * 0.7 ? (
                    <span className="animate-fade text-[11px] tabular-nums text-faint">
                      {text.length}/{MAX_CHARS}
                    </span>
                  ) : null}
                </div>
              </div>
            </section>

            <div className="flex items-center justify-between px-3">
              <div className="flex min-w-0 items-center">
                <StyleToggle value={style} onChange={setStyle} />
                {target === "ar" ? (
                  <button
                    type="button"
                    onClick={() => setDialectOpen(true)}
                    aria-haspopup="dialog"
                    aria-label={t("dialect")}
                    className="press-soft animate-fade ms-1 inline-flex h-9 items-center gap-1 border-s border-border ps-3 font-arabic text-[13px] text-muted-foreground hover:text-foreground"
                  >
                    {t(`d_${dialect}`)}
                    <ChevronDown className="size-3.5 text-faint" strokeWidth={1.75} />
                  </button>
                ) : null}
                <BrainPicker value={brain} onChange={setBrain} />
              </div>
              <span
                className={`inline-flex items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-signal-text transition-opacity duration-300 ${
                  pending || provisional ? "opacity-100" : "opacity-0"
                }`}
                aria-hidden
              >
                <span className="size-1.5 animate-breathe rounded-full bg-signal" />
                {t("live")}
              </span>
            </div>
            {mismatch && langDismissed !== mismatchKey ? (
              <LanguageNotice
                mismatch={mismatch}
                source={source}
                onApply={() => (mismatch.suggest === "auto" ? setSource("auto") : chooseSource(mismatch.suggest))}
                onDismiss={() => setLangDismissed(mismatchKey)}
              />
            ) : null}
            <div className="live-line mx-5" data-live={pending ? "true" : "false"} />

            <div>
              <SafeArea>
                <ResultPanel
                  result={result}
                  pending={pending}
                  provisional={provisional}
                  error={error}
                  target={target}
                  onRetry={retry}
                  isSaved={isSaved}
                  onSave={toggleSave}
                  suggestion={
                    suggestion
                      ? {
                          label: suggestion.label,
                          onApply: () => setStyle(suggestion.next),
                          onDismiss: () => setDismissedFor(suggestKey),
                        }
                      : null
                  }
                  idle={
                    today ? (
                      <button
                        type="button"
                        onClick={() => pickSaved(today)}
                        className="press-soft block w-full text-start"
                      >
                        <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-faint">
                          <span aria-hidden className="size-1 rotate-45 bg-signal" />
                          {t("phraseOfDay")}
                        </span>
                        <span
                          dir="auto"
                          className={`mt-2 block text-start text-[20px] leading-snug text-foreground ${startsRtl(today.translated) ? "font-arabic" : ""}`}
                        >
                          {today.translated}
                        </span>
                        <span
                          dir="auto"
                          className="mt-1 block text-start text-[14px] text-muted-foreground"
                        >
                          {today.original}
                        </span>
                      </button>
                    ) : undefined
                  }
                  onDictionary={lexicon || lexiconLoading ? openLex : undefined}
                  dictionaryReady={!!lexicon}
                  onFlag={() => setFlagOpen(true)}
                  flagLabel={{ ar: "غير دقيق", de: "Ungenau" }[locale as string] ?? "Inaccurate"}
                  shadowOn={shadowOn}
                  onToggleShadow={() => setShadowOn((v) => !v)}
                  shadow={
                    shadowState.status === "ready"
                      ? { losses: shadowLosses, focusId: shadowFocus, onPick: pickShadow }
                      : null
                  }
                  shadowSummary={
                    undo || shadowState.status === "loading" || shadowState.status === "ready" ? (
                      <ShadowSummary
                        status={shadowState.status === "ready" ? "ready" : "loading"}
                        losses={shadowLosses}
                        onPick={pickShadow}
                        onMap={() => setShadowMapOpen(true)}
                        undo={undo ? { onUndo: undoShadow } : null}
                      />
                    ) : null
                  }
                />
              </SafeArea>
            </div>
          </div>
          <Link
            to="/arabic-german-translation"
            dir={uiRtl ? "rtl" : "ltr"}
            className="sr-only"
          >
            {t("pairGuide")}
          </Link>
        </div>
        <div className="h-3 pad-safe-bottom" />

        <SafeArea silent>
          <LanguageSheet
            open={dialectOpen}
            title={t("dialect")}
            searchable={false}
            plain
            items={(["auto", "msa", "levant", "egypt", "gulf", "iraq", "maghreb"] as const).map(
              (d) => ({
                code: d,
                native: t(`d_${d}`),
                name: t(`d_${d}`),
                rtl: true,
              }),
            )}
            value={dialect}
            onSelect={selectDialect}
            onClose={closeDialect}
          />
          <ShadowSheet
            loss={focusLoss}
            sourceText={text.trim().replace(/\s+/gu, " ")}
            sourceLang={result?.sourceLanguage || source}
            translation={result?.translation ?? ""}
            targetLang={target}
            onApply={applyShadow}
            onKeep={keepShadow}
            onClose={closeShadow}
          />
          <ShadowMap
            open={shadowMapOpen && shadowLosses.length > 0}
            losses={shadowLosses}
            sourceText={text.trim().replace(/\s+/gu, " ")}
            sourceLang={result?.sourceLanguage || source}
            translation={result?.translation ?? ""}
            targetLang={target}
            onPick={pickShadow}
            onClose={closeShadowMap}
          />
          <LexiconSheet
            open={lexOpen}
            value={lexicon}
            loading={lexiconLoading}
            onClose={closeLex}
          />
          <FlagSheet
            open={flagOpen}
            draft={
              result
                ? {
                    source: result.sourceLanguage || source,
                    target: result.targetLanguage || target,
                    original: text,
                    translated: result.translation,
                    brain,
                  }
                : null
            }
            list={flagList}
            onClose={() => setFlagOpen(false)}
          />
          <SavedSheet
            open={savedOpen}
            entries={savedList}
            onClose={() => setSavedOpen(false)}
            onPick={pickSaved}
          />
        </SafeArea>
      </main>
    </>
  );
}

const SUPPORTS_FIELD_SIZING =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("field-sizing", "content");

const useLayoutEffectSafe = typeof window === "undefined" ? useEffect : useLayoutEffect;

function lang2(code: string | undefined) {
  return (code ?? "").slice(0, 2).toLowerCase();
}

/** Direction follows the first strong character the user typed. */
function startsRtl(value: string) {
  const m = value.match(
    /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/,
  );
  return !!m && /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(m[0]);
}
