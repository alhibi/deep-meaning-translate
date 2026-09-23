import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
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

  useEffect(() => {
    setEntries(history.list());
  }, []);

  const handleSuccess = useCallback(
    (result: TranslationResult, original: string) => {
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

  const { result, pending, error, retry } = useTranslator({
    text,
    source,
    target,
    style,
    onSuccess: handleSuccess,
  });

  const detected = result?.sourceLanguage;

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

  const autosize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 340)}px`;
  }, []);

  useEffect(autosize, [text, autosize]);

  const rtlInput = isRtl(source === "auto" ? (detected ?? "") : source);

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col bg-background">
      <header className="flex items-center justify-between px-5 pad-safe-top pb-2">
        <span className="font-display text-[19px] tracking-tight">Lingua</span>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          aria-label="Recent translations"
          className="grid size-10 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted hover:text-foreground"
        >
          <Clock3 className="size-[18px]" strokeWidth={1.75} />
        </button>
      </header>

      <LanguageBar
        source={source}
        target={target}
        detected={detected}
        onSource={setSource}
        onTarget={setTarget}
        onSwap={swap}
      />

      <section className="px-5 pt-4">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
          dir={rtlInput ? "rtl" : "ltr"}
          rows={3}
          autoCapitalize="sentences"
          spellCheck
          placeholder="Write or paste anything"
          aria-label="Text to translate"
          className="w-full resize-none bg-transparent text-[20px] leading-[1.5] tracking-tight outline-none placeholder:text-muted-foreground/70"
        />
        <div className="mt-2 flex items-center justify-between">
          <StyleToggle value={style} onChange={setStyle} />
          <span
            className={`text-[11px] tabular-nums text-muted-foreground transition-opacity ${
              text.length > MAX_CHARS * 0.7 ? "opacity-100" : "opacity-0"
            }`}
          >
            {text.length}/{MAX_CHARS}
          </span>
        </div>
      </section>

      <div className="mt-4 border-t border-border">
        <ResultPanel
          result={result}
          pending={pending}
          error={error}
          target={target}
          onRetry={retry}
        />
      </div>

      <div className="flex-1" />

      <HistorySheet
        open={historyOpen}
        entries={entries}
        onClose={() => setHistoryOpen(false)}
        onPick={(e) => {
          setText(e.original);
          setSource(e.source);
          setTarget(e.target);
          setHistoryOpen(false);
        }}
        onClear={() => setEntries(history.clear())}
      />
    </main>
  );
}
