import { useState } from "react";
import { ArrowUpRight, Trash2 } from "lucide-react";
import { history, type EntryTags } from "@/lib/history";
import { isRtl } from "@/lib/translation/languages";
import type { StatRecord } from "@/lib/stats/engine";
import { DIMENSION_VALUES, colorOf, type Dimension } from "@/lib/stats/taxonomy";
import { categoryLabel, type statsT } from "@/lib/stats/labels";
import type { Locale } from "@/lib/i18n";
import { Sheet } from "./Sheet";
import type { Fmt } from "./format";

const DIMS: Dimension[] = ["kind", "domain", "intent", "register"];
const DIM_LABEL = {
  kind: "f_kind",
  domain: "f_domain",
  intent: "f_intent",
  register: "f_register",
} as const;

/**
 * One translation: both texts, its date, and all four classification layers —
 * each correctable. A correction rewrites only the tag; date, text and counts stay.
 */
export function RecordSheet({
  record,
  onClose,
  onOpenInTranslator,
  fmt,
  t,
  locale,
  dir,
}: {
  record: StatRecord | null;
  onClose: () => void;
  onOpenInTranslator: (r: StatRecord) => void;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  locale: Locale;
  dir: "rtl" | "ltr";
}) {
  const [editing, setEditing] = useState<Dimension | null>(null);
  const [confirm, setConfirm] = useState(false);
  const r = record;

  const close = () => {
    setEditing(null);
    setConfirm(false);
    onClose();
  };

  return (
    <Sheet
      open={!!r}
      onClose={close}
      label={t("detail")}
      dir={dir}
      closeLabel={t("close")}
      title={
        r ? (
          <div>
            <p className="text-[12px] text-muted-foreground">{fmt.pair(r.pair)}</p>
            <p className="mt-0.5 text-[12px] text-faint">
              {t("created")}: {fmt.stamp(r.createdAt)}
            </p>
          </div>
        ) : null
      }
      footer={
        r ? (
          confirm ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirm(false)}
                className="press-soft h-11 flex-1 rounded-full border border-border text-[14px]"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  void history.remove(r.id);
                  close();
                }}
                className="press h-11 flex-1 rounded-full bg-destructive text-[14px] font-medium text-destructive-foreground"
              >
                {t("confirmDelete")}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenInTranslator(r)}
                className="press inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary text-[14px] font-medium text-primary-foreground"
              >
                {t("openInTranslator")}
                <ArrowUpRight className="size-4 rtl:-scale-x-100" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => setConfirm(true)}
                aria-label={t("delete")}
                className="press-soft grid size-11 place-items-center rounded-full border border-border text-muted-foreground"
              >
                <Trash2 className="size-[18px]" strokeWidth={1.6} />
              </button>
            </div>
          )
        ) : null
      }
    >
      {r ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-card p-4">
            <p
              dir={isRtl(r.source) ? "rtl" : "ltr"}
              lang={r.source}
              className="whitespace-pre-wrap text-start text-[16px] leading-relaxed"
            >
              {r.original}
            </p>
            <div className="my-3 border-t border-border" />
            <p
              dir={isRtl(r.target) ? "rtl" : "ltr"}
              lang={r.target}
              className="whitespace-pre-wrap text-start text-[16px] leading-relaxed text-muted-foreground"
            >
              {r.translated}
            </p>
          </div>
          <p className="text-[12px] text-muted-foreground">
            {t("wordsN", { n: fmt.num(r.words) })}
            {r.uses > 1 ? <> · {t("used", { n: r.uses })}</> : null}
          </p>
          <ul className="flex flex-col">
            {DIMS.map((d) => {
              const value = r[d];
              const origin = r.origin[d];
              return (
                <li key={d} className="border-b border-border py-2.5 last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-[12px] text-muted-foreground">
                      {t(DIM_LABEL[d])}
                    </span>
                    <span
                      className="size-2 rounded-[3px]"
                      style={{ background: colorOf(d, value) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      {categoryLabel(locale, d, value)}
                      {origin === "local" ? (
                        <span className="ms-1.5 text-[11px] text-faint">· {t("estimated")}</span>
                      ) : null}
                      {origin === "user" ? (
                        <span className="ms-1.5 text-[11px] text-signal-text">
                          · {t("yourFix")}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditing(editing === d ? null : d)}
                      aria-expanded={editing === d}
                      className="press-soft h-8 rounded-full px-3 text-[12px] text-muted-foreground hover:text-foreground"
                    >
                      {t("correct")}
                    </button>
                  </div>
                  {editing === d ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {DIMENSION_VALUES[d].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => {
                            void history.retag(r.id, { [d]: v } as EntryTags);
                            setEditing(null);
                          }}
                          aria-pressed={value === v}
                          className={`press-soft inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] ${
                            value === v ? "border-border-strong bg-card" : "border-border"
                          }`}
                        >
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: colorOf(d, v) }}
                          />
                          {categoryLabel(locale, d, v)}
                        </button>
                      ))}
                      {origin === "user" ? (
                        <button
                          type="button"
                          onClick={() => {
                            void history.retag(r.id, { [d]: null });
                            setEditing(null);
                          }}
                          className="press-soft min-h-8 rounded-full px-2.5 text-[12.5px] text-muted-foreground underline underline-offset-4"
                        >
                          {t("resetAuto")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="text-[11.5px] leading-relaxed text-faint">{t("estimatedHint")}</p>
        </div>
      ) : null}
    </Sheet>
  );
}
