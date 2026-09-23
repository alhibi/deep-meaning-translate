import { memo, useCallback, useState } from "react";
import { LANGUAGES, TARGET_LANGUAGES, languageLabel } from "@/lib/translation/languages";
import { tick } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";

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
  active,
}: {
  value: string;
  options: { code: string; native: string; name: string }[];
  onChange: (v: string) => void;
  hint?: string | undefined;
  align: "start" | "end";
  active?: boolean;
}) {
  const end = align === "end";
  const { t } = useI18n();
  return (
    <label
      className={`press-soft relative flex min-h-12 flex-1 flex-col justify-center overflow-hidden rounded-xl px-3 ${
        end ? "items-end text-end" : "items-start text-start"
      }`}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={end ? t("targetLang") : t("sourceLang")}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.code === "auto" ? t("detect") : o.native}
          </option>
        ))}
      </select>
      {/* Keyed so a change of language re-settles the label in from its new side. */}
      <span
        key={value}
        className={`pointer-events-none block truncate text-[17px] font-medium tracking-tight ${
          active ? "text-signal" : "text-foreground"
        } ${
          end ? "animate-cross-from-start" : "animate-cross-from-end"
        }`}
      >
        {value === "auto" ? t("detect") : languageLabel(value)}
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
  const { t } = useI18n();
  const [nudge, setNudge] = useState(0);
  const swap = useCallback(() => {
    setNudge((n) => n + 1);
    tick();
    onSwap();
  }, [onSwap]);

  return (
    <div className="px-4 pb-3 pt-1">
    <div className="flex items-center rounded-full border border-border bg-surface px-1.5 py-1">
      <Picker
        value={source}
        options={LANGUAGES}
        onChange={onSource}
        align="start"
        hint={source === "auto" ? (detected ? languageLabel(detected) : t("auto")) : undefined}
      />
      {/* The hinge: a thread with a bead that always rests beside the target.
          Tapping it sends the bead across and the two languages trade places. */}
      <button
        type="button"
        onClick={swap}
        aria-label={t("swap")}
        className="press group relative h-11 w-16 shrink-0"
      >
        <span aria-hidden className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-border-strong transition-colors group-hover:bg-signal/50" />
        <span aria-hidden className="absolute start-2 top-1/2 size-1 -translate-y-1/2 rounded-full bg-border-strong" />
        <span
          key={nudge}
          aria-hidden
          className={`absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-signal ring-4 ring-background ${
            nudge ? "animate-bead" : ""
          }`}
          style={{ insetInlineStart: "calc(100% - 0.5rem - 0.625rem)" }}
        />
      </button>
      <Picker value={target} options={TARGET_LANGUAGES} onChange={onTarget} align="end" active />
    </div>
    </div>
  );
});
