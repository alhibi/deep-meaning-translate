import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Key } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { isRtl, languageLabel } from "@/lib/translation/languages";
import type { Dialect } from "@/lib/translation/types";
import type { LexiconResult } from "@/lib/translation/lexicon";
import { LexiconPanel } from "./LexiconPanel";

const DIALECT_LABEL: Record<Exclude<Dialect, "auto">, Key> = {
  msa: "d_msa",
  levant: "d_levant",
  egypt: "d_egypt",
  gulf: "d_gulf",
  iraq: "d_iraq",
  maghreb: "d_maghreb",
};

/**
 * Mini dictionary window: opens from the result toolbar, never pushes the page around.
 * The header carries the identity of the lookup (term, direction, Arabic variety) so the
 * reading is never shown detached from the word and context it was ranked for.
 */
export function LexiconSheet({
  open,
  value,
  loading,
  onClose,
}: {
  open: boolean;
  value: LexiconResult | null;
  loading: boolean;
  onClose: () => void;
}) {
  const { t, rtl } = useI18n();
  const sheetRef = useRef<HTMLDivElement>(null);
  const pushed = useRef(false);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0]?.clientY ?? null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
    if (dy > 0) setDrag(dy);
  };

  const onTouchEnd = () => {
    if (drag > 75) onClose();
    setDrag(0);
    startY.current = null;
  };

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ sheet: "lexicon" }, "");
    pushed.current = true;
    const onPop = () => {
      pushed.current = false;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      }
    };
  }, [open, onClose]);

  useFocusTrap(open, sheetRef);
  if (!open || typeof document === "undefined") return null;

  const sourceRtl = value ? isRtl(value.sourceLanguage) : false;
  const dialect =
    value?.targetLanguage === "ar" && value.dialect && value.dialect !== "auto"
      ? DIALECT_LABEL[value.dialect]
      : null;

  return createPortal(
    <div
      ref={sheetRef}
      tabIndex={-1}
      data-testid="lexicon-sheet"
      className="fixed inset-0 z-50 outline-none"
      dir={rtl ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
      aria-label={t("lexTitle")}
    >
      <div onClick={onClose} className="animate-sheet-scrim absolute inset-0 bg-background/70" />
      <div
        style={{
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: drag ? "none" : undefined,
        }}
        className="animate-sheet-in absolute inset-x-0 bottom-0 mx-auto flex max-h-[70dvh] w-full max-w-xl flex-col rounded-t-[26px] border-t border-border bg-surface"
      >
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="flex shrink-0 touch-none cursor-grab justify-center py-2.5 active:cursor-grabbing"
        >
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-border-strong" />
        </div>
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-1 pt-1">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-foreground">
              {t("lexTitle")}
              {value ? (
                <span
                  lang={value.sourceLanguage}
                  dir={sourceRtl ? "rtl" : "ltr"}
                  className={`ms-2 font-normal text-muted-foreground ${sourceRtl ? "font-arabic" : ""}`}
                >
                  {value.sourceTerm}
                </span>
              ) : null}
            </h2>
            {value ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-faint">
                {/* A language pair is directional, not prose: forcing LTR keeps the arrow
                    pointing from source to target in the Arabic interface too. */}
                <span dir="ltr" data-testid="lexicon-direction">
                  <bdi>{languageLabel(value.sourceLanguage)}</bdi>
                  <span aria-hidden> → </span>
                  <bdi>{languageLabel(value.targetLanguage)}</bdi>
                </span>
                {dialect ? <span className="text-signal-text">· {t(dialect)}</span> : null}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="press-soft grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground"
          >
            <X className="size-[18px]" strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
          <LexiconPanel value={value} loading={loading} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
