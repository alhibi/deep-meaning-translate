import type { HistoryEntry } from "../history";
import { countWords, deriveRegister, localDomain, localIntent, localKind } from "./classify";
import { memoArray, memoEntry } from "./memo";
import type { Dimension, Domain, Intent, Kind, Register } from "./taxonomy";

/**
 * Translation Statistics engine. Pure functions over the device archive —
 * no UI, no storage, no clock (callers pass `now`), so every number is testable.
 *
 * Definitions (shown to the user, identical everywhere):
 * - A counted translation = one settled translation of one text into one target language.
 *   Re-showing, re-opening or re-translating the same text updates that row; it is never a new one.
 *   Failed attempts and untranslated drafts never reach the archive.
 * - Words = words of the SOURCE text (see countWords for the rule).
 * - Days are calendar days in the device's time zone at the moment of viewing.
 * - Shares are computed from the translations visible after the current period and filters.
 */

export type Source = "model" | "user" | "local";
export interface StatRecord {
  id: string;
  source: string;
  target: string;
  /** Directional: "ar>de" ≠ "de>ar". */
  pair: string;
  original: string;
  translated: string;
  createdAt: number;
  day: string;
  words: number;
  uses: number;
  kind: Kind;
  domain: Domain;
  intent: Intent;
  register: Register;
  origin: Record<Dimension, Source>;
  /** Written before statistics existed (imported from the old history). */
  legacy: boolean;
}

const lang = (code: string) => {
  const c = (code || "").slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(c) ? c : "auto";
};

/* ------------------------------------------------------------------ days */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** Calendar day "YYYY-MM-DD" of an instant, in the given (default: device) time zone. */
export function dayKey(ms: number, timeZone?: string): string {
  const id = timeZone ?? "";
  let f = fmtCache.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    fmtCache.set(id, f);
  }
  const p = f.formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const toUtc = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (key: string, n: number) => fromUtc(toUtc(key) + n * 86_400_000);
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
/** Monday of the ISO week containing the day. */
export function weekKey(key: string): string {
  const dow = (new Date(toUtc(key)).getUTCDay() + 6) % 7;
  return addDays(key, -dow);
}
export const monthKey = (key: string) => `${key.slice(0, 7)}-01`;
export const isDayKey = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && fromUtc(toUtc(v)) === v;

/* --------------------------------------------------------------- records */

function buildRecord(e: HistoryEntry, timeZone?: string): StatRecord {
  const source = lang(e.source);
  const target = lang(e.target);
  const fix = e.fix ?? {};
  const tags = e.tags ?? {};
  const pick = <T>(d: Dimension, user: T | undefined, model: T | undefined, local: () => T) =>
    user !== undefined
      ? { v: user, o: "user" as Source, d }
      : model !== undefined
        ? { v: model, o: "model" as Source, d }
        : { v: local(), o: "local" as Source, d };
  const kind = pick<Kind>("kind", fix.kind, tags.kind, () => localKind(e.original));
  const domain = pick<Domain>("domain", fix.domain, tags.domain, () =>
    localDomain(e.original, e.translated),
  );
  const intent = pick<Intent>("intent", fix.intent, tags.intent, () =>
    localIntent(e.original, e.translated),
  );
  const register = pick<Register>("register", fix.register, tags.register, () =>
    deriveRegister({ kind: kind.v, formality: e.formality, style: e.style }),
  );
  // A derived register is only as solid as its evidence: model kind/formality → model.
  const registerOrigin: Source =
    register.o !== "local" ? register.o : kind.o !== "local" || e.formality ? "model" : "local";
  return {
    id: e.id,
    source,
    target,
    pair: `${source}>${target}`,
    original: e.original,
    translated: e.translated,
    createdAt: e.createdAt,
    day: dayKey(e.createdAt, timeZone),
    words: countWords(e.original),
    uses: e.uses ?? 1,
    kind: kind.v,
    domain: domain.v,
    intent: intent.v,
    register: register.v,
    origin: { kind: kind.o, domain: domain.o, intent: intent.o, register: registerOrigin },
    legacy: e.v !== 2,
  };
}

/**
 * The per-row record, memoised by entry object + time zone. A tag correction maps one
 * entry to a new object and leaves the others as they were, so the statistics screen
 * re-classifies only the corrected row instead of all ~2,000. A different time zone is a
 * different day derivation, so it gets its own key; mutating an entry in place is not
 * something the archive does (every write builds a new row object).
 */
export function toRecord(e: HistoryEntry, timeZone?: string): StatRecord {
  return memoEntry(e, `record:${timeZone ?? ""}`, () => buildRecord(e, timeZone));
}

/** One record per id, newest first; empty translations are not translations. */
export function toRecords(entries: HistoryEntry[], timeZone?: string): StatRecord[] {
  const seen = new Set<string>();
  const out: StatRecord[] = [];
  for (const e of entries) {
    if (seen.has(e.id) || !e.translated.trim() || !e.original.trim()) continue;
    seen.add(e.id);
    out.push(toRecord(e, timeZone));
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/* --------------------------------------------------------------- periods */

export type RangeId = "today" | "7d" | "30d" | "90d" | "all" | "custom";
export const RANGES: RangeId[] = ["today", "7d", "30d", "90d", "all", "custom"];
export interface Bounds {
  from: string;
  to: string;
  days: number;
}

export function rangeBounds(
  range: RangeId,
  today: string,
  records: StatRecord[],
  custom?: { from?: string | undefined; to?: string | undefined },
): Bounds | null {
  const span = (n: number) => ({ from: addDays(today, -(n - 1)), to: today, days: n });
  switch (range) {
    case "today":
      return span(1);
    case "7d":
      return span(7);
    case "30d":
      return span(30);
    case "90d":
      return span(90);
    case "custom": {
      let from = isDayKey(custom?.from) ? custom!.from! : today;
      let to = isDayKey(custom?.to) ? custom!.to! : today;
      if (from > to) [from, to] = [to, from];
      return { from, to, days: daysBetween(from, to) + 1 };
    }
    case "all": {
      if (!records.length) return null;
      let first = records[0]!.day;
      for (const r of records) if (r.day < first) first = r.day;
      const to = today > first ? today : first;
      return { from: first, to, days: daysBetween(first, to) + 1 };
    }
  }
}

/** The equally long period right before; "all" has nothing to compare with. */
export function previousBounds(range: RangeId, b: Bounds | null): Bounds | null {
  if (!b || range === "all") return null;
  return { from: addDays(b.from, -b.days), to: addDays(b.from, -1), days: b.days };
}

export const inBounds = (r: StatRecord, b: Bounds | null) =>
  !!b && r.day >= b.from && r.day <= b.to;

/* --------------------------------------------------------------- filters */

export interface Filters {
  pair?: string | undefined;
  /** Either side of the pair. */
  lang?: string | undefined;
  kind?: string | undefined;
  domain?: string | undefined;
  intent?: string | undefined;
  register?: string | undefined;
}
export const FILTER_KEYS = ["pair", "lang", "kind", "domain", "intent", "register"] as const;

export function matches(r: StatRecord, f: Filters): boolean {
  if (f.pair && r.pair !== f.pair) return false;
  if (f.lang && r.source !== f.lang && r.target !== f.lang) return false;
  if (f.kind && r.kind !== f.kind) return false;
  if (f.domain && r.domain !== f.domain) return false;
  if (f.intent && r.intent !== f.intent) return false;
  if (f.register && r.register !== f.register) return false;
  return true;
}

export function select(records: StatRecord[], b: Bounds | null, f: Filters): StatRecord[] {
  return records.filter((r) => inBounds(r, b) && matches(r, f));
}

/* ------------------------------------------------------------- summaries */

export interface Summary {
  translations: number;
  words: number;
  pairs: number;
  topPair: { pair: string; count: number } | null;
  activeDays: number;
  /** Mean source words per translation; null when there is nothing to divide. */
  avgWords: number | null;
  legacy: number;
}

export function summarize(records: StatRecord[]): Summary {
  const pairs = new Map<string, number>();
  const days = new Set<string>();
  let words = 0;
  let legacy = 0;
  for (const r of records) {
    words += r.words;
    days.add(r.day);
    pairs.set(r.pair, (pairs.get(r.pair) ?? 0) + 1);
    if (r.legacy) legacy++;
  }
  let topPair: Summary["topPair"] = null;
  for (const [pair, count] of pairs)
    if (!topPair || count > topPair.count || (count === topPair.count && pair < topPair.pair))
      topPair = { pair, count };
  return {
    translations: records.length,
    words,
    pairs: pairs.size,
    topPair,
    activeDays: days.size,
    avgWords: records.length ? words / records.length : null,
    legacy,
  };
}

/** Relative change; null when the earlier value is 0 (no honest percentage exists). */
export function change(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return (current - previous) / previous;
}

export const share = (part: number, total: number) => (total > 0 ? part / total : 0);

export interface Slice {
  id: string;
  count: number;
  words: number;
  share: number;
}

export function distribution(
  records: StatRecord[],
  key: Dimension | "pair",
  all?: readonly string[],
): Slice[] {
  return memoArray(records, `distribution:${key}:${all ? all.join("|") : ""}`, () => {
    const m = new Map<string, { count: number; words: number }>();
    for (const id of all ?? []) m.set(id, { count: 0, words: 0 });
    for (const r of records) {
      const id = r[key];
      const s = m.get(id) ?? { count: 0, words: 0 };
      s.count++;
      s.words += r.words;
      m.set(id, s);
    }
    return [...m.entries()]
      .map(([id, s]) => ({ id, ...s, share: share(s.count, records.length) }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  });
}

/** Top N slices, the rest folded into one "others" slice so a chart never becomes a crowded wheel. */
export function topWithOthers(slices: Slice[], n: number): { top: Slice[]; others: Slice | null } {
  if (slices.length <= n) return { top: slices, others: null };
  const top = slices.slice(0, n - 1);
  const rest = slices.slice(n - 1);
  const count = rest.reduce((a, s) => a + s.count, 0);
  const words = rest.reduce((a, s) => a + s.words, 0);
  const total = slices.reduce((a, s) => a + s.count, 0);
  return { top, others: { id: "__others", count, words, share: share(count, total) } };
}

/* -------------------------------------------------------------- timeline */

export type Granularity = "day" | "week" | "month";
export function granularityFor(days: number): Granularity {
  if (days <= 31) return "day";
  if (days <= 182) return "week";
  return "month";
}
export const bucketOf = (day: string, g: Granularity) =>
  g === "day" ? day : g === "week" ? weekKey(day) : monthKey(day);

export interface Bucket {
  key: string;
  /** First and last calendar day this bucket covers inside the period. */
  from: string;
  to: string;
  translations: number;
  words: number;
}

/** Zero-filled buckets across the whole period, so empty days are visible as empty. */
export function timeline(records: StatRecord[], b: Bounds | null, g?: Granularity): Bucket[] {
  if (!b) return [];
  const gran = g ?? granularityFor(b.days);
  const out = new Map<string, Bucket>();
  for (let d = b.from; d <= b.to; d = addDays(d, 1)) {
    const k = bucketOf(d, gran);
    const bk = out.get(k);
    if (bk) bk.to = d;
    else out.set(k, { key: k, from: d, to: d, translations: 0, words: 0 });
  }
  for (const r of records) {
    if (r.day < b.from || r.day > b.to) continue;
    const bk = out.get(bucketOf(r.day, gran));
    if (!bk) continue;
    bk.translations++;
    bk.words += r.words;
  }
  return [...out.values()];
}

/* -------------------------------------------------------------- patterns */

export type Insight =
  | { type: "topDomain"; domain: string; count: number; total: number }
  | { type: "topPair"; pair: string; count: number; total: number }
  | { type: "topKind"; kind: string; count: number; total: number }
  | { type: "repeated"; items: { text: string; times: number }[] }
  | { type: "intentShift"; intent: string; before: number; after: number }
  | { type: "estimated"; count: number; total: number };

/** Minimum translations before any pattern is described; below it we say so instead. */
export const INSIGHT_MIN = 5;

/**
 * Descriptive patterns only — what the numbers show, never a judgement about the
 * person or their language level. Each rule has its own evidence threshold.
 */
export function insights(records: StatRecord[], b: Bounds | null): Insight[] {
  const total = records.length;
  if (total < INSIGHT_MIN) return [];
  const out: Insight[] = [];

  // The three distributions are shared with the route's panels (memoised per array), so
  // insights costs one extra pass over the archive, not one per pattern.
  const doms = distribution(records, "domain").filter((s) => s.id !== "none");
  if (
    doms[0] &&
    doms[0].count >= 3 &&
    doms[0].share >= 0.3 &&
    doms[0].count > (doms[1]?.count ?? 0)
  )
    out.push({ type: "topDomain", domain: doms[0].id, count: doms[0].count, total });

  const pairs = distribution(records, "pair");
  if (pairs.length > 1 && pairs[0]!.count > pairs[1]!.count)
    out.push({ type: "topPair", pair: pairs[0]!.id, count: pairs[0]!.count, total });

  const kinds = distribution(records, "kind");
  if (kinds[0] && kinds[0].share >= 0.4 && kinds[0].count > (kinds[1]?.count ?? 0))
    out.push({ type: "topKind", kind: kinds[0].id, count: kinds[0].count, total });

  // The remaining patterns share one pass: repeated source texts, the estimated share and
  // the two intent halves. Splitting them into separate filters walked the archive once per
  // pattern on every filter/period change.
  const rep = new Map<string, { text: string; times: number }>();
  const split = b && b.days >= 2 ? addDays(b.from, Math.floor(b.days / 2) - 1) : null;
  const firstCounts = new Map<string, number>();
  const secondCounts = new Map<string, number>();
  const firstOrder: string[] = [];
  const secondOrder: string[] = [];
  let firstTotal = 0;
  let secondTotal = 0;
  let estimated = 0;
  for (const r of records) {
    const k = r.original.trim().toLowerCase().replace(/\s+/g, " ");
    const cur = rep.get(k) ?? { text: r.original.trim(), times: 0 };
    cur.times += r.uses;
    rep.set(k, cur);

    if (r.origin.domain === "local") estimated++;

    if (split !== null && r.intent !== "none") {
      if (r.day <= split) {
        firstTotal++;
        if (!firstCounts.has(r.intent)) firstOrder.push(r.intent);
        firstCounts.set(r.intent, (firstCounts.get(r.intent) ?? 0) + 1);
      } else {
        secondTotal++;
        if (!secondCounts.has(r.intent)) secondOrder.push(r.intent);
        secondCounts.set(r.intent, (secondCounts.get(r.intent) ?? 0) + 1);
      }
    }
  }
  const repeated = [...rep.values()]
    .filter((x) => x.times >= 2)
    .sort((a, c) => c.times - a.times)
    .slice(0, 3);
  if (repeated.length) out.push({ type: "repeated", items: repeated });

  // Intent shift between the first and second half of the period (both halves need evidence).
  if (firstTotal >= INSIGHT_MIN && secondTotal >= INSIGHT_MIN) {
    let best: Insight | null = null;
    let bestDelta = 0;
    const ids = new Set([...firstOrder, ...secondOrder]);
    for (const id of ids) {
      const before = share(firstCounts.get(id) ?? 0, firstTotal);
      const after = share(secondCounts.get(id) ?? 0, secondTotal);
      if (Math.abs(after - before) >= 0.15 && Math.abs(after - before) > bestDelta) {
        bestDelta = Math.abs(after - before);
        best = { type: "intentShift", intent: id, before, after };
      }
    }
    if (best) out.push(best);
  }

  if (estimated) out.push({ type: "estimated", count: estimated, total });
  return out;
}

/* ---------------------------------------------------------------- sorting */

export type SortId = "newest" | "oldest" | "uses";
export function sortRecords(records: StatRecord[], sort: SortId): StatRecord[] {
  const list = [...records];
  if (sort === "oldest") return list.sort((a, b) => a.createdAt - b.createdAt);
  if (sort === "uses") return list.sort((a, b) => b.uses - a.uses || b.createdAt - a.createdAt);
  return list.sort((a, b) => b.createdAt - a.createdAt);
}
