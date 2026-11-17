import { memo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, PlusSquare, Share, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useFocusTrap } from "@/lib/useFocusTrap";

export const IosInstallSheet = memo(function IosInstallSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t, rtl } = useI18n();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);

  useFocusTrap(open, sheetRef);

  if (!open || typeof document === "undefined") return null;

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

  return createPortal(
    <div
      ref={sheetRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t("installIosTitle")}
      dir={rtl ? "rtl" : "ltr"}
      className="fixed inset-0 z-50 flex flex-col justify-end outline-none"
    >
      <div onClick={onClose} className="animate-sheet-scrim absolute inset-0 bg-background/70" />
      <div
        style={{
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: drag ? "none" : undefined,
        }}
        className="animate-sheet-in relative z-10 mx-auto flex max-h-[82dvh] w-full max-w-xl flex-col rounded-t-[26px] border-t border-border bg-surface pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="flex shrink-0 touch-none cursor-grab justify-center py-2.5 active:cursor-grabbing"
        >
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-border-strong" />
        </div>

        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-1">
          <h2 className="text-[16px] font-semibold text-foreground">{t("installIosTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="press-soft grid size-9 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="size-[18px]" strokeWidth={1.75} />
          </button>
        </div>

        <div className="space-y-3.5 px-5 py-4">
          <div className="flex items-center gap-3.5 rounded-2xl bg-card p-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-signal/15 text-signal-text">
              <Share className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
                1
              </span>
              <p className="text-[14px] text-foreground">{t("installIosStep1")}</p>
            </div>
          </div>

          <div className="flex items-center gap-3.5 rounded-2xl bg-card p-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-signal/15 text-signal-text">
              <PlusSquare className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
                2
              </span>
              <p className="text-[14px] text-foreground">{t("installIosStep2")}</p>
            </div>
          </div>

          <div className="flex items-center gap-3.5 rounded-2xl bg-card p-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-signal/15 text-signal-text">
              <Check className="size-5" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
                3
              </span>
              <p className="text-[14px] text-foreground">{t("installIosStep3")}</p>
            </div>
          </div>
        </div>

        <div className="px-5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="press flex h-11 w-full items-center justify-center rounded-full bg-signal text-[14px] font-medium text-signal-foreground"
          >
            {t("installIosDone")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
});
