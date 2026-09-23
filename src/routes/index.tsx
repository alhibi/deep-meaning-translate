import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownToLine, Clock3, X } from "lucide-react";
import { initServiceWorker } from "@/lib/pwa";
import { useInstallPrompt } from "@/lib/useInstallPrompt";
import { LanguageBar } from "@/components/translator/LanguageBar";
import { StyleToggle } from "@/components/translator/StyleToggle";
import { ResultPanel } from "@/components/translator/ResultPanel";
import { HistorySheet } from "@/components/translator/HistorySheet";
import { useTranslator } from "@/lib/translation/useTranslator";
import type { StyleOverride, TranslationResult } from "@/lib/translation/types";
import { isRtl } from "@/lib/translation/languages";
import { history, type HistoryEntry } from "@/lib/history";

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

  useEffect(() => {
    setEntries(history.list());
    initServiceWorker();
  }, []);

  const handleSuccess = useCallback(
    (result: TranslationResult, original: string) => {
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

  const { result: raw, pending: rawPending, error, retry } = useTranslator({
    text,
    source,
    target,
    style,
    onSuccess: handleSuccess,
  });

  const detected = raw?.sourceLanguage;
  // Same-language result (auto-detect hit the target): hold it back while we re-route.
  const rerouting =
    source === "auto" &&
    !!raw &&
    (lang2(raw.sourceLanguage) === lang2(raw.targetLanguage) || raw.translation.trim() === text.trim());
  const result = rerouting ? null : raw;
  const pending = rawPending || rerouting;

  // Auto-detected source equals target: flip to the Arabic↔German partner.
  useEffect(() => {
    if (source === "auto" && detected && detected === target) {
      setTarget(detected === "ar" ? "de" : detected === "de" ? "ar" : target === "de" ? "ar" : "de");
    }
  }, [source, detected, target]);

  const swap = useCallback(() => {
    const nextSource = target;
    const nextTarget = source === "auto" ? (detected ?? "en") : source;
    setSource(nextSource);
    setTarget(nextTarget === nextSource ? (nextSource === "de" ? "ar" : "de") : nextTarget);
    if (result?.translation) setText(result.translation);
  }, [source, target, detected, result]);

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

  const clear = useCallback(() => {
    setText("");
    inputRef.current?.focus();
  }, []);

  const openHistory = useCallback(() => setHistoryOpen(true), []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const clearHistory = useCallback(() => setEntries(history.clear()), []);
  const pickHistory = useCallback((e: HistoryEntry) => {
    setText(e.original);
    setSource(e.source);
    setTarget(e.target);
    setHistoryOpen(false);
  }, []);

  const rtlInput = isRtl(source === "auto" ? (detected ?? "") : source);
  const hasText = text.length > 0;

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col bg-background">
      <header className="flex items-center justify-between px-5 pad-safe-top pb-1">
        <span className="font-display text-[20px] tracking-tight">Lingua</span>
        <div className="flex items-center gap-1">
          {canInstall ? (
            <button
              type="button"
              onClick={() => void install()}
              className="press-soft animate-fade inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] text-muted-foreground"
            >
              <ArrowDownToLine className="size-3.5" strokeWidth={1.75} />
              Install
            </button>
          ) : null}
          <button
            type="button"
            onClick={openHistory}
            aria-label="Recent translations"
            className="press grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <Clock3 className="size-[18px]" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <LanguageBar
        source={source}
        target={target}
        detected={detected}
        onSource={setSource}
        onTarget={setTarget}
        onSwap={swap}
      />

      <section className="input-shell relative px-5 pt-4">
        <textarea
          ref={inputRef}
          value={text}
          onChange={onInput}
          dir={rtlInput ? "rtl" : "auto"}
          rows={3}
          autoCapitalize="sentences"
          autoComplete="off"
          enterKeyHint="done"
          spellCheck
          placeholder="Write or paste anything"
          aria-label="Text to translate"
          className={`autogrow block w-full resize-none bg-transparent pe-9 text-[20px] tracking-tight outline-none placeholder:text-muted-foreground/60 ${
            rtlInput ? "leading-[1.75]" : "leading-[1.5]"
          }`}
        />
        <button
          type="button"
          onClick={clear}
          aria-label="Clear text"
          tabIndex={hasText ? 0 : -1}
          className={`press absolute end-2 top-3 grid size-10 place-items-center rounded-full text-muted-foreground transition-[opacity,transform] duration-200 ${
            hasText ? "opacity-100" : "pointer-events-none scale-90 opacity-0"
          }`}
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>
        <div className="mt-2 flex h-9 items-center justify-between">
          <StyleToggle value={style} onChange={setStyle} />
          <span
            className={`text-[11px] tabular-nums text-muted-foreground transition-opacity duration-300 ${
              text.length > MAX_CHARS * 0.7 ? "opacity-100" : "opacity-0"
            }`}
          >
            {text.length}/{MAX_CHARS}
          </span>
        </div>
      </section>

      <div className="mt-3 border-t border-border">
        <ResultPanel
          result={result}
          pending={pending}
          error={error}
          target={target}
          onRetry={retry}
        />
      </div>

      <div className="flex-1 pad-safe-bottom" />

      <HistorySheet
        open={historyOpen}
        entries={entries}
        onClose={closeHistory}
        onPick={pickHistory}
        onClear={clearHistory}
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
