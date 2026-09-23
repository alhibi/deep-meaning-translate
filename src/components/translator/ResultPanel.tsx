import { memo, useEffect, useState } from "react";
import { Check, Copy, RotateCw, Share2, Volume2 } from "lucide-react";
import type { TranslationResult } from "@/lib/translation/types";
import { isRtl } from "@/lib/translation/languages";
import type { ErrorKind } from "@/lib/translation/useTranslator";

const ERROR_COPY: Record<ErrorKind, string> = {
  auth: "Translation isn't connected yet.",
  rate: "Too many translations at once. Give it a moment.",
  network: "The connection dropped before the translation finished.",
  provider: "Something interrupted the translation.",
  input: "That text couldn't be translated as written.",
};

function Action({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-10 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

export const ResultPanel = memo(function ResultPanel({
  result,
  pending,
  error,
  target,
  onRetry,
}: {
  result: TranslationResult | null;
  pending: boolean;
  error: ErrorKind | null;
  target: string;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showAlt, setShowAlt] = useState(false);

  useEffect(() => {
    setShowAlt(false);
  }, [result]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);

  if (error && !result) {
    return (
      <div className="animate-rise px-5 py-6">
        <p className="text-[15px] text-muted-foreground">{ERROR_COPY[error]}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-border-strong px-4 py-2 text-[13px] transition-colors active:bg-muted"
        >
          <RotateCw className="size-3.5" strokeWidth={1.75} /> Try again
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="px-5 py-6 text-[15px] text-muted-foreground">
        {pending ? "Translating…" : "Translation appears here."}
      </div>
    );
  }

  const rtl = isRtl(target);
  const text = result.translation;

  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true));
  };
  const speak = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = result.targetLanguage || target;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };
  const share = () => {
    if (navigator.share) void navigator.share({ text }).catch(() => undefined);
    else copy();
  };

  return (
    <div className={`px-5 pb-4 pt-5 ${pending ? "opacity-55" : "animate-rise"} transition-opacity`}>
      <p
        dir={rtl ? "rtl" : "ltr"}
        className={`whitespace-pre-wrap break-words font-display text-[26px] leading-[1.35] tracking-tight ${
          rtl ? "text-right" : "text-left"
        }`}
      >
        {text}
      </p>

      {result.isAmbiguous && result.alternativeTranslations.length > 0 ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowAlt((v) => !v)}
            className="text-[12px] text-muted-foreground underline underline-offset-4"
          >
            {showAlt ? "Hide other reading" : "This could also mean…"}
          </button>
          {showAlt ? (
            <ul className="mt-2 space-y-2 border-l border-border pl-3">
              {result.alternativeTranslations.map((alt) => (
                <li
                  key={alt}
                  dir={rtl ? "rtl" : "ltr"}
                  className="text-[15px] leading-relaxed text-muted-foreground"
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

      <div className="mt-3 flex items-center gap-1">
        <Action label="Copy translation" onClick={copy}>
          {copied ? (
            <Check className="size-[18px] text-accent" strokeWidth={1.75} />
          ) : (
            <Copy className="size-[18px]" strokeWidth={1.75} />
          )}
        </Action>
        <Action label="Listen" onClick={speak}>
          <Volume2 className="size-[18px]" strokeWidth={1.75} />
        </Action>
        <Action label="Share" onClick={share}>
          <Share2 className="size-[18px]" strokeWidth={1.75} />
        </Action>
        {error ? (
          <button
            type="button"
            onClick={onRetry}
            className="ml-auto text-[12px] text-muted-foreground underline underline-offset-4"
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
});
