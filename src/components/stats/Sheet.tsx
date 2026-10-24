import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "@/lib/useFocusTrap";

/**
 * Bottom sheet for Statistics. Sheets can stack (a translation opened from a category);
 * Android back / Escape always close only the top one, and closing in-app pops the
 * history entry it pushed without closing the sheet underneath.
 */
type Entry = { id: symbol; close: () => void; release: () => void };
const stack: Entry[] = [];
let ignorePops = 0;
let afterPop: (() => void) | null = null;
let settled: (() => void)[] = [];
function flushSettled() {
  if (ignorePops > 0 || stack.length > 0) return;
  const list = settled;
  settled = [];
  for (const cb of list) cb();
}
/** Runs once no sheet is open and every history entry a sheet pushed is gone. */
export function onSheetsSettled(cb: () => void) {
  settled.push(cb);
  flushSettled();
}
let installed = false;
function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) {
      ignorePops--;
      const cb = afterPop;
      afterPop = null;
      cb?.();
      flushSettled();
      return;
    }
    stack.at(-1)?.close();
    flushSettled();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && stack.length) history.back();
  });
}

/**
 * Leave the page from inside open sheets: their history entries are removed first,
 * then `then` runs (e.g. navigation), so Back never lands on a stale sheet.
 */
export function leaveSheets(then: () => void) {
  const n = stack.length;
  if (!n) return then();
  for (const s of stack.splice(0)) s.release();
  ignorePops++;
  afterPop = then;
  window.history.go(-n);
}

export function Sheet({
  open,
  onClose,
  title,
  label,
  dir,
  closeLabel,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  label: string;
  dir: "rtl" | "ltr";
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const closeRef = useRef(onClose);
  const sheetRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    install();
    const id = Symbol("sheet");
    let pushed = true;
    window.history.pushState({ ...window.history.state, statsSheet: stack.length + 1 }, "");
    stack.push({
      id,
      close: () => {
        pushed = false;
        const i = stack.findIndex((s) => s.id === id);
        if (i >= 0) stack.splice(i, 1);
        closeRef.current();
      },
      release: () => {
        pushed = false;
      },
    });
    return () => {
      const i = stack.findIndex((s) => s.id === id);
      if (i >= 0) stack.splice(i, 1);
      if (pushed) {
        ignorePops++;
        window.history.back();
      }
    };
  }, [open]);

  useFocusTrap(open, sheetRef);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50"
      dir={dir}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div onClick={onClose} className="animate-sheet-scrim absolute inset-0 bg-background/70" />
      <div className="animate-sheet-in absolute inset-x-0 bottom-0 mx-auto flex max-h-[86dvh] w-full max-w-xl flex-col rounded-t-[26px] border-t border-border bg-surface">
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0 flex-1">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="press-soft -me-2 grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground"
          >
            <X className="size-[18px]" strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
        {footer ? <div className="shrink-0 border-t border-border px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
