import { memo, useMemo } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { languageLabel } from "@/lib/translation/languages";
import type { SourceMismatch } from "@/lib/translation/languageCheck";

/** Gentle, one-tap hint when the text isn't in the picked source language. */
export const LanguageNotice = memo(function LanguageNotice({
  mismatch,
  source,
  onApply,
  onDismiss,
}: {
  mismatch: SourceMismatch;
  source: string;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { t, locale } = useI18n();
  const name = useMemo(() => {
    let dn: Intl.DisplayNames | null = null;
    try {
      dn = new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      /* older engines: native names */
    }
    return (code: string) => dn?.of(code) ?? languageLabel(code);
  }, [locale]);
  const auto = mismatch.suggest === "auto";
  const message = (auto ? t("langNot") : t("langLooks"))
    .replace("{lang}", auto ? "" : name(mismatch.suggest))
    .replace("{picked}", name(source));
  return (
    <div
      role="status"
      data-testid="language-notice"
      className="animate-rise mx-5 mb-1 flex items-center gap-3 rounded-2xl bg-card px-3.5 py-2.5 text-[12.5px]"
    >
      <span aria-hidden className="size-1.5 shrink-0 rotate-45 bg-warning" />
      <span className="min-w-0 flex-1 leading-snug text-muted-foreground">
        {message}
        <button
          type="button"
          onClick={onApply}
          className="press-soft ms-2 inline font-medium text-signal-text underline decoration-signal/40 underline-offset-4"
        >
          {auto ? t("langAuto") : t("langSwitch").replace("{lang}", name(mismatch.suggest))}
        </button>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("sit_dismiss")}
        className="press-soft -me-1 grid size-8 shrink-0 place-items-center rounded-full text-faint hover:text-foreground"
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
});
