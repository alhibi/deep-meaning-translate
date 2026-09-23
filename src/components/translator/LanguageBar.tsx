import { memo, useCallback, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { LANGUAGES, TARGET_LANGUAGES, isRtl, languageLabel } from "@/lib/translation/languages";
import { tick } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";
import { LanguageSheet, pushRecent, readRecent, type PickerItem } from "./LanguageSheet";

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
  options: PickerItem[];
  onChange: (v: string) => void;
  caption: string;
  end?: boolean;
  swapped: number;
  detected?: string | undefined;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const label =
    value === "auto" ? (detected ? languageLabel(detected) : t("detect")) : languageLabel(value);
  const close = useCallback(() => setOpen(false), []);
  const select = useCallback(
    (code: string) => {
      pushRecent(code);
      if (code !== value) onChange(code);
    },
    [onChange, value],
  );
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRecent(readRecent());
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-label={end ? t("targetLang") : t("sourceLang")}
        className={`press-soft relative flex min-w-0 flex-1 cursor-pointer flex-col py-2 ${end ? "items-end text-end" : "items-start text-start"}`}
      >
        <span className="pointer-events-none text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
          {caption}
        </span>
        <span
          key={`${value}-${swapped}`}
          className={`pointer-events-none mt-1 block max-w-full truncate font-semibold ${
            isRtl(value === "auto" ? (detected ?? "") : value)
              ? "font-arabic text-[24px] leading-[1.25]"
              : "text-[22px] leading-[1.25] tracking-[-0.02em]"
          } ${end ? "text-foreground" : "text-foreground/90"} ${swapped ? (end ? "animate-cross-from-start" : "animate-cross-from-end") : ""}`}
        >
          {label}
        </span>
        <span
          aria-hidden
          className={`pointer-events-none mt-1.5 h-[2px] w-5 rounded-full ${end ? "bg-signal" : "bg-transparent"}`}
        />
      </button>
      <LanguageSheet
        open={open}
        title={end ? t("targetLang") : t("sourceLang")}
        items={options}
        value={value}
        recent={recent}
        onSelect={select}
        onClose={close}
      />
    </>
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
  const [swapped, setSwapped] = useState(0);
  const swap = useCallback(() => {
    setSwapped((n) => n + 1);
    tick();
    onSwap();
  }, [onSwap]);

  const sourceCaption = source === "auto" ? `${t("from")} · ${t("auto")}` : t("from");

  return (
    <div className="flex items-center gap-3 px-6 pb-4 pt-2">
      <Side
        value={source}
        options={LANGUAGES}
        onChange={onSource}
        caption={sourceCaption}
        swapped={swapped}
        detected={detected}
      />
      <button
        type="button"
        onClick={swap}
        aria-label={t("swap")}
        className="press-soft grid size-9 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:border-border-strong hover:text-foreground active:border-border-strong active:bg-[#25221F] active:text-foreground"
      >
        <ArrowLeftRight
          key={swapped}
          className={`size-4 ${swapped ? "animate-exchange" : ""}`}
          strokeWidth={1.8}
        />
      </button>
      <Side
        value={target}
        options={TARGET_LANGUAGES}
        onChange={onTarget}
        caption={t("to")}
        end
        swapped={swapped}
      />
    </div>
  );
});
