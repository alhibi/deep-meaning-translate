import { memo } from "react";
import { X } from "lucide-react";
import type { HistoryEntry } from "@/lib/history";
import { isRtl, languageLabel } from "@/lib/translation/languages";

export const HistorySheet = memo(function HistorySheet({
  open,
  entries,
  onClose,
  onPick,
  onClear,
}: {
  open: boolean;
  entries: HistoryEntry[];
  onClose: () => void;
  onPick: (entry: HistoryEntry) => void;
  onClear: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-foreground/15 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Close recent translations"
        className="flex-1"
        onClick={onClose}
      />
      <div className="animate-rise max-h-[72vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card pad-safe-bottom">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <span className="text-[13px] tracking-tight text-muted-foreground">Recent</span>
          <div className="flex items-center gap-2">
            {entries.length > 0 ? (
              <button
                type="button"
                onClick={onClear}
                className="text-[12px] text-muted-foreground underline underline-offset-4"
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-9 place-items-center rounded-full text-muted-foreground active:bg-muted"
            >
              <X className="size-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="px-5 py-8 text-[14px] text-muted-foreground">Nothing here yet.</p>
        ) : (
          <ul>
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onPick(e)}
                  className="w-full border-b border-border px-5 py-4 text-left transition-colors active:bg-muted"
                >
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {languageLabel(e.source)} → {languageLabel(e.target)}
                  </span>
                  <span
                    dir={isRtl(e.target) ? "rtl" : "ltr"}
                    className="mt-1 line-clamp-2 block text-[15px] leading-snug"
                  >
                    {e.translated}
                  </span>
                  <span className="mt-0.5 line-clamp-1 block text-[13px] text-muted-foreground">
                    {e.original}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});
