import { ThemeToggle } from "@/components/ThemeToggle";
import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  Bookmark,
  ChevronDown,
  ClipboardPaste,
  ChartNoAxesCombined,
  ArrowUp,
  Mic,
  X,
} from "lucide-react";
import { initServiceWorker, updateAppBadge } from "@/lib/pwa";
import { useInstallPrompt } from "@/lib/useInstallPrompt";
import { IosInstallSheet } from "@/components/IosInstallSheet";
import { OfflinePill } from "@/components/OfflinePill";
import { useTodayKey } from "@/lib/useTodayKey";
import { AppHeader } from "@/components/translator/AppHeader";
import { Intro } from "@/components/Intro";
import { LanguageBar } from "@/components/translator/LanguageBar";
import { StyleToggle } from "@/components/translator/StyleToggle";
import { ResultPanel } from "@/components/translator/ResultPanel";
import { SavedSheet } from "@/components/translator/SavedSheet";
import { SafeArea } from "@/components/SafeArea";
import { feel } from "@/lib/feel";
import { useClipboardHint } from "@/lib/clipboardHint";
import { joinSpeech } from "@/lib/speech";
import { stopSpeaking } from "@/lib/tts";
import { isNativeApp } from "@/lib/native/config";
import { useAssemblySpeech } from "@/lib/useAssemblySpeech";
import { speechLang } from "@/lib/speech";
import { saved, useSaved, type SavedPhrase } from "@/lib/saved";
import { useTranslator } from "@/lib/translation/useTranslator";
import { useLexicon } from "@/lib/translation/useLexicon";
import { useShadow } from "@/lib/translation/useShadow";
import type { Loss } from "@/lib/translation/shadow";
import { ShadowSummary } from "@/components/translator/SentenceShadow";
import {
  DEFAULT_BRAIN,
  effectiveBrain,
  type Brain,
  type Dialect,
  StyleOverride,
  TranslationResult,
} from "@/lib/translation/types";
import { BrainPicker } from "@/components/translator/BrainPicker";
import { LanguageNotice } from "@/components/translator/LanguageNotice";
import { checkSource } from "@/lib/translation/languageCheck";
import { styleSuggestion } from "@/lib/translation/suggestion";
import { resultState } from "@/lib/translation/view";
import { history } from "@/lib/history";
import { takePendingPick } from "@/lib/stats/useArchive";
import { statsT } from "@/lib/stats/labels";
import { persist } from "@/lib/persist";
import { introPending, releaseIntroGate } from "@/lib/intro";
import { restorePlan } from "@/lib/translation/restore";
import { isEcho, languagePartner, shouldHoldForReroute } from "@/lib/translation/echo";
import { LOCALES, LOCALE_NAME, LOCALE_SHORT, initLocale, setLocale, useI18n } from "@/lib/i18n";

/*
 * Sheets are closed on first paint, so they are loaded on demand instead of sitting in
 * the entry chunk. `Suspense` renders nothing while a sheet arrives, which is exactly
 * what an unopened sheet looks like anyway. Their chunks are hashed and precached with
 * the rest of the shell, so this costs an offline user nothing either.
 *
 * The intro is the exception, and deliberately so: it is server-rendered, because a
 * lazy overlay meant a first visit painted the translator and then covered it — and the
 * cover was the page's largest element. CSS (the pre-paint gate) decides its visibility.
 */
const LanguageSheet = lazy(() =>
  import("@/components/translator/LanguageSheet").then((m) => ({ default: m.LanguageSheet })),
);
const ShadowSheet = lazy(() =>
  import("@/components/translator/ShadowSheet").then((m) => ({ default: m.ShadowSheet })),
);
const ShadowMap = lazy(() =>
  import("@/components/translator/ShadowSheet").then((m) => ({ default: m.ShadowMap })),
);
const LexiconSheet = lazy(() =>
  import("@/components/translator/LexiconSheet").then((m) => ({ default: m.LexiconSheet })),
);

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
      { property: "og:locale", content: "en" },
      { property: "og:locale:alternate", content: "ar" },
      { property: "og:locale:alternate", content: "de" },
      {
        name: "keywords",
        content:
          "Arabic German translator, ترجمة عربية ألمانية, Arabisch Deutsch Übersetzer, meaning-based translation, Arabic dialects",
      },
      { name: "robots", content: "index, follow, max-image-preview:large" },
    ],
    links: [{ rel: "canonical", href: "https://fluently.today/" }],
    // Structured data: what this is, who it is for, what it costs (nothing).
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "today",
          url: "https://fluently.today/",
          applicationCategory: "UtilitiesApplication",
          operatingSystem: "Any (web, installable PWA)",
          description:
            "Meaning-first translation between Arabic and German: tone, register, dialect and idiom are carried across, not word-for-word replaced.",
          inLanguage: ["ar", "de", "en"],
          isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
          featureList: [
            "Natural, formal and casual wording",
            "Arabic dialects: Levantine, Egyptian, Gulf, Iraqi, Maghrebi, Standard",
            "Text to speech with word-level read-along",
            "Screenless dictation",
            "Sentence shadow: what a translation may have lost",
            "Private, on-device archive and phrasebook",
          ],
          publisher: { "@type": "Organization", name: "today", url: "https://fluently.today/" },
        }),
      },
    ],
  }),
  component: Translator,
});

const MAX_CHARS = 5000;

function Translator() {
  // Returning from another route must not paint an empty translator first: the tab's
  // own last values seed the first render. On a cold load this is empty, and the boot
  // effect below restores storage exactly as before (server HTML and client match).
  const [boot] = useState(() => persist.remembered());
  const [text, setText] = useState(boot.session?.text ?? "");
  const [source, setSource] = useState(boot.session?.source ?? "auto");
  const [target, setTarget] = useState(boot.session?.target ?? "de");
  const [style, setStyle] = useState<StyleOverride>(boot.session?.style ?? "natural");
  const [dialect, setDialect] = useState<Dialect>(boot.prefs?.dialect ?? "auto");
  const [dialectOpen, setDialectOpen] = useState(false);
  const [brain, setBrain] = useState<Brain>(effectiveBrain(boot.prefs?.brain ?? DEFAULT_BRAIN));
  const [shadowOn, setShadowOn] = useState(boot.prefs?.shadow !== false);
  const toggleShadow = useCallback(() => setShadowOn((v) => !v), []);
  const [savedOpen, setSavedOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  /** Mounted from the first paint; CSS decides whether this visit sees it. */
  const [introMounted, setIntroMounted] = useState(true);
  const finishIntro = useCallback(() => {
    setIntroMounted(false);
    setIntroOpen(false);
  }, []);
  // Stable handlers: the sheet re-subscribes (and pops history) whenever onClose changes identity.
  const closeDialect = useCallback(() => setDialectOpen(false), []);
  const selectDialect = useCallback((c: string) => setDialect(c as Dialect), []);
  const savedList = useSaved();
  const todayKey = useTodayKey();
  const [dismissedFor, setDismissedFor] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Latest visible value, read by the native reconciliation path without re-binding it. */
  const textRef = useRef(text);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref, read only from a DOM listener
  textRef.current = text;
  const { canInstall, install, showIosGuide, closeIosGuide } = useInstallPrompt();

  // A restored draft re-shows its old translation: recorded quietly, never as a new use.
  const quietRef = useRef<string | null>(null);
  const handleSuccess = useCallback(
    (result: TranslationResult, original: string, provisional: boolean) => {
      if (provisional) return; // only settled thoughts reach the archive
      if (lang2(result.sourceLanguage) === lang2(target)) return; // about to re-route
      if (isEcho(original, result)) return; // unchanged output is not a translation
      if (!result.translation.trim()) return;
      const quiet = quietRef.current !== null && quietRef.current === original.trim();
      quietRef.current = null;
      void history.add(
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
    translateNow,
    submitNext,
    prime,
  } = useTranslator({
    text,
    source: requestSource,
    target,
    style,
    dialect,
    brain,
    restored: boot.session?.result ?? null,
    onSuccess: handleSuccess,
  });

  // Boot: restore the device-local session, or open around text shared into the app.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    void persist.requestDurable();
    initServiceWorker();
    initLocale();
    const prefs = persist.prefs();
    // The same values the translator will use after restoring, resolved *now*: state
    // setters below are asynchronous, so reading them back for the cache key would
    // prime a key the first request can never find.
    if (prefs) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
      setSource(prefs.source);
      setTarget(prefs.target);
      setStyle(prefs.style);
      if (prefs.dialect) setDialect(prefs.dialect);
      if (prefs.brain) setBrain(effectiveBrain(prefs.brain));
      if (prefs.shadow === false) setShadowOn(false);
    }
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    if (action === "saved") {
      setSavedOpen(true);
      window.history.replaceState(null, "", "/");
    } else if (action === "new") {
      setText("");
      window.history.replaceState(null, "", "/");
    }
    const shared = [params.get("title"), params.get("text"), params.get("url")]
      .filter(Boolean)
      .join("\n")
      .trim();
    const pick = takePendingPick();
    const session = persist.session();
    // The pre-paint gate and this decision must agree. If this visit shows no intro,
    // releasing the gate is what keeps the translator visible instead of held back.
    const wantsIntro = !pick && !shared && !session?.text && introPending();
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
    } else if (session?.text) {
      // The session owns the pair it was written in. Restoring the preference pair
      // instead primed a key the first request could not find: the draft came back,
      // the translation vanished, and the sentence was paid for again.
      const plan = restorePlan(session, prefs);
      if (plan.result)
        prime(
          plan.text,
          {
            source: plan.requestSource,
            target: plan.target,
            style: plan.style,
            dialect: plan.target === "ar" ? plan.dialect : "auto",
            brain: plan.brain,
          },
          plan.result,
        );
      submitNext();
      quietRef.current = plan.text.trim();
      setText(plan.text);
      setSource(plan.source);
      setTarget(plan.target);
      setStyle(plan.style);
      setDialect(plan.dialect);
      setBrain(plan.brain);
    }
    if (wantsIntro) {
      setIntroOpen(true);
    } else {
      releaseIntroGate();
      setIntroMounted(false);
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
    const id = setTimeout(() => void persist.saveSession(snapshot), 400);
    return () => clearTimeout(id);
  }, [restored, text, raw, provisional, source, target, style]);
  useEffect(() => {
    if (!restored) return;
    const flush = () => {
      if (document.visibilityState === "hidden") void persist.saveSession(sessionRef.current);
    };
    const onHide = () => void persist.saveSession(sessionRef.current);
    // Android may stop a backgrounded process without running pagehide; the native
    // lifecycle event asks for the same flush, and the write is idempotent.
    const onNativeFlush = () => void persist.saveSession(sessionRef.current);
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("lingua:flush", onNativeFlush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("lingua:flush", onNativeFlush);
    };
  }, [restored]);

  // Only a settled result that actually detected the target language can be held back
  // for a re-route. A live provisional result often carries sourceLanguage "auto"; using
  // its text to decide a re-route left short words like "Hallo" (auto → Deutsch) on a
  // skeleton forever, because nothing was going to flip the target. An echo of the input
  // is handled separately below by trying the Arabic/German partner once.
  const detected =
    raw && raw.sourceLanguage && raw.sourceLanguage !== "auto" ? raw.sourceLanguage : undefined;
  const rerouting = shouldHoldForReroute({
    source,
    target,
    result: raw,
    provisional,
  });
  // Hiding a stale result must never be what makes the screen "pending": pending means
  // a request is in flight, or a re-route is under way. The old expression forced a
  // skeleton when the model named a different target language, with nothing running.
  const view = resultState({ raw, rawPending, rerouting, target });
  const baseResult = view.result;
  // Sentence shadow fix: shown over the model's translation it was made for, and only that one.
  const [applied, setApplied] = useState<{ base: string; original: string; text: string } | null>(
    null,
  );
  // Memoised: `result` feeds five callbacks below, and a fresh object on every render
  // would recreate them (and re-render every memoised child) even for unrelated input.
  const result = useMemo(
    () =>
      baseResult && applied && applied.base === baseResult.translation && applied.original === text
        ? { ...baseResult, translation: applied.text }
        : baseResult,
    [baseResult, applied, text],
  );
  const pending = view.pending;

  // Keyboard-aware layout: --vvh tracks the visible viewport so the canvas
  // lifts above the on-screen keyboard instead of hiding behind it.
  const scrollRef = useRef<HTMLDivElement>(null);
  const kbOpen = useRef(false);
  const [kbUp, setKbUp] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // visualViewport fires on every scroll frame on a phone. Writing --vvh or state for a
    // value that did not change re-lays out the whole canvas on each frame, so both writes
    // are gated on a real change.
    let lastHeight = -1;
    const apply = () => {
      const height = Math.round(vv.height);
      if (height !== lastHeight) {
        lastHeight = height;
        document.documentElement.style.setProperty("--vvh", `${height}px`);
      }
      const open = height < window.innerHeight - 150;
      if (open === kbOpen.current) return;
      const wasOpen = kbOpen.current;
      kbOpen.current = open;
      setKbUp(open);
      if (open && !wasOpen)
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
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
  // Under adjustResize the window and the visual viewport shrink together, so the
  // comparison above can never fire on Android (A4-04). The native Keyboard plugin knows
  // the real show/hide transition; web keeps the visualViewport path.
  useEffect(() => {
    if (!isNativeApp()) return;
    let disposed = false;
    let handles: { remove: () => void | Promise<void> }[] = [];
    void (async () => {
      try {
        const { Keyboard } = await import("@capacitor/keyboard");
        const show = await Keyboard.addListener("keyboardWillShow", () => {
          if (disposed) return;
          const wasOpen = kbOpen.current;
          kbOpen.current = true;
          setKbUp(true);
          if (!wasOpen)
            requestAnimationFrame(() => {
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
        });
        // The component can unmount while the first listener is still being attached;
        // remove it immediately instead of leaking a listener on the dead instance.
        if (disposed) {
          void show.remove();
          return;
        }
        const hide = await Keyboard.addListener("keyboardWillHide", () => {
          if (disposed) return;
          kbOpen.current = false;
          setKbUp(false);
        });
        if (disposed) {
          void show.remove();
          void hide.remove();
          return;
        }
        handles = [show, hide];
      } catch {
        /* plugin absent: the visualViewport fallback still applies */
      }
    })();
    return () => {
      disposed = true;
      for (const handle of handles) void handle.remove();
    };
  }, []);

  // While the keyboard is up, keep the newest translation pinned in view.
  useEffect(() => {
    if (!kbOpen.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [result, provisional]);

  // The model echoed the input (a short word, a name, or auto source == target). Try the
  // other half of the product pair once for this exact text instead of leaving the same
  // words on screen as if they had been translated.
  const echoTried = useRef("");
  useEffect(() => {
    if (source !== "auto" || !raw || provisional) return;
    const partner = languagePartner(target);
    if (!partner || !isEcho(text, raw)) return;
    const attempt = text.trim();
    if (!attempt || echoTried.current === attempt) return;
    echoTried.current = attempt;
    setTarget(partner);
  }, [source, raw, provisional, target, text]);

  // Auto-detected source equals target: flip to the Arabic↔German partner.
  useEffect(() => {
    if (source === "auto" && detected && detected === target) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
      setTarget(
        detected === "ar" ? "de" : detected === "de" ? "ar" : target === "de" ? "ar" : "de",
      );
    }
  }, [source, detected, target]);

  // Arabic script is unambiguous: route before the first request instead of after a wasted one.
  const arabicScript = text.trim() ? startsRtl(text) : false;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
    if (source === "auto" && arabicScript && target === "ar") setTarget("de");
  }, [source, arabicScript, target]);

  // Gentle hint when the text isn't in the picked source language; the model's own
  // detection on a finished sentence refines it for same-script languages.
  const modelDetected = raw && !provisional && source !== "auto" ? raw.sourceLanguage : undefined;
  const mismatch = text.trim() ? checkSource(text, source, modelDetected) : null;
  const [langDismissed, setLangDismissed] = useState("");
  const mismatchKey = mismatch ? `${source}>${mismatch.suggest}` : "";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
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

  const onInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value.slice(0, MAX_CHARS));
  }, []);

  // A paste is a deliberate submission: translate the whole thing right away.
  // Android IME/WebView can paint the field while React's synthetic handler never reaches
  // state. One native listener reconciles only a genuinely stale value: normal typing is a
  // no-op, there is no timer writing state behind the IME, and composition events are left
  // to the platform until they finish.
  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    const sync = () => {
      const value = field.value.slice(0, MAX_CHARS);
      if (value !== textRef.current) setText(value);
    };
    field.addEventListener("input", sync);
    return () => field.removeEventListener("input", sync);
  }, []);
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

  const [pullDistance, setPullDistance] = useState(0);
  const pullStartY = useRef<number | null>(null);

  const onComposerTouchStart = useCallback((e: React.TouchEvent) => {
    const textarea = inputRef.current;
    if (textarea && textarea.scrollTop > 0) {
      pullStartY.current = null;
      return;
    }
    pullStartY.current = e.touches[0]?.clientY ?? null;
  }, []);

  const onComposerTouchMove = useCallback((e: React.TouchEvent) => {
    if (pullStartY.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - pullStartY.current;
    if (dy > 0) {
      setPullDistance(Math.min(dy * 0.45, 80));
    } else {
      setPullDistance(0);
    }
  }, []);

  const onComposerTouchEnd = useCallback(() => {
    if (pullDistance > 50) {
      feel.tap();
      clear();
    }
    setPullDistance(0);
    pullStartY.current = null;
  }, [pullDistance, clear]);

  useEffect(() => {
    updateAppBadge(savedList.length ? saved.reviewQueue().length : 0);
  }, [savedList]);

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
  const {
    state: shadowState,
    dismiss: dismissShadow,
    prepareApply,
  } = useShadow({
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
  // Stable props, so the memoised result panel is not re-rendered by pure typing.
  const shadowLosses = useMemo(
    () => (shadowState.status === "ready" ? shadowState.losses : []),
    [shadowState],
  );
  const [shadowFocus, setShadowFocus] = useState<string | null>(null);
  const [shadowMapOpen, setShadowMapOpen] = useState(false);
  const [undo, setUndo] = useState<{
    prev: typeof applied;
    original: string;
    base: string;
    target: string;
    style: string;
  } | null>(null);
  const validUndo =
    undo &&
    undo.original === text &&
    undo.base === baseResult?.translation &&
    undo.target === target &&
    undo.style === style
      ? undo
      : null;
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
      void history.add(
        { source: result.sourceLanguage || source, target, original: text, translated, style },
        { quiet: true },
      );
      const hit = saved.find(text, target);
      if (hit) void saved.update(hit.id, translated);
    },
    [result, source, target, text, style],
  );
  const applyShadow = useCallback(
    (loss: Loss, index: number) => {
      const restore = loss.restores[index];
      if (!baseResult || !result || !restore) return;
      prepareApply(loss.id, restore.text);
      setUndo({ prev: applied, original: text, base: baseResult.translation, target, style });
      setApplied({ base: baseResult.translation, original: text, text: restore.text });
      archiveFix(restore.text);
      setShadowFocus(null);
      feel.confirm();
    },
    [baseResult, result, applied, text, prepareApply, archiveFix, target, style],
  );
  const undoShadow = useCallback(() => {
    if (!validUndo) return;
    setApplied(validUndo.prev);
    archiveFix(validUndo.prev?.text ?? baseResult?.translation ?? "");
    setUndo(null);
  }, [validUndo, archiveFix, baseResult]);
  const keepShadow = useCallback(
    (loss: Loss) => {
      dismissShadow(loss.id);
      setShadowFocus(null);
    },
    [dismissShadow],
  );
  const shadowProp = useMemo(
    () =>
      shadowState.status === "ready"
        ? { losses: shadowLosses, focusId: shadowFocus, onPick: pickShadow }
        : null,
    [shadowState, shadowLosses, shadowFocus, pickShadow],
  );
  const [lexOpen, setLexOpen] = useState(false);
  const openLex = useCallback(() => setLexOpen(true), []);
  const closeLex = useCallback(() => setLexOpen(false), []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
  useEffect(() => setLexOpen(false), [text]);
  const hasClip = useClipboardHint();

  // Voice input: speech joins whatever is already written, and translates the moment you stop.
  const speechBase = useRef("");
  const speechEcho = useRef<HTMLDivElement>(null);
  const speech = useAssemblySpeech({
    lang: source === "auto" ? "auto" : speechLang(source, target, locale, dialect),
    onText: (spoken, final) => {
      if (final) submitNext(); // a finished phrase translates right away
      setText(joinSpeech(speechBase.current, spoken).slice(0, MAX_CHARS));
    },
    onDone: () => inputRef.current?.focus({ preventScroll: true }),
  });
  // The echo is its own scroller (the composer is a fixed strip): keep the newest words
  // visible, exactly where the caret would be in the transparent field underneath.
  useEffect(() => {
    if (!speech.listening) return;
    const el = speechEcho.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, speech.listening]);
  // Backgrounding must stop cloud read-along and a live dictation session, not only
  // flush storage; the docs already promised it (A5-06/A2-07).
  const cancelSpeech = speech.cancel;
  const stopVoice = useCallback(() => {
    stopSpeaking();
    cancelSpeech();
  }, [cancelSpeech]);
  useEffect(() => {
    const onFlush = () => stopVoice();
    window.addEventListener("lingua:flush", onFlush);
    return () => window.removeEventListener("lingua:flush", onFlush);
  }, [stopVoice]);

  const toggleMic = useCallback(() => {
    if (!speech.listening && !speech.starting)
      speechBase.current = inputRef.current?.value.trim() ?? "";
    feel.tap();
    speech.toggle();
  }, [speech]);
  const retryMic = useCallback(() => {
    feel.tap();
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

  // Android back: claim the press when one of this screen's sheets/the keyboard is open.
  // `platform.dispatchBack()` owns the route/exit decision after every listener ran, so
  // this handler must never exit the app itself.
  useEffect(() => {
    const onBack = (event: Event) => {
      // An overlay (LanguageSheet/VoiceSheet) already handled and cancelled this press.
      if (event.defaultPrevented) return;
      const claim = () => event.preventDefault();
      if (savedOpen) {
        claim();
        return setSavedOpen(false);
      }
      if (dialectOpen) {
        claim();
        return setDialectOpen(false);
      }
      if (localeOpen) {
        claim();
        return setLocaleOpen(false);
      }
      if (lexOpen) {
        claim();
        return setLexOpen(false);
      }
      if (shadowMapOpen) {
        claim();
        return setShadowMapOpen(false);
      }
      if (shadowFocus) {
        claim();
        return setShadowFocus(null);
      }
      if (introOpen) {
        claim();
        return finishIntro();
      }
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
        // Dismiss the keyboard first; `platform.dispatchBack` decides after this handler.
        claim();
        active.blur();
      }
    };
    window.addEventListener("lingua:back", onBack);
    return () => window.removeEventListener("lingua:back", onBack);
  }, [
    savedOpen,
    dialectOpen,
    localeOpen,
    lexOpen,
    shadowMapOpen,
    shadowFocus,
    introOpen,
    finishIntro,
  ]);
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
    void saved.toggle({
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
  // Memoised with the other ResultPanel props: typing must not re-render a long answer.
  const suggestKey = `${text.trim()}|${style}`;
  const suggestion = useMemo(() => {
    const proposed = result ? styleSuggestion({ situation: result.situation, style }) : null;
    if (!proposed || dismissedFor === suggestKey) return null;
    return {
      label: t(proposed.key),
      onApply: () => setStyle(proposed.next),
      onDismiss: () => setDismissedFor(suggestKey),
    };
  }, [result, style, dismissedFor, suggestKey, t]);

  const today = useMemo(
    () =>
      restored && !hasText && todayKey
        ? savedList.length
          ? saved.ofTheDay(todayKey)
          : null
        : null,
    [restored, hasText, todayKey, savedList],
  );
  const idle = useMemo(
    () =>
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
          <span dir="auto" className="mt-1 block text-start text-[14px] text-muted-foreground">
            {today.original}
          </span>
        </button>
      ) : undefined,
    [today, pickSaved, t],
  );
  const shadowSummary = useMemo(
    () =>
      validUndo || shadowState.status === "loading" || shadowState.status === "ready" ? (
        <ShadowSummary
          status={shadowState.status === "ready" ? "ready" : "loading"}
          losses={shadowLosses}
          onPick={pickShadow}
          onMap={() => setShadowMapOpen(true)}
          undo={validUndo ? { onUndo: undoShadow } : null}
        />
      ) : null,
    [validUndo, shadowState, shadowLosses, pickShadow, undoShadow],
  );

  return (
    <>
      {introMounted ? <Intro onComplete={finishIntro} /> : null}
      <a href="#composer" className="skip-link" inert={introOpen}>
        {t("skipToInput")}
      </a>
      <main
        inert={introOpen}
        className="mx-auto flex h-[100dvh] max-h-[var(--vvh,100dvh)] w-full max-w-xl flex-col overflow-hidden bg-background"
      >
        <OfflinePill />
        <AppHeader
          tagline={tagline}
          onToggleTagline={toggleTagline}
          locale={locale}
          onLocaleSelect={(l) => setLocale(l)}
          localeOpen={localeOpen}
          onOpenLocale={() => setLocaleOpen(true)}
          onCloseLocale={closeLocale}
          canInstall={canInstall}
          onInstall={() => void install()}
          onOpenSaved={() => setSavedOpen(true)}
          savedLabel={t("savedTitle")}
        />

        <div
          ref={scrollRef}
          className={`flex flex-1 flex-col overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))] ${
            kbUp ? "justify-start pt-1" : "justify-start pt-1.5"
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
          <div
            className="canvas-shell mx-3 flex flex-col overflow-hidden rounded-[22px] bg-surface"
            data-keyboard={kbUp ? "open" : undefined}
          >
            <section
              dir={uiRtl ? "rtl" : "ltr"}
              onTouchStart={onComposerTouchStart}
              onTouchMove={onComposerTouchMove}
              onTouchEnd={onComposerTouchEnd}
              className="source-stage input-shell relative px-5 pb-2 pt-5"
            >
              {pullDistance > 6 ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-1.5 z-10 flex justify-center"
                >
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium shadow-sm transition-all ${
                      pullDistance > 50
                        ? "bg-signal text-signal-foreground"
                        : "bg-card text-muted-foreground"
                    }`}
                  >
                    <ArrowDown
                      className={`size-3 transition-transform ${pullDistance > 50 ? "rotate-180" : ""}`}
                      strokeWidth={2}
                    />
                    {pullDistance > 50 ? t("releaseToClear") : t("pullToClear")}
                  </span>
                </div>
              ) : null}
              <textarea
                id="composer"
                ref={inputRef}
                value={text}
                onChange={onInput}
                onPaste={onPaste}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  event.preventDefault();
                  const value = event.currentTarget.value.slice(0, MAX_CHARS);
                  if (value !== text) setText(value);
                  translateNow(value);
                }}
                onCompositionEnd={(event) => {
                  // Android IMEs can leave the visible value ahead of React state.
                  const value = event.currentTarget.value.slice(0, MAX_CHARS);
                  if (value !== text) {
                    setText(value);
                    submitNext();
                  }
                }}
                onBlur={(event) => {
                  const value = event.currentTarget.value.slice(0, MAX_CHARS);
                  if (value !== text) {
                    setText(value);
                    submitNext();
                  }
                }}
                dir={rtlInput ? "rtl" : "ltr"}
                rows={2}
                autoCapitalize="sentences"
                autoComplete="off"
                enterKeyHint="done"
                spellCheck
                placeholder={t("placeholder")}
                aria-label={t("inputLabel")}
                className={`composer-field block w-full resize-none bg-transparent pe-14 outline-none ${
                  rtlInput
                    ? "font-arabic text-[24px] leading-[1.7]"
                    : "text-[22px] leading-[1.45] tracking-[-0.015em]"
                } ${speech.listening ? "text-transparent caret-transparent" : ""}`}
              />
              {speech.listening ? (
                /* Spoken words surface softly: each new word condenses out of a blur instead of popping in. */
                <div
                  ref={speechEcho}
                  aria-hidden
                  dir={rtlInput ? "rtl" : "ltr"}
                  className={`speech-echo pointer-events-none absolute inset-x-5 top-5 whitespace-pre-wrap break-words pe-14 ${
                    rtlInput
                      ? "font-arabic text-[24px] leading-[1.7]"
                      : "text-[22px] leading-[1.45] tracking-[-0.015em]"
                  }`}
                >
                  {/* eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered */}
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
                onClick={() => {
                  speech.cancel();
                  speechBase.current = "";
                  clear();
                }}
                aria-label={t("clearText")}
                tabIndex={hasText ? 0 : -1}
                className={`press absolute top-4 grid size-10 place-items-center rounded-full text-faint transition-[opacity,transform] duration-200 hover:text-foreground ${rtlInput ? "left-3" : "right-3"} ${
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
                        {speech.message ??
                          t(
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
                  {!speech.listening ? (
                    <button
                      type="button"
                      onClick={() => {
                        const value = (inputRef.current?.value ?? text).slice(0, MAX_CHARS);
                        if (value !== text) setText(value);
                        translateNow(value);
                      }}
                      aria-label={t("translateNow")}
                      className={`press grid size-9 place-items-center rounded-full bg-signal text-signal-foreground transition-opacity ${hasText ? "opacity-100" : "opacity-50"}`}
                    >
                      <ArrowUp className="size-4" strokeWidth={2} />
                    </button>
                  ) : null}
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
                onApply={() =>
                  mismatch.suggest === "auto" ? setSource("auto") : chooseSource(mismatch.suggest)
                }
                onDismiss={() => setLangDismissed(mismatchKey)}
              />
            ) : null}
            <div className="live-line mx-5" data-live={pending ? "true" : "false"} />

            <div className="result-stage">
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
                  suggestion={suggestion}
                  idle={idle}
                  onDictionary={lexicon || lexiconLoading ? openLex : undefined}
                  dictionaryReady={!!lexicon}
                  shadowOn={shadowOn}
                  onToggleShadow={toggleShadow}
                  shadow={shadowProp}
                  shadowSummary={shadowSummary}
                />
              </SafeArea>
            </div>
          </div>
          {/* Public pages reachable for keyboard and search, without adding chrome to the translator. */}
          <nav
            dir={uiRtl ? "rtl" : "ltr"}
            aria-label={t("pairGuide")}
            className="flex items-center justify-center gap-4 pb-1 text-[11px] text-faint"
          >
            <Link
              viewTransition
              to="/arabic-german-translation"
              className="press-soft underline-offset-4 hover:underline"
            >
              {t("pairGuide")}
            </Link>
            <span aria-hidden className="size-1 rotate-45 rounded-[1px] bg-border-strong" />
            <Link
              viewTransition
              to="/privacy"
              className="press-soft underline-offset-4 hover:underline"
            >
              {t("privacy")}
            </Link>
          </nav>
        </div>

        <SafeArea silent>
          <Suspense fallback={null}>
            <IosInstallSheet open={showIosGuide} onClose={closeIosGuide} />
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
            <SavedSheet
              open={savedOpen}
              entries={savedList}
              onClose={() => setSavedOpen(false)}
              onPick={pickSaved}
            />
          </Suspense>
        </SafeArea>
      </main>
    </>
  );
}

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
