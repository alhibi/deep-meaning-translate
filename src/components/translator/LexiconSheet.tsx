import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useFocusTrap } from "@/lib/useFocusTrap";
import type { LexiconResult } from "@/lib/translation/lexicon";
import { LexiconPanel } from "./LexiconPanel";

/** Mini dictionary window: opens from the result toolbar, never pushes the page around. */
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

  return createPortal(
    <div
      ref={sheetRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 outline-none"
      dir={rtl ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
      aria-label={t("lexTitle")}
    >
      <div onClick={onClose} className="animate-sheet-scrim absolute inset-0 bg-background/70" />
      <div className="animate-sheet-in elev-sheet absolute inset-x-0 bottom-0 mx-auto flex max-h-[70dvh] w-full max-w-xl flex-col rounded-t-[26px] border-t border-border bg-surface">
        <div className="flex shrink-0 items-center justify-between px-5 pb-1 pt-4">
          <h2 className="min-w-0 truncate text-[15px] font-semibold text-foreground">
            {t("lexTitle")}
            {value ? (
              <span dir="auto" className="ms-2 font-normal text-muted-foreground">
                {value.sourceTerm}
              </span>
            ) : null}
          </h2>
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
