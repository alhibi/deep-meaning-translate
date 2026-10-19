import { useMemo } from "react";
import { distribution, matches, type Filters, type StatRecord } from "@/lib/stats/engine";
import { colorOf, pairColor, type Dimension } from "@/lib/stats/taxonomy";
import { categoryLabel, type statsT } from "@/lib/stats/labels";
import type { Locale } from "@/lib/i18n";
import { Sheet } from "./Sheet";
import type { Fmt } from "./format";

type Key = keyof Filters;
const SECTIONS: { key: Key; label: "f_pair" | "f_lang" | "f_kind" | "f_domain" | "f_intent" | "f_register" }[] = [
  { key: "pair", label: "f_pair" },
  { key: "lang", label: "f_lang" },
  { key: "kind", label: "f_kind" },
  { key: "domain", label: "f_domain" },
  { key: "intent", label: "f_intent" },
  { key: "register", label: "f_register" },
];

/**
 * Connected filters: each option shows how many translations it would leave given the
 * OTHER active filters, and only options that exist in the period are offered.
 */
export function FilterSheet({
  open,
  onClose,
  periodRecords,
  filters,
  onChange,
  fmt,
  t,
  locale,
  dir,
}: {
  open: boolean;
  onClose: () => void;
  periodRecords: StatRecord[];
  filters: Filters;
  onChange: (key: Key, value: string | undefined) => void;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  locale: Locale;
  dir: "rtl" | "ltr";
}) {
  const sections = useMemo(
    () =>
      SECTIONS.map(({ key, label }) => {
        const others = { ...filters, [key]: undefined };
        const base = periodRecords.filter((r) => matches(r, others));
        let options: { id: string; count: number }[];
        if (key === "lang") {
          const m = new Map<string, number>();
          for (const r of base) {
            m.set(r.source, (m.get(r.source) ?? 0) + 1);
            if (r.target !== r.source) m.set(r.target, (m.get(r.target) ?? 0) + 1);
          }
          options = [...m].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
        } else options = distribution(base, key as Dimension | "pair");
        const cur = filters[key];
        if (cur && !options.some((o) => o.id === cur)) options.unshift({ id: cur, count: 0 });
        return { key, label, options };
      }),
    [periodRecords, filters],
  );

  const name = (key: Key, id: string) =>
    key === "pair" ? fmt.pair(id) : key === "lang" ? fmt.langName(id) : categoryLabel(locale, key, id);
  const color = (key: Key, id: string) =>
    key === "pair" ? pairColor(id) : key === "lang" ? "var(--faint)" : colorOf(key, id);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={t("filters")}
      dir={dir}
      closeLabel={t("close")}
      title={<h2 className="text-[17px] font-semibold tracking-tight">{t("filters")}</h2>}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="press h-11 w-full rounded-full bg-primary text-[14px] font-medium text-primary-foreground"
        >
          {t("apply")}
        </button>
      }
    >
      <div className="flex flex-col gap-5 pt-1">
        {sections.map((s) =>
          s.options.length ? (
            <section key={s.key}>
              <h3 className="mb-2 text-[12px] text-muted-foreground">{t(s.label)}</h3>
              <div className="flex flex-wrap gap-1.5">
                {s.options.map((o) => {
                  const on = filters[s.key] === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onChange(s.key, on ? undefined : o.id)}
                      className={`press-soft inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] ${
                        on ? "border-signal bg-signal-soft text-foreground" : "border-border text-foreground"
                      }`}
                    >
                      <span className="size-1.5 rounded-full" style={{ background: color(s.key, o.id) }} />
                      {name(s.key, o.id)}
                      <span className="tabular-nums text-muted-foreground">{fmt.num(o.count)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null,
        )}
      </div>
    </Sheet>
  );
}
