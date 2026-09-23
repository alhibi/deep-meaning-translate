import { memo } from "react";
import type { StyleOverride } from "@/lib/translation/types";
import { useI18n } from "@/lib/i18n";

const OPTIONS: StyleOverride[] = ["natural", "formal", "casual"];

export const StyleToggle = memo(function StyleToggle({
  value,
  onChange,
}: {
  value: StyleOverride;
  onChange: (v: StyleOverride) => void;
}) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("style")} className="flex items-center gap-1">
      {OPTIONS.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o)}
            className={`press-soft rounded-full px-3 py-2 text-[12px] tracking-tight ${
              active
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground active:bg-muted"
            }`}
          >
            {t(o)}
          </button>
        );
      })}
    </div>
  );
});
