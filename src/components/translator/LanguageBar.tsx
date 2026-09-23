import { memo, useCallback, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { LANGUAGES, TARGET_LANGUAGES, isRtl, languageLabel } from "@/lib/translation/languages";
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

function Side({
  value,
  options,
  onChange,
  caption,
  end,
  swapped,
  detected,
}: {
  value: string;
  options: { code: string; native: string }[];
  onChange: (v: string) => void;
  caption: string;
  end?: boolean;
  swapped: number;
  detected?: string | undefined;
}) {
  const { t } = useI18n();
  const label = value === "auto" ? (detected ? languageLabel(detected) : t("detect")) : languageLabel(value);
  return (
    <label className={`press-soft relative flex min-w-0 flex-1 flex-col py-2 ${end ? "items-end text-end" : "items-start text-start"}`}>
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
      <span className="pointer-events-none text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{caption}</span>
      <span
        key={`${value}-${swapped}`}
        className={`pointer-events-none mt-1 block max-w-full truncate font-semibold ${
          isRtl(value === "auto" ? detected ?? "" : value) ? "font-arabic text-[24px] leading-[1.25]" : "text-[22px] leading-[1.25] tracking-[-0.02em]"
        } ${end ? "text-foreground" : "text-foreground/90"} ${swapped ? (end ? "animate-cross-from-start" : "animate-cross-from-end") : ""}`}
      >
        {label}
      </span>
      <span aria-hidden className={`pointer-events-none mt-1.5 h-[2px] w-5 rounded-full ${end ? "bg-signal" : "bg-transparent"}`} />
    </label>
  );
}

export const LanguageBar = memo(function LanguageBar({ source, target, detected, onSource, onTarget, onSwap }: Props) {
  const { t } = useI18n();
  const [swapped, setSwapped] = useState(0);
  const swap = useCallback(() => {
    setSwapped((n) => n + 1);
    tick();
    onSwap();
  }, [onSwap]);

  const sourceCaption = source === "auto" ? `${t("from")} · ${t("auto")}` : t("from");

  return (
    <div className="flex items-center gap-3 px-6 pb-4 pt-2">
      <Side value={source} options={LANGUAGES} onChange={onSource} caption={sourceCaption} swapped={swapped} detected={detected} />
      <button
        type="button"
        onClick={swap}
        aria-label={t("swap")}
        className="press grid size-12 shrink-0 place-items-center rounded-full border border-border-strong text-muted-foreground transition-colors hover:text-foreground active:border-signal active:text-signal"
      >
        <ArrowLeftRight key={swapped} className={`size-[18px] ${swapped ? "animate-exchange" : ""}`} strokeWidth={1.6} />
      </button>
      <Side value={target} options={TARGET_LANGUAGES} onChange={onTarget} caption={t("to")} end swapped={swapped} />
    </div>
  );
});
