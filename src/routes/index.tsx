import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownToLine, ClipboardPaste, Clock3, X } from "lucide-react";
import { initServiceWorker } from "@/lib/pwa";
import { useInstallPrompt } from "@/lib/useInstallPrompt";
import { LanguageBar } from "@/components/translator/LanguageBar";
import { StyleToggle } from "@/components/translator/StyleToggle";
import { ResultPanel } from "@/components/translator/ResultPanel";
import { LanguageSheet } from "@/components/translator/LanguageSheet";
import { HistorySheet } from "@/components/translator/HistorySheet";
import { useTranslator } from "@/lib/translation/useTranslator";
import type { StyleOverride, TranslationResult } from "@/lib/translation/types";
import { isRtl } from "@/lib/translation/languages";
import { history, type HistoryEntry } from "@/lib/history";
import { persist } from "@/lib/persist";
import { LOCALES, LOCALE_NAME, LOCALE_SHORT, initLocale, setLocale, useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lingua — meaning-first translation" },
      {
        name: "description",
        content:
          "A quiet, fast translator that carries meaning, tone and nuance across languages — built for Arabic and German.",
      },
      { property: "og:title", content: "Lingua — meaning-first translation" },
      {
        property: "og:description",
        content:
          "Translate what you actually mean. Tone, idioms and cultural nuance preserved, Arabic ⇄ German first.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Translator,
});

const MAX_CHARS = 5000;

function Translator() {
  const [text, setText] = useState("");
  const [source, setSource] = useState("auto");
  const [target, setTarget] = useState("de");
  const [style, setStyle] = useState<StyleOverride>("natural");
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { canInstall, install } = useInstallPrompt();

  const handleSuccess = useCallback(
    (result: TranslationResult, original: string, provisional: boolean) => {
      if (provisional) return; // only settled thoughts become history
      if (lang2(result.sourceLanguage) === lang2(target)) return; // about to re-route
      setEntries(
        history.add({
          source: result.sourceLanguage || source,
          target,
          original,
          translated: result.translation,
        }),
      );
    },
    [source, target],
  );

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
    source,
    target,
    style,
    onSuccess: handleSuccess,
  });

  // Boot: restore the device-local session, or open around text shared into the app.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    setEntries(history.list());
    initServiceWorker();
    initLocale();
    const prefs = persist.prefs();
    if (prefs) {
      setSource(prefs.source);
      setTarget(prefs.target);
      setStyle(prefs.style);
    }
    const params = new URLSearchParams(window.location.search);
    const shared = [params.get("title"), params.get("text"), params.get("url")]
      .filter(Boolean)
      .join("\n")
      .trim();
    if (shared) {
      window.history.replaceState(null, "", "/");
      submitNext();
      setText(shared.slice(0, MAX_CHARS));
    } else {
      const session = persist.session();
      if (session?.text) {
        if (session.result) prime(session.text, session.source, session.target, session.style, session.result);
        submitNext();
        setText(session.text);
      }
    }
    setRestored(true);
  }, [submitNext, prime]);

  useEffect(() => {
    if (restored) persist.savePrefs({ source, target, style });
  }, [restored, source, target, style]);

  useEffect(() => {
    if (!restored) return;
    const id = setTimeout(
      () => persist.saveSession({ text, result: provisional ? null : raw, source, target, style }),
      400,
    );
    return () => clearTimeout(id);
  }, [restored, text, raw, provisional, source, target, style]);

  const detected = raw?.sourceLanguage;
  // Same-language result (auto-detect hit the target): hold it back while we re-route.
  const rerouting =
    source === "auto" &&
    !!raw &&
    (lang2(raw.sourceLanguage) === lang2(raw.targetLanguage) || raw.translation.trim() === text.trim());
  // Never present a translation into a language the user no longer asked for.
  const staleTarget = !!raw && !!raw.targetLanguage && lang2(raw.targetLanguage) !== target;
  const result = rerouting || staleTarget ? null : raw;
  const pending = rawPending || rerouting || (staleTarget && !!text.trim());

  // Auto-detected source equals target: flip to the Arabic↔German partner.
  useEffect(() => {
    if (source === "auto" && detected && detected === target) {
      setTarget(detected === "ar" ? "de" : detected === "de" ? "ar" : target === "de" ? "ar" : "de");
    }
  }, [source, detected, target]);

  // Arabic script is unambiguous: route before the first request instead of after a wasted one.
  const arabicScript = text.trim() ? startsRtl(text) : false;
  useEffect(() => {
    if (source === "auto" && arabicScript && target === "ar") setTarget("de");
  }, [source, arabicScript, target]);

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
      source === "auto" ? (detected ?? (arabicScript ? "ar" : target === "ar" ? "de" : "ar")) : source;
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
  const canReadClipboard = restored && typeof navigator !== "undefined" && !!navigator.clipboard?.readText;
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

  // Android back closes the sheet instead of leaving the app; the translator stays home.
  const openHistory = useCallback(() => {
    window.history.pushState({ sheet: "history" }, "");
    setHistoryOpen(true);
  }, []);
  const closeHistory = useCallback(() => {
    if (window.history.state?.sheet === "history") window.history.back();
    else setHistoryOpen(false);
  }, []);
  useEffect(() => {
    const onPop = () => setHistoryOpen(false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const forgetAll = useCallback(() => {
    persist.clearAll();
    setEntries([]);
    setText("");
    closeHistory();
  }, [closeHistory]);
  const clearHistory = useCallback(() => setEntries(history.clear()), []);
  const pickHistory = useCallback((e: HistoryEntry) => {
    setText(e.original);
    setSource(e.source);
    setTarget(e.target);
    submitNext();
    closeHistory();
  }, [submitNext, closeHistory]);

  const { t, locale, rtl: uiRtl } = useI18n();
  const [tagline, setTagline] = useState(false);
  const taglineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleTagline = useCallback(() => {
    if (taglineTimer.current) clearTimeout(taglineTimer.current);
    setTagline((v) => {
      if (!v) taglineTimer.current = setTimeout(() => setTagline(false), 4200);
      return !v;
    });
  }, []);
  const [localeOpen, setLocaleOpen] = useState(false);
  const closeLocale = useCallback(() => setLocaleOpen(false), []);
  const rtlInput = text.trim() ? startsRtl(text) : source === "auto" ? uiRtl : isRtl(source);
  const hasText = text.length > 0;

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col bg-background">
      <header className="flex items-center justify-between px-5 pad-safe-top pb-1">
        <button
          type="button"
          onClick={toggleTagline}
          aria-expanded={tagline}
          className="press-soft -ms-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[15px] font-semibold tracking-[-0.01em] text-foreground"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-signal" />
          today
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setLocaleOpen(true)}
            aria-haspopup="dialog"
            aria-label={t("uiLanguage")}
            className="press-soft grid h-9 min-w-9 place-items-center rounded-full px-2 text-[12px] font-medium tracking-wide text-muted-foreground"
          >
            <span aria-hidden className={locale === "ar" ? "font-arabic text-[14px]" : ""}>{LOCALE_SHORT[locale]}</span>
          </button>
          <LanguageSheet
            open={localeOpen}
            title={t("uiLanguage")}
            searchable={false}
            items={LOCALES.map((l) => ({ code: l, native: LOCALE_NAME[l], name: LOCALE_NAME[l], rtl: l === "ar" }))}
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
          <button
            type="button"
            onClick={openHistory}
            aria-label={t("recent")}
            className="press grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <Clock3 className="size-[18px]" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* Tagline: revealed only when the name is pressed; a reserved line, so nothing shifts. */}
      <div className="flex h-9 items-center justify-center px-6" aria-hidden={!tagline}>
        <span
          className={`font-literary text-[20px] italic leading-none text-muted-foreground transition-opacity duration-500 ${
            tagline ? "opacity-100" : "opacity-0"
          }`}
        >
          Say it naturally.
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-center pb-[6dvh]">
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
          <section dir={rtlInput ? "rtl" : "ltr"} className="input-shell relative px-5 pb-2 pt-5">
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
              className={`autogrow block w-full resize-none bg-transparent pe-10 outline-none ${
                rtlInput ? "font-arabic text-[24px] leading-[1.7]" : "text-[22px] leading-[1.45] tracking-[-0.015em]"
              }`}
            />
            <button
              type="button"
              onClick={clear}
              aria-label={t("clearText")}
              tabIndex={hasText ? 0 : -1}
              className={`press absolute end-3 top-4 grid size-10 place-items-center rounded-full text-faint transition-[opacity,transform] duration-200 hover:text-foreground ${
                hasText ? "opacity-100" : "pointer-events-none scale-90 opacity-0"
              }`}
            >
              <X className="size-[18px]" strokeWidth={1.6} />
            </button>
            <div className="flex h-10 items-center justify-end gap-3">
              {!hasText && canReadClipboard ? (
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
          </section>

          <div className="flex items-center justify-between px-3">
            <StyleToggle value={style} onChange={setStyle} />
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
          <div className="live-line mx-5" data-live={pending ? "true" : "false"} />

          <div>
            <ResultPanel
              result={result}
              pending={pending}
              provisional={provisional}
              error={error}
              target={target}
              onRetry={retry}
            />
          </div>
        </div>
      </div>
      <div className="h-3 pad-safe-bottom" />

      <HistorySheet
        open={historyOpen}
        entries={entries}
        onClose={closeHistory}
        onPick={pickHistory}
        onClear={clearHistory}
        onForgetAll={forgetAll}
      />
    </main>
  );
}

const SUPPORTS_FIELD_SIZING =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

const useLayoutEffectSafe = typeof window === "undefined" ? useEffect : useLayoutEffect;

function lang2(code: string | undefined) {
  return (code ?? "").slice(0, 2).toLowerCase();
}

/** Direction follows the first strong character the user typed. */
function startsRtl(value: string) {
  const m = value.match(/[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/);
  return !!m && /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(m[0]);
}
