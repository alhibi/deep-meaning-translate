import { memo } from "react";
import type { StyleOverride } from "@/lib/translation/types";
import { useI18n } from "@/lib/i18n";

const OPTIONS: StyleOverride[] = ["natural", "formal", "casual"];

/** Quiet text-only switch: the active style is ink with a signal tick; the rest recede. */
export const StyleToggle = memo(function StyleToggle({
  value,
  onChange,
}: {
  value: StyleOverride;
  onChange: (v: StyleOverride) => void;
}) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("style")} className="flex items-center">
      {OPTIONS.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o)}
            className={`press-soft relative h-9 px-2.5 text-[13px] transition-colors ${
              active ? "font-medium text-foreground" : "text-faint hover:text-muted-foreground"
            }`}
          >
            {t(o)}
            <span
              aria-hidden
              className={`absolute inset-x-2.5 bottom-1 h-px bg-signal transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0"}`}
            />
          </button>
        );
      })}
    </div>
  );
});
