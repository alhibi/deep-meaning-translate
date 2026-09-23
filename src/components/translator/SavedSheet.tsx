import { memo, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { saved, type SavedPhrase } from "@/lib/saved";
import { isRtl, languageLabel } from "@/lib/translation/languages";
import { useI18n } from "@/lib/i18n";

/** Personal phrasebook with a quiet flashcard review. */
export const SavedSheet = memo(function SavedSheet({
  open,
  entries,
  onClose,
  onPick,
}: {
  open: boolean;
  entries: SavedPhrase[];
  onClose: () => void;
  onPick: (p: SavedPhrase) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"list" | "review">("list");
  useEffect(() => {
    if (!open) setMode("list");
  }, [open]);
  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={t("savedTitle")} className="fixed inset-0 z-50 flex flex-col justify-end bg-foreground/20">
      <button type="button" aria-label={t("close")} className="flex-1" onClick={onClose} />
      <div className="animate-rise max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card pad-safe-bottom">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-4 text-[13px]">
            <button
              type="button"
              onClick={() => setMode("list")}
              className={mode === "list" ? "font-medium text-foreground" : "text-faint"}
            >
              {t("savedTitle")} <span className="tabular-nums text-faint">{entries.length || ""}</span>
            </button>
            {entries.length > 0 ? (
              <button
                type="button"
                onClick={() => setMode("review")}
                className={mode === "review" ? "font-medium text-foreground" : "text-faint"}
              >
                {t("review")}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="grid size-9 place-items-center rounded-full text-muted-foreground active:bg-muted"
          >
            <X className="size-[18px]" strokeWidth={1.75} />
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="px-5 py-8 text-[14px] leading-relaxed text-muted-foreground">{t("savedEmpty")}</p>
        ) : mode === "review" ? (
          <Review />
        ) : (
          <ul>
            {entries.map((e) => (
              <li key={e.id} className="flex items-start border-b border-border">
                <button
                  type="button"
                  onClick={() => onPick(e)}
                  className="min-w-0 flex-1 px-5 py-4 text-start transition-colors active:bg-muted"
                >
                  <span dir="ltr" className="block text-start text-[11px] uppercase tracking-wide text-muted-foreground">
                    {languageLabel(e.source)} → {languageLabel(e.target)}
                  </span>
                  <span dir={isRtl(e.target) ? "rtl" : "ltr"} lang={e.target} className={`mt-1 block text-start text-[16px] leading-snug ${isRtl(e.target) ? "font-arabic" : ""}`}>
                    {e.translated}
                  </span>
                  <span dir="auto" className="mt-0.5 line-clamp-2 block text-start text-[13px] text-muted-foreground">
                    {e.original}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => saved.remove(e.id)}
                  aria-label={t("remove")}
                  className="press-soft me-2 mt-3 grid size-9 shrink-0 place-items-center rounded-full text-faint hover:text-foreground"
                >
                  <X className="size-4" strokeWidth={1.6} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

function Review() {
  const { t } = useI18n();
  // Snapshot the queue once so marking a card doesn't reshuffle mid-session.
  const queue = useMemo(() => saved.reviewQueue().slice(0, 12), []);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const card = queue[i];

  if (!card) {
    return (
      <div className="animate-fade px-5 py-10 text-center">
        <p className="text-[15px] text-foreground">{t("reviewDone")}</p>
        <button
          type="button"
          onClick={() => {
            setI(0);
            setShown(false);
          }}
          className="press-soft mt-3 text-[13px] text-muted-foreground underline underline-offset-4"
        >
          {t("reviewAgain")}
        </button>
      </div>
    );
  }

  const next = (remembered: boolean) => {
    saved.mark(card.id, remembered);
    setShown(false);
    setI((n) => n + 1);
  };
  const rtlT = isRtl(card.target);

  return (
    <div key={card.id} className="animate-rise px-5 py-6">
      <p className="text-[11px] tabular-nums tracking-wide text-faint">
        {i + 1} / {queue.length}
      </p>
      <p dir="auto" className="mt-3 text-start text-[20px] leading-snug text-foreground">
        {card.original}
      </p>
      <button
        type="button"
        onClick={() => setShown(true)}
        disabled={shown}
        className="mt-5 block min-h-[88px] w-full rounded-2xl bg-surface px-4 py-4 text-start"
      >
        {shown ? (
          <span dir={rtlT ? "rtl" : "ltr"} lang={card.target} className={`animate-fade block text-start text-[20px] leading-snug text-signal-text ${rtlT ? "font-arabic" : ""}`}>
            {card.translated}
          </span>
        ) : (
          <span className="text-[13px] text-faint">{t("reveal")}</span>
        )}
      </button>
      <div className={`mt-4 flex gap-2 transition-opacity duration-200 ${shown ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <button type="button" onClick={() => next(false)} className="press h-11 flex-1 rounded-full bg-surface text-[13px] text-muted-foreground">
          {t("again")}
        </button>
        <button type="button" onClick={() => next(true)} className="press h-11 flex-1 rounded-full bg-signal text-[13px] font-medium text-signal-foreground">
          {t("knewIt")}
        </button>
      </div>
    </div>
  );
}
