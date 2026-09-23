import { memo } from "react";
import { ArrowLeftRight } from "lucide-react";
import { LANGUAGES, TARGET_LANGUAGES, languageLabel } from "@/lib/translation/languages";

interface Props {
  source: string;
  target: string;
  detected?: string | undefined;
  onSource: (code: string) => void;
  onTarget: (code: string) => void;
  onSwap: () => void;
}

function Picker({
  value,
  options,
  onChange,
  hint,
  align,
}: {
  value: string;
  options: { code: string; native: string; name: string }[];
  onChange: (v: string) => void;
  hint?: string | undefined;
  align: "start" | "end";
}) {
  return (
    <div className={`relative flex-1 ${align === "end" ? "text-right" : "text-left"}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={align === "start" ? "Source language" : "Target language"}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.native}
          </option>
        ))}
      </select>
      <div className="pointer-events-none px-1 py-2">
        <div className="truncate text-[15px] font-medium tracking-tight">
          {languageLabel(value)}
        </div>
        {hint ? (
          <div className="truncate text-[11px] text-muted-foreground">{hint}</div>
        ) : null}
      </div>
    </div>
  );
}

export const LanguageBar = memo(function LanguageBar({
  source,
  target,
  detected,
  onSource,
  onTarget,
  onSwap,
}: Props) {
  return (
    <div className="flex items-center gap-1 border-b border-border px-4 py-1">
      <Picker
        value={source}
        options={LANGUAGES}
        onChange={onSource}
        align="start"
        hint={source === "auto" && detected ? languageLabel(detected) : undefined}
      />
      <button
        type="button"
        onClick={onSwap}
        aria-label="Swap languages"
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted hover:text-foreground"
      >
        <ArrowLeftRight className="size-[18px]" strokeWidth={1.75} />
      </button>
      <Picker value={target} options={TARGET_LANGUAGES} onChange={onTarget} align="end" />
    </div>
  );
});
