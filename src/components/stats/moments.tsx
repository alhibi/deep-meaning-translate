import { memo } from "react";
import {
  CalendarDays,
  Check,
  Clock,
  FileText,
  Flame,
  Moon,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Trophy,
} from "lucide-react";
import {
  PARTS_OF_DAY,
  nextMilestones,
  partOfDay,
  type FlowNode,
  type Highlights,
  type LanguageFlow,
  type Milestone,
  type PartOfDay,
  type PracticeProfile,
  type Rhythm,
  type Streaks,
} from "@/lib/stats/moments";
import { colorOf, pairColor } from "@/lib/stats/taxonomy";
import { categoryLabel, statsT } from "@/lib/stats/labels";
import type { Fmt } from "./format";

const PART_COLOR: Record<PartOfDay, string> = {
  night: "var(--cat-4)",
  morning: "var(--cat-5)",
  afternoon: "var(--cat-1)",
  evening: "var(--cat-10)",
};

/* --------------------------------------------------------- practice profile */

/**
 * A tactile topic map: visual weight follows the actual share, every colored item is
 * a button, and the surrounding figures disclose exactly what the picture means.
 */
export function PracticeLandscape({
  profile,
  fmt,
  t,
  locale,
  onOpenDomain,
}: {
  profile: PracticeProfile;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  locale: "en" | "ar" | "de";
  onOpenDomain: (domain: string) => void;
}) {
  const strongest = Math.max(1, ...profile.domains.map((domain) => domain.count));
  return (
    <div>
      <p className="mb-5 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
        {t("landscapeSub")}
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        <ProfileMetric
          label={t("landscapeFocus")}
          value={profile.focus ? categoryLabel(locale, "domain", profile.focus.id) : "—"}
          detail={profile.focus ? fmt.pct(profile.focus.share) : "—"}
        />
        <ProfileMetric
          label={t("landscapeVariety")}
          value={fmt.num(profile.activeDomains)}
          detail={t("domainsTitle")}
        />
        <ProfileMetric
          label={t("landscapeRhythm")}
          value={`${fmt.num(profile.activeDays)} / ${fmt.num(profile.possibleDays)}`}
          detail={t("daysN", { n: fmt.num(profile.activeDays) })}
        />
        <ProfileMetric
          label={t("landscapeReturn")}
          value={fmt.num(profile.revisitedPhrases)}
          detail={profile.repeatUses ? `+${fmt.num(profile.repeatUses)}` : "—"}
        />
      </div>
      {profile.domains.length ? (
        <div
          className="mt-5 flex flex-wrap items-end gap-2.5"
          aria-label={profile.domains
            .map(
              (domain) => `${categoryLabel(locale, "domain", domain.id)} ${fmt.num(domain.count)}`,
            )
            .join(", ")}
        >
          {profile.domains.slice(0, 10).map((domain) => {
            const color = colorOf("domain", domain.id);
            const weight = domain.count / strongest;
            return (
              <button
                key={domain.id}
                type="button"
                onClick={() => onOpenDomain(domain.id)}
                className="press-soft flex max-w-full items-center gap-2 rounded-2xl border text-start motion-safe:transition-colors motion-safe:duration-300"
                style={{
                  minHeight: `${48 + weight * 14}px`,
                  paddingInline: `${12 + weight * 6}px`,
                  borderColor: `color-mix(in oklab, ${color} 52%, var(--border))`,
                  backgroundColor: "var(--surface)",
                  background: `color-mix(in oklab, ${color} 15%, var(--surface))`,
                }}
                aria-label={`${categoryLabel(locale, "domain", domain.id)}: ${fmt.num(domain.count)}`}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
                <span className="max-w-40 truncate text-[12.5px] font-medium">
                  {categoryLabel(locale, "domain", domain.id)}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {fmt.pct(domain.share)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-5 text-[12.5px] leading-relaxed text-faint">{t("landscapeNoTopic")}</p>
      )}
    </div>
  );
}

function ProfileMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface px-3 py-3">
      <p className="truncate text-[11.5px] text-muted-foreground">{label}</p>
      <p className="mt-2 truncate text-[16px] font-semibold leading-tight tabular-nums">{value}</p>
      <p className="mt-1 truncate text-[11px] text-faint">{detail}</p>
    </div>
  );
}

function PartIcon({ part, className }: { part: PartOfDay; className?: string }) {
  const Icon =
    part === "night" ? Moon : part === "morning" ? Sunrise : part === "afternoon" ? Sun : Sunset;
  return <Icon className={className} strokeWidth={1.6} />;
}

function partLabel(t: ReturnType<typeof statsT>, part: PartOfDay): string {
  return t(
    part === "night"
      ? "partNight"
      : part === "morning"
        ? "partMorning"
        : part === "afternoon"
          ? "partAfternoon"
          : "partEvening",
  );
}

/* ------------------------------------------------------------------- rhythm */

/**
 * 24 hour marks around a clock. Height is frequency, colour is the part of the day, and
 * the busiest hour is written in the middle. Hours are real buttons when a detail view is
 * available, so the graph is not a picture you can only look at.
 */
const RhythmDial = memo(function RhythmDial({
  data,
  fmt,
  t,
  selectedHour,
  onPickHour,
}: {
  data: Rhythm;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  selectedHour?: number | null | undefined;
  onPickHour?: ((hour: number) => void) | undefined;
}) {
  const max = Math.max(1, ...data.hours);
  const peak = data.peakHour;
  const center = 84;
  const inner = 33;
  const label = t("rhythmLabel", {
    hour: peak === null ? "—" : fmt.hour(peak),
    n: fmt.num(peak === null ? 0 : (data.hours[peak] ?? 0)),
  });
  return (
    <div className="relative mx-auto w-full max-w-[188px]">
      <svg viewBox="0 0 168 168" className="size-full" role="group" aria-label={label}>
        <circle
          cx={center}
          cy={center}
          r={63}
          fill="none"
          stroke="var(--border)"
          strokeWidth="1"
          strokeDasharray="2 5"
        />
        {data.hours.map((count, hour) => {
          const angle = ((hour * 15 - 90) * Math.PI) / 180;
          const len = count ? 11 + (count / max) * 38 : 7;
          const x1 = center + Math.cos(angle) * inner;
          const y1 = center + Math.sin(angle) * inner;
          const x2 = center + Math.cos(angle) * (inner + len);
          const y2 = center + Math.sin(angle) * (inner + len);
          const active = selectedHour === hour;
          const interactive = !!onPickHour && count > 0;
          const color = active ? "var(--signal)" : PART_COLOR[partOfDay(hour)];
          return (
            <g
              key={hour}
              className="stats-rhythm-hit"
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : -1}
              aria-label={`${fmt.hour(hour)}: ${fmt.num(count)}`}
              aria-pressed={interactive ? active : undefined}
              style={{ cursor: interactive ? "pointer" : "default" }}
              onClick={interactive ? () => onPickHour?.(hour) : undefined}
              onKeyDown={
                interactive
                  ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onPickHour?.(hour);
                    }
                  : undefined
              }
            >
              <line
                data-hit
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth="14"
                strokeLinecap="round"
              />
              <line
                className="stats-rhythm-bar"
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={active ? 5 : 3.2}
                strokeLinecap="round"
                opacity={count ? 0.45 + 0.55 * (count / max) : 0.22}
              />
            </g>
          );
        })}
        <text
          x={center}
          y={80}
          textAnchor="middle"
          fill="var(--foreground)"
          style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
        >
          {peak === null ? "—" : fmt.hour(peak)}
        </text>
        <text
          x={center}
          y={96}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          style={{ fontSize: 8.5 }}
        >
          {t("peakHour")}
        </text>
      </svg>
    </div>
  );
});

function PartDayBar({ data, fmt, t }: { data: Rhythm; fmt: Fmt; t: ReturnType<typeof statsT> }) {
  const total = Math.max(1, data.total);
  return (
    <div>
      <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-full" aria-hidden="true">
        {PARTS_OF_DAY.map((part) => (
          <span
            key={part}
            className="h-full motion-safe:transition-[flex-grow] motion-safe:duration-500"
            style={{
              flexGrow: data.parts[part],
              flexBasis: 0,
              background: PART_COLOR[part],
              opacity: data.parts[part] ? 0.85 : 0.2,
            }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {PARTS_OF_DAY.map((part) => (
          <div key={part} className="flex min-w-0 items-center gap-2">
            <PartIcon part={part} className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
              {partLabel(t, part)}
            </span>
            <span className="text-[12px] tabular-nums text-foreground">
              {fmt.num(data.parts[part])}
            </span>
            <span className="w-8 text-end text-[11px] tabular-nums text-faint">
              {fmt.pct(data.parts[part] / total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekdayStrip({ data, fmt, t }: { data: Rhythm; fmt: Fmt; t: ReturnType<typeof statsT> }) {
  const max = Math.max(1, ...data.weekdays);
  const summary = data.weekdays
    .map((count, i) => `${fmt.weekdayOf(i)} ${fmt.num(count)}`)
    .join(", ");
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-muted-foreground">{t("weekdayTitle")}</span>
        <span className="text-[11px] tabular-nums text-faint">
          {data.peakWeekday === null ? "—" : fmt.num(data.weekdays[data.peakWeekday] ?? 0)}
        </span>
      </div>
      <div role="img" aria-label={summary} className="flex h-14 items-end gap-1.5" dir="ltr">
        {data.weekdays.map((count, i) => {
          const peak = data.peakWeekday === i && count > 0;
          return (
            <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span
                className={`w-full max-w-6 rounded-t-[3px] ${
                  peak ? "bg-signal" : count ? "bg-muted-foreground/45" : "bg-border"
                }`}
                style={{ height: count ? Math.max(4, (count / max) * 40) : 2 }}
              />
              <span className={`truncate text-[10px] ${peak ? "text-foreground" : "text-faint"}`}>
                {fmt.weekdayOf(i)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RhythmBlock({
  data,
  streak,
  fmt,
  t,
  selectedHour,
  onPickHour,
}: {
  data: Rhythm;
  streak: Streaks;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  selectedHour?: number | null | undefined;
  onPickHour?: ((hour: number) => void) | undefined;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-[190px_1fr] sm:items-center">
      <RhythmDial data={data} fmt={fmt} t={t} selectedHour={selectedHour} onPickHour={onPickHour} />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Flame className="size-3.5" strokeWidth={1.7} />
              <span className="text-[11.5px]">{t("streakCurrent")}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-[24px] font-semibold leading-none tabular-nums">
                {fmt.num(streak.current)}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                {t("daysN", { n: fmt.num(streak.current) })}
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Trophy className="size-3.5" strokeWidth={1.7} />
              <span className="text-[11.5px]">{t("streakBest")}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-[24px] font-semibold leading-none tabular-nums">
                {fmt.num(streak.longest)}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                {t("daysN", { n: fmt.num(streak.longest) })}
              </span>
            </div>
          </div>
        </div>
        <PartDayBar data={data} fmt={fmt} t={t} />
        <WeekdayStrip data={data} fmt={fmt} t={t} />
      </div>
      <p className="text-[11.5px] leading-relaxed text-faint sm:col-span-2">{t("streakHint")}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ records */

export function RecordsBlock({
  records,
  fmt,
  t,
  onOpenDay,
  onOpenRecord,
}: {
  records: Highlights;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  onOpenDay: (day: string) => void;
  onOpenRecord: (id: string) => void;
}) {
  const best = records.bestDay;
  const hour = records.busiestHour;
  const longest = records.longest;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <button
        type="button"
        disabled={!best}
        onClick={() => best && onOpenDay(best.day)}
        className="press-soft flex min-w-0 flex-col rounded-lg border border-border bg-surface p-3 text-start disabled:opacity-60"
        aria-label={best ? `${t("recordBestDay")}: ${fmt.dayLong(best.day)}` : t("recordBestDay")}
      >
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <CalendarDays className="size-3.5" strokeWidth={1.7} />
          <span className="text-[11.5px]">{t("recordBestDay")}</span>
        </span>
        <span className="mt-2 text-[16px] font-semibold leading-tight">
          {best ? fmt.day(best.day) : "—"}
        </span>
        <span className="mt-1 text-[11.5px] text-muted-foreground">
          {best ? t("count", { n: fmt.num(best.count) }) : t("noActivity")}
        </span>
      </button>

      <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface p-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="size-3.5" strokeWidth={1.7} />
          <span className="text-[11.5px]">{t("recordBusiestHour")}</span>
        </span>
        <span className="mt-2 text-[16px] font-semibold leading-tight tabular-nums">
          {hour ? fmt.hour(hour.hour) : "—"}
        </span>
        <span className="mt-1 text-[11.5px] text-muted-foreground">
          {hour ? t("count", { n: fmt.num(hour.count) }) : t("noActivity")}
        </span>
      </div>

      <button
        type="button"
        disabled={!longest}
        onClick={() => longest && onOpenRecord(longest.id)}
        className="press-soft flex min-w-0 flex-col rounded-lg border border-border bg-surface p-3 text-start disabled:opacity-60"
        aria-label={
          longest
            ? `${t("recordLongest")}: ${t("wordsN", { n: fmt.num(longest.words) })}`
            : t("recordLongest")
        }
      >
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <FileText className="size-3.5" strokeWidth={1.7} />
          <span className="text-[11.5px]">{t("recordLongest")}</span>
        </span>
        <span className="mt-2 text-[16px] font-semibold leading-tight tabular-nums">
          {longest ? t("wordsN", { n: fmt.num(longest.words) }) : "—"}
        </span>
        <span
          dir="auto"
          className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground"
        >
          {longest ? longest.original : t("noActivity")}
        </span>
      </button>

      <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface p-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Sparkles className="size-3.5" strokeWidth={1.7} />
          <span className="text-[11.5px]">{t("recordFirst")}</span>
        </span>
        <span className="mt-2 text-[16px] font-semibold leading-tight">
          {records.first ? fmt.day(records.first.day) : "—"}
        </span>
        <span className="mt-1 text-[11.5px] text-muted-foreground">
          {records.first ? fmt.pair(records.first.pair) : t("noActivity")}
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- milestones */

function milestoneLabel(m: Milestone, fmt: Fmt, t: ReturnType<typeof statsT>): string {
  if (m.id === "first") return t("milestoneFirst");
  switch (m.metric) {
    case "translations":
      return t("ms_translations", { n: fmt.num(m.target) });
    case "words":
      return t("ms_words", { n: fmt.num(m.target) });
    case "pairs":
      return t("ms_pairs", { n: fmt.num(m.target) });
    case "streak":
      return t("ms_streak", { n: fmt.num(m.target) });
    case "days":
      return t("ms_days", { n: fmt.num(m.target) });
  }
}

export function MilestonesBlock({
  all,
  fmt,
  t,
}: {
  all: Milestone[];
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
}) {
  const achieved = all.filter((m) => m.achieved).length;
  const next = nextMilestones(all, 3);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-muted-foreground">
          {t("milestonesDone", { done: fmt.num(achieved), total: fmt.num(all.length) })}
        </span>
        <span className="text-[11.5px] text-faint">{t("milestonesNote")}</span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={t("milestonesDone", { done: fmt.num(achieved), total: fmt.num(all.length) })}
      >
        <span
          className="block h-full rounded-full bg-signal motion-safe:transition-[width] motion-safe:duration-500"
          style={{ width: `${all.length ? (achieved / all.length) * 100 : 0}%` }}
        />
      </div>
      {next.length ? (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
            {t("milestonesNext")}
          </p>
          <ul className="flex flex-col gap-3">
            {next.map((m) => {
              const pct = Math.min(100, (m.value / m.target) * 100);
              return (
                <li key={m.id} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13.5px] text-foreground">
                      {milestoneLabel(m, fmt, t)}
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                      {fmt.num(m.value)} / {fmt.num(m.target)} ·{" "}
                      {t("ms_left", { n: fmt.num(m.target - m.value) })}
                    </span>
                  </div>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-border">
                    <span
                      className="block h-full rounded-full bg-signal/70 motion-safe:transition-[width] motion-safe:duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Check className="size-4 text-signal-text" strokeWidth={2} />
          {t("milestonesAll")}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- language flow */

interface Placed extends FlowNode {
  x: number;
  y: number;
  height: number;
}

function place(nodes: FlowNode[], x: number, top: number, bottom: number): Placed[] {
  const gap = 9;
  const total = nodes.reduce((n, node) => n + node.count, 0) || 1;
  const room = bottom - top - gap * Math.max(0, nodes.length - 1);
  let y = top;
  return nodes.map((node) => {
    const height = Math.max(7, (node.count / total) * room);
    const placed = { ...node, x, y, height };
    y += height + gap;
    return placed;
  });
}

function ribbon(x1: number, y1: number, x2: number, y2: number, width: number): string {
  const dx = (x2 - x1) * 0.48;
  const top = y1 - width / 2;
  const bottom = y1 + width / 2;
  const endTop = y2 - width / 2;
  const endBottom = y2 + width / 2;
  return [
    `M ${x1} ${top}`,
    `C ${x1 + dx} ${top}, ${x2 - dx} ${endTop}, ${x2} ${endTop}`,
    `L ${x2} ${endBottom}`,
    `C ${x2 - dx} ${endBottom}, ${x1 + dx} ${bottom}, ${x1} ${bottom}`,
    "Z",
  ].join(" ");
}

/**
 * Source languages → target languages, one ribbon per real direction. Width is frequency,
 * colour is the direction's stable colour, and every ribbon is a button that opens that
 * direction's translations. In RTL the source moves to the right and the reading edge
 * follows the interface; the data never changes direction.
 */
export const LanguageFlowMap = memo(function LanguageFlowMap({
  flow,
  selected,
  onSelect,
  fmt,
  t,
  rtl,
}: {
  flow: LanguageFlow;
  selected: string | null;
  onSelect: (pair: string) => void;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  rtl: boolean;
}) {
  const sourceX = rtl ? 252 : 88;
  const targetX = rtl ? 88 : 252;
  const top = 30;
  const bottom = 176;
  const sources = place(flow.sources, sourceX, top, bottom);
  const targets = place(flow.targets, targetX, top, bottom);
  if (!sources.length || !targets.length) return null;
  const sourceBy = new Map(sources.map((n) => [n.code, n]));
  const targetBy = new Map(targets.map((n) => [n.code, n]));
  const sourceCursor = new Map<string, number>();
  const targetCursor = new Map<string, number>();
  const drawn = [...flow.links]
    .sort((a, b) => a.count - b.count)
    .flatMap((link) => {
      const from = sourceBy.get(link.from);
      const to = targetBy.get(link.to);
      if (!from || !to) return [];
      const sy = sourceCursor.get(link.from) ?? from.y;
      const ty = targetCursor.get(link.to) ?? to.y;
      const sh = Math.max(1.5, (link.count / from.count) * from.height);
      const th = Math.max(1.5, (link.count / to.count) * to.height);
      sourceCursor.set(link.from, sy + sh);
      targetCursor.set(link.to, ty + th);
      const width = Math.min(12, Math.max(2, Math.min(sh, th) * 0.82));
      return [
        {
          ...link,
          path: ribbon(from.x, sy + sh / 2, to.x, ty + th / 2, width),
          width,
          color: pairColor(link.pair),
        },
      ];
    });
  const summary = t("flowSummary", { total: fmt.num(flow.shown) });
  return (
    <div>
      <svg
        viewBox="0 0 340 200"
        className="w-full"
        role="group"
        aria-label={summary}
        style={{ direction: rtl ? "rtl" : "ltr" }}
      >
        <text
          x={rtl ? sourceX + 8 : sourceX - 8}
          y={14}
          textAnchor={rtl ? "start" : "end"}
          fill="var(--faint)"
          style={{ fontSize: 9.5 }}
        >
          {t("flowFrom")}
        </text>
        <text
          x={rtl ? targetX - 8 : targetX + 8}
          y={14}
          textAnchor={rtl ? "end" : "start"}
          fill="var(--faint)"
          style={{ fontSize: 9.5 }}
        >
          {t("flowTo")}
        </text>
        {drawn.map((link) => {
          const dim = selected ? selected !== link.pair : false;
          return (
            <path
              key={`ribbon-${link.pair}`}
              d={link.path}
              fill={link.color}
              opacity={selected === link.pair ? 0.8 : dim ? 0.1 : 0.3}
              className="stats-flow-link pointer-events-none"
            />
          );
        })}
        {drawn.map((link) => (
          <path
            key={`hit-${link.pair}`}
            data-hit
            d={link.path}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(16, link.width + 10)}
            className="stats-flow-hit cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={`${fmt.pair(link.pair)}: ${fmt.num(link.count)}`}
            aria-pressed={selected === link.pair}
            onClick={() => onSelect(link.pair)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onSelect(link.pair);
            }}
          />
        ))}
        {sources.map((node) => (
          <g key={`s-${node.code}`} pointerEvents="none">
            <rect
              x={node.x - 3}
              y={node.y}
              width="6"
              height={node.height}
              rx="2.5"
              fill="var(--muted-foreground)"
              opacity="0.55"
            />
            <text
              x={rtl ? node.x + 10 : node.x - 10}
              y={node.y + node.height / 2}
              dy=".34em"
              textAnchor={rtl ? "start" : "end"}
              fill="var(--foreground)"
              style={{ fontSize: 10 }}
            >
              {fmt.langName(node.code)}
            </text>
          </g>
        ))}
        {targets.map((node) => (
          <g key={`t-${node.code}`} pointerEvents="none">
            <rect
              x={node.x - 3}
              y={node.y}
              width="6"
              height={node.height}
              rx="2.5"
              fill="var(--muted-foreground)"
              opacity="0.55"
            />
            <text
              x={rtl ? node.x - 10 : node.x + 10}
              y={node.y + node.height / 2}
              dy=".34em"
              textAnchor={rtl ? "end" : "start"}
              fill="var(--foreground)"
              style={{ fontSize: 10 }}
            >
              {fmt.langName(node.code)}
            </text>
          </g>
        ))}
      </svg>
      {flow.omitted > 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
          {t("flowOmitted", {
            n: fmt.num(flow.omitted),
            count: fmt.num(flow.omittedCount),
          })}
        </p>
      ) : null}
    </div>
  );
});
