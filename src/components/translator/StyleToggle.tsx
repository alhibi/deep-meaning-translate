import { memo } from "react";
import type { StyleOverride } from "@/lib/translation/types";

const OPTIONS: { value: StyleOverride; label: string }[] = [
  { value: "natural", label: "Natural" },
  { value: "formal", label: "Formal" },
  { value: "casual", label: "Casual" },
];

export const StyleToggle = memo(function StyleToggle({
  value,
  onChange,
}: {
  value: StyleOverride;
  onChange: (v: StyleOverride) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Translation style" className="flex items-center gap-1">
      {OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-3 py-1.5 text-[12px] tracking-tight transition-colors ${
              active
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground active:bg-muted"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
});
