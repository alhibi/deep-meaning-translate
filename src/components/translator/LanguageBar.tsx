import { memo, useCallback, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { LANGUAGES, TARGET_LANGUAGES, languageLabel } from "@/lib/translation/languages";
import { tick } from "@/lib/haptics";

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
  const end = align === "end";
  return (
    <label
      className={`press-soft relative flex min-h-12 flex-1 flex-col justify-center overflow-hidden rounded-xl px-2 ${
        end ? "items-end text-right" : "items-start text-left"
      }`}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={end ? "Target language" : "Source language"}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.native}
          </option>
        ))}
      </select>
      {/* Keyed so a change of language re-settles the label in from its new side. */}
      <span
        key={value}
        className={`pointer-events-none block truncate text-[15px] font-medium tracking-tight ${
          end ? "animate-from-start" : "animate-from-end"
        }`}
      >
        {languageLabel(value)}
      </span>
      <span
        className={`pointer-events-none block h-4 truncate text-[11px] text-muted-foreground transition-opacity duration-200 ${
          hint ? "opacity-100" : "opacity-0"
        }`}
      >
        {hint ?? "\u00a0"}
      </span>
    </label>
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
  const [nudge, setNudge] = useState(0);
  const swap = useCallback(() => {
    setNudge((n) => n + 1);
    tick();
    onSwap();
  }, [onSwap]);

  return (
    <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
      <Picker
        value={source}
        options={LANGUAGES}
        onChange={onSource}
        align="start"
        hint={source === "auto" ? (detected ? languageLabel(detected) : "Auto") : undefined}
      />
      <button
        type="button"
        onClick={swap}
        aria-label="Swap languages"
        className="press grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftRight
          key={nudge}
          className={`size-[18px] ${nudge ? "animate-exchange" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      <Picker value={target} options={TARGET_LANGUAGES} onChange={onTarget} align="end" />
    </div>
  );
});
