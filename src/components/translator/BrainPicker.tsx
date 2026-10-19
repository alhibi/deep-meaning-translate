import { memo, useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Brain } from "@/lib/translation/types";
import { useI18n } from "@/lib/i18n";
import { LanguageSheet } from "./LanguageSheet";

const NAMES: Record<Brain, string> = { deepseek: "DeepSeek", luna: "Luna" };
const ORDER: Brain[] = ["deepseek", "luna"];

/** Quiet model chip: the name of the brain writing translations, opening a small sheet. */
export const BrainPicker = memo(function BrainPicker({
  value,
  onChange,
}: {
  value: Brain;
  onChange: (b: Brain) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const select = useCallback((c: string) => onChange(c === "luna" ? "luna" : "deepseek"), [onChange]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${t("model")}: ${NAMES[value]}`}
        className="press-soft ms-1 inline-flex h-9 shrink-0 items-center gap-1.5 border-s border-border ps-3 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden className="size-1 rotate-45 bg-signal" />
        {NAMES[value]}
        <ChevronDown className="size-3.5 text-faint" strokeWidth={1.75} />
      </button>
      <LanguageSheet
        open={open}
        title={t("model")}
        searchable={false}
        plain
        items={ORDER.map((b) => ({ code: b, native: NAMES[b], name: t(`m_${b}`) }))}
        value={value}
        onSelect={select}
        onClose={close}
      />
    </>
  );
});
