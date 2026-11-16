import { useMemo } from "react";
import { ListFilter } from "lucide-react";
import {
  distribution,
  share,
  timeline,
  type Bounds,
  type Granularity,
  type StatRecord,
} from "@/lib/stats/engine";
import { colorOf, pairColor, type Dimension } from "@/lib/stats/taxonomy";
import { categoryLabel, type statsT } from "@/lib/stats/labels";
import type { Locale } from "@/lib/i18n";
import { Sheet } from "./Sheet";
import { TimelineChart } from "./charts";
import { RecordList } from "./RecordList";
import type { Fmt } from "./format";

export interface DetailSpec {
  title: string;
  color?: string;
  /** What this detail narrows to; becomes a page filter with "Filter by this". */
  filter?: { key: Dimension | "pair"; value: string };
  /** Restricts to a time bucket from the activity chart. */
  bucket?: { from: string; to: string };
  /** Restricts to one hour of the day from the rhythm dial. */
  hour?: number;
}

/**
 * Drill-down for anything tapped: its numbers, its own activity, the categories it
 * is most tied to, and every translation behind it — from the same visible set the
 * chart used, so the list always shows exactly the counted number.
 */
export function DetailSheet({
  spec,
  records,
  visibleTotal,
  bounds,
  granularity,
  todayKey,
  onClose,
  onOpen,
  onApply,
  fmt,
  t,
  locale,
  dir,
}: {
  spec: DetailSpec | null;
  records: StatRecord[];
  visibleTotal: number;
  bounds: Bounds | null;
  granularity: Granularity;
  todayKey: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onApply: (key: Dimension | "pair", value: string) => void;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  locale: Locale;
  dir: "rtl" | "ltr";
}) {
  const words = useMemo(() => records.reduce((a, r) => a + r.words, 0), [records]);
  const buckets = useMemo(
    () => (spec?.bucket ? [] : timeline(records, bounds, granularity)),
    [records, bounds, granularity, spec?.bucket],
  );
  const related = useMemo(() => {
    const dims: (Dimension | "pair")[] = ["domain", "intent", "kind", "pair"];
    return dims
      .filter((d) => d !== spec?.filter?.key)
      .map((d) => ({ d, top: distribution(records, d).slice(0, 3) }))
      .filter((x) => x.top.length);
  }, [records, spec?.filter?.key]);

  const label = (d: Dimension | "pair", id: string) =>
    d === "pair" ? fmt.pair(id) : categoryLabel(locale, d, id);
  const color = (d: Dimension | "pair", id: string) =>
    d === "pair" ? pairColor(id) : colorOf(d, id);

  return (
    <Sheet
      open={!!spec}
      onClose={onClose}
      label={spec?.title ?? ""}
      dir={dir}
      closeLabel={t("close")}
      title={
        spec ? (
          <div>
            <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
              {spec.color ? (
                <span
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: spec.color }}
                />
              ) : null}
              <span className="min-w-0 truncate">{spec.title}</span>
            </h2>
            <p className="mt-1 text-[12.5px] tabular-nums text-muted-foreground">
              {records.length === 1 ? t("countOne") : t("count", { n: fmt.num(records.length) })} ·{" "}
              {t("wordsN", { n: fmt.num(words) })} ·{" "}
              {t("pctOfVisible", { pct: fmt.pct(share(records.length, visibleTotal)) })}
            </p>
          </div>
        ) : null
      }
    >
      {spec ? (
        <div className="flex flex-col gap-5 pt-1">
          {spec.filter ? (
            <button
              type="button"
              onClick={() => onApply(spec.filter!.key, spec.filter!.value)}
              className="press-soft inline-flex h-9 items-center gap-1.5 self-start rounded-full border border-border px-3 text-[13px]"
            >
              <ListFilter className="size-4" strokeWidth={1.75} />
              {t("filterBy")}
            </button>
          ) : null}

          {buckets.length > 1 ? (
            <section>
              <h3 className="mb-2 text-[12px] text-muted-foreground">{t("overTime")}</h3>
              <TimelineChart
                compact
                buckets={buckets}
                metric="translations"
                granularity={granularity}
                selected={null}
                todayKey={todayKey}
                fmt={fmt}
                label={t("overTime")}
              />
            </section>
          ) : null}

          {related.length ? (
            <section>
              <h3 className="mb-2 text-[12px] text-muted-foreground">{t("related")}</h3>
              <div className="flex flex-col gap-2">
                {related.map(({ d, top }) => (
                  <div key={d} className="flex flex-wrap items-center gap-1.5">
                    {top.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-card px-2.5 text-[12px]"
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: color(d, s.id) }}
                        />
                        {label(d, s.id)}
                        <span className="tabular-nums text-muted-foreground">
                          {fmt.num(s.count)}
                        </span>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h3 className="mb-2 text-[12px] text-muted-foreground">{t("recentTitle")}</h3>
            <RecordList records={records} onOpen={onOpen} fmt={fmt} t={t} locale={locale} />
          </section>
        </div>
      ) : null}
    </Sheet>
  );
}
