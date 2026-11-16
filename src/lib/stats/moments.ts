import { addDays, type Slice, type StatRecord } from "./engine";

/**
 * The second layer of Translation Statistics: shape over time rather than totals.
 * Everything here is pure, derived from the same local archive, and deterministic for a
 * given set of records and calendar day. No UI, no storage, no clock of its own.
 */

/* ------------------------------------------------------------------- rhythm */

export type PartOfDay = "night" | "morning" | "afternoon" | "evening";
export const PARTS_OF_DAY: readonly PartOfDay[] = ["night", "morning", "afternoon", "evening"];

export interface Rhythm {
  /** 24 buckets, indexed by the local hour of the translation. */
  hours: number[];
  /** 7 buckets, Monday first. */
  weekdays: number[];
  parts: Record<PartOfDay, number>;
  /** Earliest busiest hour/day when two tie; null when there is nothing to count. */
  peakHour: number | null;
  peakWeekday: number | null;
  total: number;
}

export function partOfDay(hour: number): PartOfDay {
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

const HOUR_FMT = new Map<string, Intl.DateTimeFormat>();
function hourFormatter(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let f = HOUR_FMT.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      ...(timeZone ? { timeZone } : {}),
    });
    HOUR_FMT.set(key, f);
  }
  return f;
}

/** Hour of the day (0–23) of an instant in the device's zone, or an explicit one for tests. */
export function hourOfDay(ms: number, timeZone?: string): number {
  const parts = hourFormatter(timeZone).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
}

/** Monday-first weekday index of a calendar day key. */
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
}

export function rhythm(records: StatRecord[], timeZone?: string): Rhythm {
  const hours = Array.from({ length: 24 }, () => 0);
  const weekdays = Array.from({ length: 7 }, () => 0);
  const parts: Record<PartOfDay, number> = { night: 0, morning: 0, afternoon: 0, evening: 0 };
  for (const r of records) {
    const h = hourOfDay(r.createdAt, timeZone);
    hours[h] = (hours[h] ?? 0) + 1;
    parts[partOfDay(h)] += 1;
    const d = weekdayIndex(r.day);
    weekdays[d] = (weekdays[d] ?? 0) + 1;
  }
  let peakHour: number | null = null;
  let peakWeekday: number | null = null;
  for (let i = 0; i < hours.length; i++)
    if (hours[i]! > 0 && (peakHour === null || hours[i]! > hours[peakHour]!)) peakHour = i;
  for (let i = 0; i < weekdays.length; i++)
    if (weekdays[i]! > 0 && (peakWeekday === null || weekdays[i]! > weekdays[peakWeekday]!))
      peakWeekday = i;
  return { hours, weekdays, parts, peakHour, peakWeekday, total: records.length };
}

/* ------------------------------------------------------------------ streaks */

export interface Streaks {
  /** Consecutive active days ending today or yesterday; 0 after a full missed day. */
  current: number;
  /** Longest run ever in this archive. */
  longest: number;
  /** Most recent active day, if any. */
  lastActive: string | null;
  totalDays: number;
}

/**
 * A streak stays alive until a whole day is missed, which is what a person means by
 * "I'm on a streak" while today is still young. Tomorrow's visit still sees yesterday's
 * run; the day after a missed day resets it.
 */
export function streaks(records: StatRecord[], today: string): Streaks {
  const days = [...new Set(records.map((r) => r.day))].sort();
  let longest = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && addDays(days[i - 1]!, 1) === days[i] ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  const set = new Set(days);
  let cursor = set.has(today) ? today : set.has(addDays(today, -1)) ? addDays(today, -1) : null;
  let current = 0;
  while (cursor && set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return {
    current,
    longest,
    lastActive: days[days.length - 1] ?? null,
    totalDays: days.length,
  };
}

/* ------------------------------------------------------------------ records */

export interface Highlights {
  bestDay: { day: string; count: number } | null;
  busiestHour: { hour: number; count: number } | null;
  /** Longest source text, by words then characters; the exact record, for its sheet. */
  longest: StatRecord | null;
  first: StatRecord | null;
}

export function highlights(records: StatRecord[], timeZone?: string): Highlights {
  const byDay = new Map<string, number>();
  let first: StatRecord | null = null;
  let longest: StatRecord | null = null;
  for (const r of records) {
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + 1);
    if (!first || r.createdAt < first.createdAt) first = r;
    if (
      !longest ||
      r.words > longest.words ||
      (r.words === longest.words && r.original.length > longest.original.length) ||
      (r.words === longest.words &&
        r.original.length === longest.original.length &&
        r.createdAt > longest.createdAt)
    )
      longest = r;
  }
  let bestDay: Highlights["bestDay"] = null;
  for (const [day, count] of byDay)
    if (!bestDay || count > bestDay.count || (count === bestDay.count && day < bestDay.day))
      bestDay = { day, count };
  const rh = rhythm(records, timeZone);
  return {
    bestDay,
    busiestHour:
      rh.peakHour === null ? null : { hour: rh.peakHour, count: rh.hours[rh.peakHour] ?? 0 },
    longest,
    first,
  };
}

/* --------------------------------------------------------------- milestones */

export type MilestoneMetric = "translations" | "words" | "pairs" | "streak" | "days";

export interface Milestone {
  id: string;
  metric: MilestoneMetric;
  target: number;
  value: number;
  achieved: boolean;
}

export interface MilestoneInput {
  translations: number;
  words: number;
  pairs: number;
  activeDays: number;
  longestStreak: number;
}

const DEFINITIONS: { id: string; metric: MilestoneMetric; target: number }[] = [
  { id: "first", metric: "translations", target: 1 },
  { id: "t10", metric: "translations", target: 10 },
  { id: "t50", metric: "translations", target: 50 },
  { id: "t100", metric: "translations", target: 100 },
  { id: "t250", metric: "translations", target: 250 },
  { id: "t500", metric: "translations", target: 500 },
  { id: "t1000", metric: "translations", target: 1000 },
  { id: "w100", metric: "words", target: 100 },
  { id: "w1000", metric: "words", target: 1000 },
  { id: "w10000", metric: "words", target: 10000 },
  { id: "p2", metric: "pairs", target: 2 },
  { id: "p5", metric: "pairs", target: 5 },
  { id: "s3", metric: "streak", target: 3 },
  { id: "s7", metric: "streak", target: 7 },
  { id: "s30", metric: "streak", target: 30 },
  { id: "d7", metric: "days", target: 7 },
  { id: "d30", metric: "days", target: 30 },
];

const valueFor = (metric: MilestoneMetric, input: MilestoneInput): number =>
  metric === "translations"
    ? input.translations
    : metric === "words"
      ? input.words
      : metric === "pairs"
        ? input.pairs
        : metric === "streak"
          ? input.longestStreak
          : input.activeDays;

export function milestones(input: MilestoneInput): Milestone[] {
  return DEFINITIONS.map((d) => {
    const value = valueFor(d.metric, input);
    return { ...d, value, achieved: value >= d.target };
  });
}

/** The closest unfinished milestones first: biggest share of the goal already behind you. */
export function nextMilestones(list: Milestone[], limit = 3): Milestone[] {
  return list
    .filter((m) => !m.achieved)
    .sort((a, b) => b.value / b.target - a.value / a.target || a.target - b.target)
    .slice(0, limit);
}

/* ------------------------------------------------------------- language flow */

export interface FlowNode {
  code: string;
  count: number;
}

export interface FlowLink {
  pair: string;
  from: string;
  to: string;
  count: number;
  /** Share of the records actually drawn in this graph, not of the whole archive. */
  share: number;
}

export interface LanguageFlow {
  sources: FlowNode[];
  targets: FlowNode[];
  links: FlowLink[];
  shown: number;
  omitted: number;
  omittedCount: number;
  total: number;
}

/**
 * The strongest directions as a bipartite graph: source languages on one side, target
 * languages on the other, each ribbon a real pair that can be opened. Only the strongest
 * directions are drawn; the remainder is reported as a count, never silently dropped.
 */
export function languageFlow(slices: Slice[], maxPairs = 6): LanguageFlow {
  const links: FlowLink[] = [];
  for (const s of slices.slice(0, maxPairs)) {
    const [from, to] = s.id.split(">");
    if (!from || !to) continue;
    links.push({ pair: s.id, from, to, count: s.count, share: 0 });
  }
  const shown = links.reduce((n, l) => n + l.count, 0);
  for (const l of links) l.share = shown ? l.count / shown : 0;
  const totals = (side: "from" | "to") => {
    const m = new Map<string, number>();
    for (const l of links) m.set(l[side], (m.get(l[side]) ?? 0) + l.count);
    return [...m.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  };
  const total = slices.reduce((n, s) => n + s.count, 0);
  return {
    sources: totals("from"),
    targets: totals("to"),
    links,
    shown,
    omitted: Math.max(0, slices.length - links.length),
    omittedCount: Math.max(0, total - shown),
    total,
  };
}
