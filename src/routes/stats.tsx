import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ListFilter, X } from "lucide-react";
import { initLocale, useI18n } from "@/lib/i18n";
import { useTodayKey } from "@/lib/useTodayKey";
import { history } from "@/lib/history";
import { persist } from "@/lib/persist";
import { saved } from "@/lib/saved";
import {
  FILTER_KEYS,
  INSIGHT_MIN,
  RANGES,
  change,
  dayKey,
  distribution,
  granularityFor,
  insights as findInsights,
  isDayKey,
  previousBounds,
  rangeBounds,
  select,
  summarize,
  timeline,
  toRecords,
  topWithOthers,
  type Filters,
  type Insight,
  type RangeId,
  type StatRecord,
} from "@/lib/stats/engine";
import {
  OTHERS_COLOR,
  colorOf,
  isDimensionValue,
  pairColor,
  type Dimension,
} from "@/lib/stats/taxonomy";
import { categoryLabel, statsT, type StatsKey } from "@/lib/stats/labels";
import {
  readStatsPrefs,
  setPendingPick,
  useArchive,
  writeStatsPrefs,
} from "@/lib/stats/useArchive";
import { makeFormat, type Fmt } from "@/components/stats/format";
import { BarList, Donut, StackBar, TimelineChart, type BarRow } from "@/components/stats/charts";
import { RecordList } from "@/components/stats/RecordList";
import { RecordSheet } from "@/components/stats/RecordSheet";
import { DetailSheet, type DetailSpec } from "@/components/stats/DetailSheet";
import { FilterSheet } from "@/components/stats/FilterSheet";
import { Sheet, leaveSheets, onSheetsSettled } from "@/components/stats/Sheet";
import { parseSearch, type StatsSearch } from "@/lib/stats/search";

export const Route = createFileRoute("/stats")({
  staticData: { sitemap: false },
  validateSearch: parseSearch,
  head: () => ({
    meta: [
      { title: "Translation statistics — today" },
      {
        name: "description",
        content:
          "Your languages, topics and phrases over time — calculated privately on your device from your own translations.",
      },
      { property: "og:title", content: "Translation statistics — today" },
      {
        property: "og:description",
        content:
          "See between which languages you move, what you translate and how it changes over time.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://fluently.today/stats" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "https://fluently.today/stats" }],
  }),
  component: StatsPage,
});

type Metric = "translations" | "words";
type Kpi = "translations" | "words" | "pairs" | "days" | "avg";

function StatsPage() {
  const urlSearch = Route.useSearch();
  // Period and filters live in state while sheets are open (each sheet owns a history
  // entry), and are written to the address once they close — so Back and reload keep them.
  const [search, setQuery] = useState<StatsSearch>(urlSearch);
  // Adjust state during render (React's documented pattern) instead of an effect:
  // Back/forward changes the URL, and the page must follow it without a second paint.
  const urlKey = JSON.stringify(urlSearch);
  const [syncedUrlKey, setSyncedUrlKey] = useState(urlKey);
  if (syncedUrlKey !== urlKey) {
    setSyncedUrlKey(urlKey);
    setQuery(JSON.parse(urlKey) as StatsSearch);
  }
  const navigate = useNavigate({ from: "/stats" });
  const { locale, rtl } = useI18n();
  const dir = rtl ? "rtl" : "ltr";
  const t = useMemo(() => statsT(locale), [locale]);
  const fmt = useMemo(() => makeFormat(locale), [locale]);
  const entries = useArchive();
  // The clock is an external store: pure reads, and a page left open overnight rolls over.
  const today = useTodayKey();
  const status = entries ? history.status() : "ok";

  const range: RangeId = search.range ?? "30d";
  const filters: Filters = useMemo(() => {
    const f: Filters = {};
    for (const k of FILTER_KEYS) if (search[k]) f[k] = search[k];
    return f;
  }, [search]);
  const activeFilters = FILTER_KEYS.filter((k) => filters[k]);

  const [metric, setMetric] = useState<Metric>("translations");
  const [bucketSel, setBucketSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailSpec | null>(null);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [insightsHidden, setInsightsHidden] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [statsPrefsBefore, setStatsPrefsBefore] = useState<boolean | null>(null);
  const statsPrefs = readStatsPrefs().insightsHidden;
  if (statsPrefsBefore !== statsPrefs) {
    // Preferences are read once per value, during render: no extra frame with the wrong layout.
    setStatsPrefsBefore(statsPrefs);
    setInsightsHidden(statsPrefs);
  }
  useEffect(() => {
    initLocale(); // opened directly (shared link, reload): use the chosen interface language
  }, []);
  // A new period or filter set invalidates the selected bar: reset it while rendering,
  // so the chart never paints one frame with a stale selection.
  const periodKey = `${range}|${search.from ?? ""}|${search.to ?? ""}|${JSON.stringify(filters)}`;
  const [syncedPeriodKey, setSyncedPeriodKey] = useState(periodKey);
  if (syncedPeriodKey !== periodKey) {
    setSyncedPeriodKey(periodKey);
    setBucketSel(null);
  }

  /* ---------------- data: one pipeline, every number derives from `visible` ---------------- */
  const records = useMemo(() => (entries ? toRecords(entries) : []), [entries]);
  const bounds = useMemo(
    () => (today ? rangeBounds(range, today, records, { from: search.from, to: search.to }) : null),
    [range, today, records, search.from, search.to],
  );
  const prevB = useMemo(() => previousBounds(range, bounds), [range, bounds]);
  const periodRecords = useMemo(() => select(records, bounds, {}), [records, bounds]);
  const visible = useMemo(() => select(records, bounds, filters), [records, bounds, filters]);
  const prevVisible = useMemo(
    () => (prevB ? select(records, prevB, filters) : null),
    [records, prevB, filters],
  );
  const summary = useMemo(() => summarize(visible), [visible]);
  const prevSummary = useMemo(() => (prevVisible ? summarize(prevVisible) : null), [prevVisible]);
  const gran = granularityFor(bounds?.days ?? 1);
  const buckets = useMemo(() => timeline(visible, bounds, gran), [visible, bounds, gran]);
  const pairs = useMemo(() => distribution(visible, "pair"), [visible]);
  const kinds = useMemo(() => distribution(visible, "kind"), [visible]);
  const domains = useMemo(() => distribution(visible, "domain"), [visible]);
  const intents = useMemo(() => distribution(visible, "intent"), [visible]);
  const registers = useMemo(() => distribution(visible, "register"), [visible]);
  const found = useMemo(() => findInsights(visible, bounds), [visible, bounds]);
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);

  /* ---------------- navigation state lives in the URL; Back keeps period and filters ---------------- */
  const setSearch = useCallback((patch: Partial<StatsSearch>) => {
    setQuery((prev) => {
      const next: Record<string, unknown> = { ...prev, ...patch };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      return next as StatsSearch;
    });
  }, []);
  const anyOpen = !!detail || !!recordId || filtersOpen || !!kpi;
  const queryKey = JSON.stringify(search);
  useEffect(() => {
    if (anyOpen || queryKey === urlKey) return;
    let live = true;
    onSheetsSettled(() => {
      if (live)
        void navigate({
          search: JSON.parse(queryKey) as StatsSearch,
          replace: true,
          resetScroll: false,
        });
    });
    return () => {
      live = false;
    };
  }, [anyOpen, queryKey, urlKey, navigate]);
  const setFilter = useCallback(
    (key: keyof Filters, value: string | undefined) => setSearch({ [key]: value }),
    [setSearch],
  );
  const clearFilters = () =>
    setSearch(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])) as Partial<StatsSearch>);

  const openDim = (key: Dimension | "pair", id: string) => {
    if (id === "__others") {
      setDetail({ title: t("others"), color: OTHERS_COLOR });
      return;
    }
    setDetail({
      title: key === "pair" ? fmt.pair(id) : categoryLabel(locale, key, id),
      color: key === "pair" ? pairColor(id) : colorOf(key, id),
      filter: { key, value: id },
    });
  };

  const detailRecords = useMemo(() => {
    if (!detail) return [];
    let list = visible;
    if (detail.filter) {
      const { key, value } = detail.filter;
      list = list.filter((r) => r[key] === value);
    } else if (detail.title === t("others")) {
      const shown = new Set(topWithOthers(pairs, 5).top.map((s) => s.id));
      list = list.filter((r) => !shown.has(r.pair));
    }
    if (detail.bucket)
      list = list.filter((r) => r.day >= detail.bucket!.from && r.day <= detail.bucket!.to);
    return list;
  }, [detail, visible, pairs, t]);

  const openInTranslator = useCallback(
    (r: StatRecord) => {
      setPendingPick({ original: r.original, source: r.source, target: r.target });
      leaveSheets(() => void navigate({ to: "/" }));
    },
    [navigate],
  );

  const forgetAll = () => {
    persist.clearAll();
    saved.clear();
    history.reload();
    setConfirmForget(false);
  };

  /* ---------------- states ---------------- */
  const header = (
    <header className="flex items-center gap-1 px-2 pt-2">
      <Link
        viewTransition
        to="/"
        aria-label={t("back")}
        className="press grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-[19px] rtl:-scale-x-100" strokeWidth={1.75} />
      </Link>
    </header>
  );

  let body: ReactNode;
  if (entries === null) body = <Skeleton />;
  else if (status === "unavailable")
    body = (
      <Calm title={t("error_title")} text={t("error_body")}>
        <button
          type="button"
          onClick={() => history.reload()}
          className="press h-11 rounded-full bg-primary px-6 text-[14px] font-medium text-primary-foreground"
        >
          {t("error_retry")}
        </button>
      </Calm>
    );
  else if (records.length === 0)
    body = (
      <Calm title={t("empty_title")} text={t("empty_body")} mark>
        <Link
          viewTransition
          to="/"
          className="press inline-flex h-11 items-center rounded-full bg-primary px-6 text-[14px] font-medium text-primary-foreground"
        >
          {t("empty_cta")}
        </Link>
      </Calm>
    );
  else
    body = (
      <>
        <RangePicker
          range={range}
          from={search.from ?? bounds?.from ?? today}
          to={search.to ?? bounds?.to ?? today}
          today={today}
          t={t}
          onRange={(r) =>
            setSearch({
              range: r,
              ...(r === "custom"
                ? { from: bounds?.from ?? today, to: today }
                : { from: undefined, to: undefined }),
            })
          }
          onCustom={(from, to) => setSearch({ range: "custom", from, to })}
        />

        <div className="mt-3 flex flex-wrap items-center gap-1.5 px-5">
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="press-soft inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] text-foreground"
          >
            <ListFilter className="size-4" strokeWidth={1.75} />
            {t("filters")}
            {activeFilters.length ? (
              <span className="tabular-nums text-signal-text">{activeFilters.length}</span>
            ) : null}
          </button>
          {activeFilters.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k, undefined)}
              aria-label={`${t("clearFilters")}: ${filterName(k, filters[k]!, fmt, locale)}`}
              className="press-soft inline-flex h-9 items-center gap-1.5 rounded-full bg-signal-soft px-3 text-[13px] text-foreground"
            >
              <span className="max-w-[12rem] truncate">
                {filterName(k, filters[k]!, fmt, locale)}
              </span>
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          ))}
          {activeFilters.length > 1 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="press-soft h-9 px-2 text-[12.5px] text-muted-foreground underline underline-offset-4"
            >
              {t("clearFilters")}
            </button>
          ) : null}
        </div>

        {!history.lastWriteOk() ? (
          <p
            role="status"
            className="mx-5 mt-3 rounded-xl border border-border px-3 py-2 text-[12.5px] text-warning"
          >
            {t("write_fail")}
          </p>
        ) : null}

        {visible.length === 0 ? (
          <Calm title={t("period_empty")} small>
            <button
              type="button"
              onClick={() =>
                setSearch({
                  range: "all",
                  from: undefined,
                  to: undefined,
                  ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])),
                })
              }
              className="press-soft h-10 rounded-full border border-border px-5 text-[13.5px]"
            >
              {t("period_empty_cta")}
            </button>
          </Calm>
        ) : (
          <div className="mt-5 grid gap-x-8 gap-y-3 px-3 lg:grid-cols-2">
            {/* KPIs */}
            <section
              className="grid grid-cols-2 gap-2 lg:col-span-2 lg:grid-cols-5"
              aria-label={t("title")}
            >
              <KpiCard
                wide
                label={t("k_translations")}
                value={fmt.num(summary.translations)}
                delta={change(summary.translations, prevSummary?.translations)}
                prev={prevSummary}
                fmt={fmt}
                onClick={() => setKpi("translations")}
              />
              <KpiCard
                wide
                label={t("k_words")}
                value={fmt.num(summary.words)}
                delta={change(summary.words, prevSummary?.words)}
                prev={prevSummary}
                fmt={fmt}
                onClick={() => setKpi("words")}
              />
              <KpiCard
                label={t("k_pairs")}
                value={fmt.num(summary.pairs)}
                sub={
                  summary.topPair && summary.pairs > 1 ? fmt.pair(summary.topPair.pair) : undefined
                }
                fmt={fmt}
                onClick={() => setKpi("pairs")}
              />
              <KpiCard
                label={t("k_days")}
                value={fmt.num(summary.activeDays)}
                sub={bounds ? `/ ${fmt.num(bounds.days)}` : undefined}
                delta={change(summary.activeDays, prevSummary?.activeDays)}
                prev={prevSummary}
                fmt={fmt}
                onClick={() => setKpi("days")}
              />
              <KpiCard
                className="col-span-2 lg:col-span-1"
                label={t("k_avg")}
                value={summary.avgWords === null ? "—" : fmt.num1(summary.avgWords)}
                fmt={fmt}
                onClick={() => setKpi("avg")}
              />
            </section>
            <p className="px-2 text-[11.5px] text-faint lg:col-span-2">
              {prevB
                ? prevSummary?.translations
                  ? t("vsPrev", { n: fmt.num(prevB.days) })
                  : t("noCompare")
                : t("noCompareAll")}
            </p>

            {/* Activity */}
            <Panel title={t("activity")} className="lg:col-span-2">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div
                  role="radiogroup"
                  aria-label={t("activity")}
                  className="flex rounded-full bg-card p-0.5"
                >
                  {(["translations", "words"] as Metric[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={metric === m}
                      onClick={() => setMetric(m)}
                      className={`h-8 rounded-full px-3 text-[12.5px] transition-colors ${metric === m ? "bg-surface text-foreground" : "text-muted-foreground"}`}
                    >
                      {t(m === "translations" ? "m_translations" : "m_words")}
                    </button>
                  ))}
                </div>
                <span className="text-[12px] text-muted-foreground">
                  {t(`g_${gran}` as StatsKey)}
                </span>
              </div>
              <BucketReadout
                buckets={buckets}
                sel={bucketSel}
                metric={metric}
                gran={gran}
                fmt={fmt}
                t={t}
                onView={(b) =>
                  setDetail({
                    title: fmt.bucket(b.from, b.to, gran),
                    bucket: { from: b.from, to: b.to },
                  })
                }
              />
              <TimelineChart
                buckets={buckets}
                metric={metric}
                granularity={gran}
                selected={bucketSel}
                todayKey={today}
                onSelect={(k) => setBucketSel((s) => (s === k ? null : k))}
                fmt={fmt}
                label={t("chartSummary", {
                  metric: t(metric === "translations" ? "m_translations" : "m_words"),
                  gran: t(`g_${gran}` as StatsKey),
                  total: fmt.num(metric === "translations" ? summary.translations : summary.words),
                })}
              />
              <TimelineSummary buckets={buckets} metric={metric} gran={gran} fmt={fmt} t={t} />
            </Panel>

            {/* Pairs */}
            <Panel title={t("pairsTitle")}>
              <PairsBlock
                pairs={pairs}
                total={visible.length}
                selected={filters.pair ?? null}
                fmt={fmt}
                t={t}
                onOpen={(id) => openDim("pair", id)}
              />
            </Panel>

            {/* Kinds */}
            <Panel title={t("kindsTitle")}>
              <BarList
                rows={rows("kind", kinds, visible, locale)}
                selected={filters.kind}
                onSelect={(id) => openDim("kind", id)}
                fmt={fmt}
              />
              <EstimatedNote dim="kind" visible={visible} t={t} fmt={fmt} />
            </Panel>

            {/* Domains */}
            <Panel title={t("domainsTitle")}>
              <Collapsible
                rows={rows("domain", domains, visible, locale)}
                selected={filters.domain}
                onSelect={(id) => openDim("domain", id)}
                fmt={fmt}
                t={t}
              />
              <EstimatedNote dim="domain" visible={visible} t={t} fmt={fmt} />
            </Panel>

            {/* Intents */}
            <Panel title={t("intentsTitle")}>
              <Collapsible
                rows={rows("intent", intents, visible, locale)}
                selected={filters.intent}
                onSelect={(id) => openDim("intent", id)}
                fmt={fmt}
                t={t}
              />
              <EstimatedNote dim="intent" visible={visible} t={t} fmt={fmt} />
            </Panel>

            {/* Register */}
            <Panel title={t("registerTitle")} className="lg:col-span-2">
              <StackBar
                rows={rows("register", registers, visible, locale)}
                selected={filters.register}
                onSelect={(id) => openDim("register", id)}
                fmt={fmt}
                label={registers
                  .map((r) => `${categoryLabel(locale, "register", r.id)} ${fmt.pct(r.share)}`)
                  .join(", ")}
              />
              <p className="mt-3 text-[11.5px] text-faint">
                {t("ofVisible", { n: fmt.num(visible.length) })}
              </p>
            </Panel>

            {/* Patterns */}
            <Panel
              title={t("patterns")}
              className="lg:col-span-2"
              action={
                <button
                  type="button"
                  onClick={() => {
                    const v = !insightsHidden;
                    setInsightsHidden(v);
                    writeStatsPrefs({ insightsHidden: v });
                  }}
                  className="press-soft h-8 rounded-full px-3 text-[12px] text-muted-foreground"
                >
                  {insightsHidden ? t("show") : t("hide")}
                </button>
              }
            >
              {insightsHidden ? (
                <p className="text-[13px] text-faint">{t("patternsHidden")}</p>
              ) : visible.length < INSIGHT_MIN ? (
                <p className="text-[13px] text-muted-foreground">
                  {t("notEnough", { n: fmt.num(visible.length), min: fmt.num(INSIGHT_MIN) })}
                </p>
              ) : (
                <Insights items={found} fmt={fmt} t={t} locale={locale} onDim={openDim} />
              )}
            </Panel>

            {/* Translations */}
            <Panel title={t("recentTitle")} className="lg:col-span-2">
              <RecordList
                records={visible}
                onOpen={setRecordId}
                fmt={fmt}
                t={t}
                locale={locale}
                limit={12}
              />
            </Panel>
          </div>
        )}

        <footer className="mx-5 mt-8 border-t border-border pt-5 text-[12px] leading-relaxed text-muted-foreground">
          <p>{t("privacy")}</p>
          {confirmForget ? (
            <div className="mt-3 rounded-2xl bg-card p-4">
              <p className="text-[13px] text-foreground">{t("forgetConfirm")}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmForget(false)}
                  className="press-soft h-10 flex-1 rounded-full border border-border text-[13px]"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={forgetAll}
                  className="press h-10 flex-1 rounded-full bg-destructive text-[13px] font-medium text-destructive-foreground"
                >
                  {t("confirmDelete")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmForget(true)}
              className="press-soft mt-2 underline decoration-border-strong underline-offset-4"
            >
              {t("forgetAll")}
            </button>
          )}
        </footer>
      </>
    );

  return (
    <main dir={dir} className="min-h-[100dvh] bg-background pb-12 text-foreground pad-safe-top">
      <div className="mx-auto w-full max-w-xl lg:max-w-5xl">
        {header}
        <div className="px-5 pb-1 pt-2">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{t("title")}</h1>
          <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        {body}
      </div>

      <DetailSheet
        spec={detail}
        records={detailRecords}
        visibleTotal={visible.length}
        bounds={bounds}
        granularity={gran}
        todayKey={today}
        onClose={() => setDetail(null)}
        onOpen={setRecordId}
        onApply={(key, value) => {
          setFilter(key, value);
          setDetail(null);
        }}
        fmt={fmt}
        t={t}
        locale={locale}
        dir={dir}
      />
      <RecordSheet
        record={recordId ? (byId.get(recordId) ?? null) : null}
        onClose={() => setRecordId(null)}
        onOpenInTranslator={openInTranslator}
        fmt={fmt}
        t={t}
        locale={locale}
        dir={dir}
      />
      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        periodRecords={periodRecords}
        filters={filters}
        onChange={setFilter}
        fmt={fmt}
        t={t}
        locale={locale}
        dir={dir}
      />
      <KpiSheet
        kpi={kpi}
        onClose={() => setKpi(null)}
        summary={summary}
        prev={prevSummary}
        prevDays={prevB?.days ?? null}
        pairs={pairs}
        fmt={fmt}
        t={t}
        dir={dir}
        onShow={() => {
          setKpi(null);
          setDetail({ title: t("recentTitle") });
        }}
      />
    </main>
  );
}

/* ================================================================ pieces */

function filterName(
  k: keyof Filters,
  v: string,
  fmt: Fmt,
  locale: ReturnType<typeof useI18n>["locale"],
) {
  if (k === "pair") return fmt.pair(v);
  if (k === "lang") return fmt.langName(v);
  return categoryLabel(locale, k, v);
}

function rows(
  dim: Dimension,
  slices: ReturnType<typeof distribution>,
  visible: StatRecord[],
  locale: ReturnType<typeof useI18n>["locale"],
): BarRow[] {
  // A category is marked estimated when most of its translations were classified on-device.
  const local = new Map<string, number>();
  for (const r of visible)
    if (r.origin[dim] === "local") local.set(r[dim], (local.get(r[dim]) ?? 0) + 1);
  return slices.map((s) => ({
    id: s.id,
    label: categoryLabel(locale, dim, s.id),
    count: s.count,
    share: s.share,
    color: colorOf(dim, s.id),
    estimated: (local.get(s.id) ?? 0) > s.count / 2,
  }));
}

/** One quiet line per panel: how much of it is an on-device estimate (correctable per translation). */
function EstimatedNote({
  dim,
  visible,
  t,
  fmt,
}: {
  dim: Dimension;
  visible: StatRecord[];
  t: ReturnType<typeof statsT>;
  fmt: Fmt;
}) {
  const n = visible.filter((r) => r.origin[dim] === "local").length;
  if (!n) return null;
  return (
    <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-faint">
      {t("estimatedShare", { n: fmt.num(n), total: fmt.num(visible.length) })}
    </p>
  );
}

function Panel({
  title,
  children,
  className = "",
  action,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`animate-fade rounded-[22px] bg-surface p-4 pt-3.5 ${className}`}>
      <div className="mb-2.5 flex min-h-8 items-center justify-between gap-2 px-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function KpiCard({
  label,
  value,
  sub,
  delta,
  prev,
  wide,
  className = "",
  fmt,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  delta?: number | null | undefined;
  prev?: unknown;
  wide?: boolean;
  className?: string;
  fmt: Fmt;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press-soft flex min-h-[104px] flex-col justify-between rounded-[20px] bg-surface p-4 text-start ${className}`}
    >
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="mt-3 flex items-baseline gap-1.5">
        <span
          className={`${wide ? "text-[30px]" : "text-[26px]"} font-semibold leading-none tracking-tight tabular-nums`}
        >
          {value}
        </span>
        {sub ? (
          <span dir="auto" className="min-w-0 truncate text-[12px] text-muted-foreground">
            {sub}
          </span>
        ) : null}
      </span>
      {prev !== undefined && delta !== undefined && delta !== null ? (
        <span className="mt-1.5 text-[11.5px] tabular-nums text-muted-foreground">
          {fmt.delta(delta)}
        </span>
      ) : null}
    </button>
  );
}

function RangePicker({
  range,
  from,
  to,
  today,
  t,
  onRange,
  onCustom,
}: {
  range: RangeId;
  from: string;
  to: string;
  today: string;
  t: ReturnType<typeof statsT>;
  onRange: (r: RangeId) => void;
  onCustom: (from: string, to: string) => void;
}) {
  return (
    <div className="mt-4">
      <div role="radiogroup" aria-label={t("period")} className="flex flex-wrap gap-1 px-5">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={range === r}
            onClick={() => onRange(r)}
            className={`press-soft h-9 shrink-0 rounded-full px-3.5 text-[13px] transition-colors ${
              range === r
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`r_${r}` as StatsKey)}
          </button>
        ))}
      </div>
      {range === "custom" ? (
        <div className="animate-fade mt-2 flex items-center gap-2 px-5 text-[13px]">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[11.5px] text-muted-foreground">{t("fromDate")}</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => isDayKey(e.target.value) && onCustom(e.target.value, to)}
              className="h-10 rounded-xl bg-surface px-3 text-foreground [color-scheme:inherit]"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[11.5px] text-muted-foreground">{t("toDate")}</span>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => isDayKey(e.target.value) && onCustom(from, e.target.value)}
              className="h-10 rounded-xl bg-surface px-3 text-foreground [color-scheme:inherit]"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function BucketReadout({
  buckets,
  sel,
  metric,
  gran,
  fmt,
  t,
  onView,
}: {
  buckets: ReturnType<typeof timeline>;
  sel: string | null;
  metric: Metric;
  gran: ReturnType<typeof granularityFor>;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  onView: (b: ReturnType<typeof timeline>[number]) => void;
}) {
  const b = sel ? buckets.find((x) => x.key === sel) : null;
  // Fixed height: selecting a bar never shifts the chart.
  return (
    <div className="mb-2 flex h-9 items-center justify-between gap-2" aria-live="polite">
      {b ? (
        <>
          <span className="min-w-0 truncate text-[13px]">
            <span className="text-muted-foreground">{fmt.bucket(b.from, b.to, gran)}</span>
            <span className="ms-2 font-semibold tabular-nums">{fmt.num(b[metric])}</span>
            <span className="ms-1 text-muted-foreground">
              {t(metric === "translations" ? "m_translations" : "m_words")}
            </span>
          </span>
          {b.translations > 0 ? (
            <button
              type="button"
              onClick={() => onView(b)}
              className="press-soft h-8 shrink-0 rounded-full border border-border px-3 text-[12px]"
            >
              {t("viewTranslations")}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function TimelineSummary({
  buckets,
  metric,
  gran,
  fmt,
  t,
}: {
  buckets: ReturnType<typeof timeline>;
  metric: Metric;
  gran: ReturnType<typeof granularityFor>;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
}) {
  const active = buckets.filter((b) => b.translations > 0).length;
  let peak = buckets[0];
  for (const b of buckets) if (peak && b[metric] > peak[metric]) peak = b;
  if (!active || !peak)
    return <p className="mt-3 text-[12.5px] text-muted-foreground">{t("noActivity")}</p>;
  return (
    <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
      {buckets.length > 1 ? (
        <>{t("peak", { when: fmt.bucket(peak.from, peak.to, gran), n: fmt.num(peak[metric]) })} </>
      ) : null}
      {t("activeBuckets", {
        a: fmt.num(active),
        b: fmt.num(buckets.length),
        unit: t(`u_${gran}` as StatsKey),
      })}
    </p>
  );
}

function PairsBlock({
  pairs,
  total,
  selected,
  fmt,
  t,
  onOpen,
}: {
  pairs: ReturnType<typeof distribution>;
  total: number;
  selected: string | null;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  onOpen: (id: string) => void;
}) {
  const { top, others } = topWithOthers(pairs, 5);
  const all = others ? [...top, others] : top;
  const color = (id: string) => (id === "__others" ? OTHERS_COLOR : pairColor(id));
  const name = (id: string) => (id === "__others" ? t("others") : fmt.pair(id));
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[188px_1fr]">
      <Donut
        slices={all.map((s) => ({
          id: s.id,
          value: s.count,
          color: color(s.id),
          label: `${name(s.id)}: ${fmt.num(s.count)}`,
        }))}
        selected={selected}
        onSelect={onOpen}
        center={fmt.num(pairs.length)}
        caption={t("k_pairs")}
        label={all.map((s) => `${name(s.id)} ${fmt.pct(s.share)}`).join(", ")}
      />
      <BarList
        rows={all.map((s) => ({
          id: s.id,
          label: name(s.id),
          count: s.count,
          share: s.share,
          color: color(s.id),
        }))}
        selected={selected}
        onSelect={onOpen}
        fmt={fmt}
      />
      <p className="text-[11.5px] text-faint sm:col-span-2">
        {t("ofVisible", { n: fmt.num(total) })}
      </p>
    </div>
  );
}

function Collapsible({
  rows: list,
  selected,
  onSelect,
  fmt,
  t,
}: {
  rows: BarRow[];
  selected?: string | undefined;
  onSelect: (id: string) => void;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
}) {
  const [all, setAll] = useState(false);
  const LIMIT = 6;
  const shown = all ? list : list.slice(0, LIMIT);
  return (
    <>
      <BarList rows={shown} selected={selected} onSelect={onSelect} fmt={fmt} />
      {list.length > LIMIT ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="press-soft mt-1 inline-flex h-9 items-center gap-1 px-2 text-[12.5px] text-muted-foreground"
        >
          {all ? t("showLess") : t("more_n", { n: fmt.num(list.length - LIMIT) })}
          <ChevronDown
            className={`size-3.5 transition-transform ${all ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
        </button>
      ) : null}
    </>
  );
}

function Insights({
  items,
  fmt,
  t,
  locale,
  onDim,
}: {
  items: Insight[];
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  locale: ReturnType<typeof useI18n>["locale"];
  onDim: (key: Dimension | "pair", id: string) => void;
}) {
  if (!items.length)
    return (
      <p className="text-[13px] text-muted-foreground">
        {t("notEnough", { n: "—", min: fmt.num(INSIGHT_MIN) })}
      </p>
    );
  return (
    <ul className="flex flex-col">
      {items.map((it, i) => {
        let text: ReactNode = null;
        let tap: (() => void) | undefined;
        let color: string | undefined;
        if (it.type === "topDomain") {
          text = t("i_topDomain", {
            label: categoryLabel(locale, "domain", it.domain),
            count: fmt.num(it.count),
            total: fmt.num(it.total),
            pct: fmt.pct(it.count / it.total),
          });
          tap = () => onDim("domain", it.domain);
          color = colorOf("domain", it.domain);
        } else if (it.type === "topPair") {
          text = t("i_topPair", {
            label: fmt.pair(it.pair),
            count: fmt.num(it.count),
            total: fmt.num(it.total),
          });
          tap = () => onDim("pair", it.pair);
          color = pairColor(it.pair);
        } else if (it.type === "topKind") {
          text = t("i_topKind", {
            label: categoryLabel(locale, "kind", it.kind),
            pct: fmt.pct(it.count / it.total),
          });
          tap = () => onDim("kind", it.kind);
          color = colorOf("kind", it.kind);
        } else if (it.type === "intentShift") {
          text = t("i_shift", {
            label: categoryLabel(locale, "intent", it.intent),
            a: fmt.pct(it.before),
            b: fmt.pct(it.after),
          });
          tap = () => onDim("intent", it.intent);
          color = colorOf("intent", it.intent);
        } else if (it.type === "estimated") {
          text = (
            <span className="text-faint">
              {t("i_estimated", { count: fmt.num(it.count), total: fmt.num(it.total) })}
            </span>
          );
        } else if (it.type === "repeated") {
          text = (
            <span>
              {t("i_repeated")}
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {it.items.map((x) => (
                  <span
                    key={x.text}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[12.5px]"
                  >
                    <span dir="auto" className="truncate">
                      {x.text}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {t("i_times", { n: x.times })}
                    </span>
                  </span>
                ))}
              </span>
            </span>
          );
        }
        const inner = (
          <span className="flex items-start gap-2.5">
            <span
              className="mt-[7px] size-1.5 shrink-0 rounded-full"
              style={{ background: color ?? "var(--faint)" }}
            />
            <span className="min-w-0 flex-1 text-[13.5px] leading-relaxed">{text}</span>
          </span>
        );
        return (
          <li key={`${it.type}-${i}`} className="border-b border-border last:border-b-0">
            {tap ? (
              <button type="button" onClick={tap} className="press-soft w-full py-2.5 text-start">
                {inner}
              </button>
            ) : (
              <div className="py-2.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function KpiSheet({
  kpi,
  onClose,
  summary,
  prev,
  prevDays,
  pairs,
  fmt,
  t,
  dir,
  onShow,
}: {
  kpi: Kpi | null;
  onClose: () => void;
  summary: ReturnType<typeof summarize>;
  prev: ReturnType<typeof summarize> | null;
  prevDays: number | null;
  pairs: ReturnType<typeof distribution>;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  dir: "rtl" | "ltr";
  onShow: () => void;
}) {
  const meta: Record<Kpi, { label: StatsKey; def: StatsKey; value: string; prev: number | null }> =
    {
      translations: {
        label: "k_translations",
        def: "d_translations",
        value: fmt.num(summary.translations),
        prev: prev?.translations ?? null,
      },
      words: {
        label: "k_words",
        def: "d_words",
        value: fmt.num(summary.words),
        prev: prev?.words ?? null,
      },
      pairs: {
        label: "k_pairs",
        def: "d_pairs",
        value: fmt.num(summary.pairs),
        prev: prev?.pairs ?? null,
      },
      days: {
        label: "k_days",
        def: "d_days",
        value: fmt.num(summary.activeDays),
        prev: prev?.activeDays ?? null,
      },
      avg: {
        label: "k_avg",
        def: "d_avg",
        value: summary.avgWords === null ? "—" : fmt.num1(summary.avgWords),
        prev: null,
      },
    };
  const m = kpi ? meta[kpi] : null;
  return (
    <Sheet
      open={!!kpi}
      onClose={onClose}
      label={m ? t(m.label) : ""}
      dir={dir}
      closeLabel={t("close")}
      title={m ? <h2 className="text-[17px] font-semibold tracking-tight">{t(m.label)}</h2> : null}
      footer={
        <button
          type="button"
          onClick={onShow}
          className="press h-11 w-full rounded-full bg-primary text-[14px] font-medium text-primary-foreground"
        >
          {t("viewTranslations")}
        </button>
      }
    >
      {m ? (
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-[40px] font-semibold leading-none tracking-tight tabular-nums">
            {m.value}
          </p>
          <p className="text-[14px] leading-relaxed text-muted-foreground">{t(m.def)}</p>
          {kpi !== "avg" ? (
            <p className="text-[13px] tabular-nums text-muted-foreground">
              {prevDays === null
                ? t("noCompareAll")
                : m.prev
                  ? `${t("vsPrev", { n: fmt.num(prevDays) })}: ${fmt.num(m.prev)}`
                  : t("noCompare")}
            </p>
          ) : null}
          {kpi === "translations" && summary.legacy ? (
            <p className="text-[13px] text-muted-foreground">
              {t("legacyNote", { n: fmt.num(summary.legacy) })}
            </p>
          ) : null}
          {kpi === "pairs" ? (
            <ul className="flex flex-col">
              {pairs.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 border-b border-border py-2 text-[14px] last:border-b-0"
                >
                  <span className="size-2 rounded-[3px]" style={{ background: pairColor(p.id) }} />
                  <span className="flex-1">{fmt.pair(p.id)}</span>
                  <span className="tabular-nums">{fmt.num(p.count)}</span>
                  <span className="w-10 text-end text-[12px] tabular-nums text-muted-foreground">
                    {fmt.pct(p.share)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

function Calm({
  title,
  text,
  children,
  mark,
  small,
}: {
  title: string;
  text?: string;
  children?: ReactNode;
  mark?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={`animate-fade mx-5 flex flex-col items-center text-center ${small ? "mt-8 gap-4 py-8" : "mt-10 gap-5 rounded-[26px] bg-surface px-6 py-14"}`}
    >
      {mark ? (
        <svg width="76" height="44" viewBox="0 0 76 44" aria-hidden className="text-faint">
          {[8, 18, 12, 26, 20, 34, 16].map((h, i) => (
            <rect
              key={i}
              x={i * 11}
              y={44 - h}
              width="6"
              height={h}
              rx="3"
              fill="currentColor"
              opacity={i === 5 ? 1 : 0.45}
              style={i === 5 ? { fill: "var(--signal)" } : undefined}
            />
          ))}
        </svg>
      ) : null}
      <h2
        className={`${small ? "text-[15px]" : "text-[20px]"} max-w-xs font-semibold leading-snug tracking-tight`}
      >
        {title}
      </h2>
      {text ? (
        <p className="max-w-sm text-[14px] leading-relaxed text-muted-foreground">{text}</p>
      ) : null}
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-4 px-5" aria-busy="true">
      <div className="flex gap-1">
        {RANGES.map((r) => (
          <div key={r} className="shimmer h-9 w-16 rounded-full" />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-[104px] rounded-[20px]" />
        ))}
      </div>
      <div className="shimmer mt-3 h-[260px] rounded-[22px]" />
      <div className="shimmer mt-3 h-[220px] rounded-[22px]" />
    </div>
  );
}
