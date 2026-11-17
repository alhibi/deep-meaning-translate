/**
 * Culture discovery (schema v2, text-first): what to show when a person is not searching
 * for something specific.
 *
 * The rules are deterministic and self-contained, because "today's article" must be the
 * same article all day on a device and a feed must not reshuffle while someone scrolls:
 * - featuredForDay is a pure function of the local day key (YYYY-MM-DD, the useTodayKey()
 *   format) and the index, never of Date.now() in render. The day rotates through the
 *   continents that are actually present, so a Europe-heavy corpus does not dominate the
 *   featured slot, and yesterday's article is never featured twice in a row.
 * - the mixed feed takes turns between continents and defers a record whose continent,
 *   category or country repeats the previous one instead of dropping it: every id appears
 *   exactly once, and an adjacency break only survives when the remaining records make it
 *   impossible.
 * - pagination is a cursor over that stable order (the last seen id) rather than an offset,
 *   so a filtered list cannot duplicate or skip a record when a page is retried.
 * - related records are derived from metadata only (declared relationships, shared
 *   country, category or tags); there is no generated "similar" content.
 * - random discovery excludes the recently seen history and the caller's exclude set.
 *
 * Selections are cached per index array and per filter signature in a bounded map (8
 * entries, LRU by use), so page 2+ does not recompute the whole order.
 */
import { peekCultureIndex } from "./loader";
import { rankCultureEntries } from "./search";
import type {
  CultureCategory,
  CultureContinent,
  CultureFilters,
  CultureIndexEntry,
  CulturePage,
} from "./types";

export const FEED_DEFAULT_LIMIT = 24;
export const FEED_MAX_LIMIT = 60;
export const RELATED_DEFAULT_LIMIT = 6;
export const RELATED_MAX_LIMIT = 12;

/** Canonical continent order used by the feed rotation and the facet builder. */
export const CONTINENT_ORDER: readonly CultureContinent[] = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];

/** How much the editorial weight may pull a record earlier inside its continent bucket. */
const WEIGHT_FEED_BONUS = 0.25;
const ORDER_CACHE_LIMIT = 8;

/* ---------------------------------------------------------------- deterministic bits */

/** FNV-1a over UTF-16 code units: stable across runs and platforms (no Math.random state). */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unitHash(value: string): number {
  return hashString(value) / 0x1_0000_0000;
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD -> days since the Unix epoch, or null when the key is malformed. */
function dayNumber(dayKey: string): number | null {
  const match = DAY_KEY.exec(dayKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const time = Date.UTC(year, month - 1, day);
  return Number.isFinite(time) ? Math.floor(time / 86_400_000) : null;
}

const byId = (a: CultureIndexEntry, b: CultureIndexEntry): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function continentsPresent(entries: readonly CultureIndexEntry[]): CultureContinent[] {
  return CONTINENT_ORDER.filter((continent) =>
    entries.some((entry) => entry.continent === continent),
  );
}

/* -------------------------------------------------------------------- featured article */

function poolForContinent(
  entries: readonly CultureIndexEntry[],
  continent: CultureContinent | undefined,
): CultureIndexEntry[] {
  const inContinent =
    continent === undefined
      ? []
      : entries.filter((entry) => entry.continent === continent).sort(byId);
  return inContinent.length > 0 ? inContinent : [...entries].sort(byId);
}

/**
 * Today's featured article -- a pure function of dayKey and the index.
 *
 * The day number rotates the continent, and the round (how many rotations have passed)
 * advances one article inside that continent's id-ordered pool. That construction makes
 * two promises hold by arithmetic rather than by remembering yesterday:
 * - the continent changes every day as long as more than one is present;
 * - when only one continent is present, the article index advances by one, so a library
 *   with two or more articles never features the same article two days in a row.
 * A malformed day key has no day arithmetic; it still yields a stable article (the key is
 * only seed material) chosen from the present continents by hash.
 */
export function featuredForDay(
  entries: readonly CultureIndexEntry[],
  dayKey: string,
): CultureIndexEntry | null {
  if (entries.length === 0) return null;
  const present = continentsPresent(entries);
  if (present.length === 0) return null;
  const day = dayNumber(dayKey);
  if (day === null) {
    const seed = hashString("featured|" + dayKey);
    const continent = present[seed % present.length];
    const pool = poolForContinent(entries, continent);
    return pool[(seed >>> 7) % pool.length] ?? null;
  }
  const cycle = present.length;
  const continent = present[((day % cycle) + cycle) % cycle];
  const pool = poolForContinent(entries, continent);
  const round = Math.floor(day / cycle);
  const index = ((round % pool.length) + pool.length) % pool.length;
  return pool[index] ?? null;
}

/* ---------------------------------------------------------------------- mixed feed */

/**
 * The three hard adjacency rules of the feed. Countries only conflict when both records
 * state one -- a record about a borderless community is not "the same country" as another.
 */
function pairConflicts(a: CultureIndexEntry, b: CultureIndexEntry): boolean {
  if (a.continent === b.continent) return true;
  if (a.category === b.category) return true;
  if (a.countries.length === 0 || b.countries.length === 0) return false;
  const countries = new Set(a.countries);
  return b.countries.some((country) => countries.has(country));
}

/** How many hard rules a candidate breaks against the previous record (0 = fits). */
function conflictScore(previous: CultureIndexEntry | null, candidate: CultureIndexEntry): number {
  if (!previous) return 0;
  let score = 0;
  if (candidate.continent === previous.continent) score += 1;
  if (candidate.category === previous.category) score += 1;
  if (candidate.countries.length > 0 && previous.countries.length > 0) {
    const countries = new Set(previous.countries);
    if (candidate.countries.some((country) => countries.has(country))) score += 1;
  }
  return score;
}

interface BucketState {
  queue: CultureIndexEntry[];
  deferred: CultureIndexEntry[];
}

function takeLeastConflicting(
  previous: CultureIndexEntry,
  buckets: ReadonlyMap<CultureContinent, BucketState>,
  rotation: readonly CultureContinent[],
  turn: number,
): CultureIndexEntry | null {
  let best: { bucket: BucketState; list: CultureIndexEntry[]; index: number } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let step = 0; step < rotation.length; step += 1) {
    const continent = rotation[(turn + step) % rotation.length];
    const bucket = continent === undefined ? undefined : buckets.get(continent);
    if (!bucket) continue;
    const lists = [bucket.deferred, bucket.queue];
    for (const list of lists) {
      for (let index = 0; index < list.length; index += 1) {
        const candidate = list[index];
        if (!candidate) continue;
        const score = conflictScore(previous, candidate);
        if (score < bestScore) {
          bestScore = score;
          best = { bucket, list, index };
          if (score === 0) break;
        }
      }
      if (bestScore === 0) break;
    }
    if (bestScore === 0) break;
  }
  if (!best) return null;
  return best.list.splice(best.index, 1)[0] ?? null;
}

/**
 * Local repair for the tail a greedy pass cannot interleave (for example the last records
 * all share one category). A swap is accepted only when it strictly reduces the number of
 * hard adjacency breaks in the touched window; every id stays exactly once and the result
 * stays deterministic. Bounded passes keep a large library cheap.
 */
function repairFeedOrder(order: readonly CultureIndexEntry[]): readonly CultureIndexEntry[] {
  const result = [...order];
  const length = result.length;
  if (length < 3) return result;
  const conflictAt = (pair: number): number => {
    const before = result[pair];
    const after = result[pair + 1];
    return before && after && pairConflicts(before, after) ? 1 : 0;
  };
  const windowConflicts = (from: number, to: number): number => {
    let count = 0;
    const start = Math.max(0, from);
    const end = Math.min(length - 1, to);
    for (let pair = start; pair < end; pair += 1) count += conflictAt(pair);
    return count;
  };
  const trySwap = (left: number, right: number): boolean => {
    if (left === right || Math.abs(left - right) <= 1) return false;
    const from = Math.min(left, right) - 1;
    const to = Math.max(left, right) + 1;
    const before = windowConflicts(from, to);
    if (before === 0) return false;
    const first = result[left];
    const second = result[right];
    if (!first || !second) return false;
    result[left] = second;
    result[right] = first;
    const after = windowConflicts(from, to);
    if (after < before) return true;
    result[left] = first;
    result[right] = second;
    return false;
  };
  const passes = 4;
  for (let pass = 0; pass < passes; pass += 1) {
    let improved = false;
    for (let pair = 0; pair < length - 1; pair += 1) {
      if (conflictAt(pair) === 0) continue;
      let repaired = false;
      const near = Math.min(length, pair + 9);
      // Move the second member of the broken pair forward, then the first; moving one
      // record out of the run leaves the pair before it untouched in the first case.
      for (let next = pair + 2; next < near; next += 1) {
        if (trySwap(pair + 1, next)) {
          repaired = true;
          break;
        }
      }
      if (!repaired) {
        for (let next = pair + 2; next < near; next += 1) {
          if (trySwap(pair, next)) {
            repaired = true;
            break;
          }
        }
      }
      if (!repaired) {
        for (let previous = Math.max(0, pair - 8); previous < pair - 1; previous += 1) {
          if (trySwap(pair + 1, previous)) {
            repaired = true;
            break;
          }
        }
      }
      if (repaired) improved = true;
    }
    if (!improved) break;
  }
  return result;
}

/**
 * The whole feed order in one deterministic pass: continents take turns, and a record that
 * would repeat the previous one's continent, category or country is deferred, not dropped.
 * The return value is stable for the same input array and contains every entry exactly once.
 */
export function mixedFeedOrder(
  entries: readonly CultureIndexEntry[],
): readonly CultureIndexEntry[] {
  if (entries.length <= 1) return entries;
  const buckets = new Map<CultureContinent, BucketState>();
  for (const continent of CONTINENT_ORDER) buckets.set(continent, { queue: [], deferred: [] });
  for (const entry of entries) {
    const bucket = buckets.get(entry.continent);
    if (bucket) bucket.queue.push(entry);
  }
  const priorityOf = (entry: CultureIndexEntry): number =>
    unitHash(entry.id + "|feed") - entry.weight * WEIGHT_FEED_BONUS;
  for (const bucket of buckets.values()) {
    bucket.queue.sort((a, b) => priorityOf(a) - priorityOf(b) || byId(a, b));
  }
  const present = CONTINENT_ORDER.filter(
    (continent) => (buckets.get(continent)?.queue.length ?? 0) > 0,
  );
  if (present.length === 0) return [...entries];
  const fingerprint =
    String(entries.length) +
    ":" +
    (entries[0]?.id ?? "") +
    ":" +
    (entries[entries.length - 1]?.id ?? "");
  const rotationOffset = hashString(fingerprint) % present.length;
  const rotation = [...present.slice(rotationOffset), ...present.slice(0, rotationOffset)];
  const result: CultureIndexEntry[] = [];
  let previous: CultureIndexEntry | null = null;
  let turn = 0;
  while (result.length < entries.length) {
    let picked: CultureIndexEntry | null = null;
    let takenAfter = 0;
    for (let step = 0; step < rotation.length; step += 1) {
      const continent = rotation[(turn + step) % rotation.length];
      const bucket = continent === undefined ? undefined : buckets.get(continent);
      if (!bucket) continue;
      // Deferred records were blocked by the previous entry, which has changed since.
      for (let index = 0; index < bucket.deferred.length; index += 1) {
        const candidate = bucket.deferred[index];
        if (candidate && (previous === null || !pairConflicts(previous, candidate))) {
          bucket.deferred.splice(index, 1);
          picked = candidate;
          break;
        }
      }
      if (picked) {
        takenAfter = step;
        break;
      }
      while (bucket.queue.length > 0) {
        const candidate = bucket.queue.shift();
        if (!candidate) break;
        if (previous === null || !pairConflicts(previous, candidate)) {
          picked = candidate;
          break;
        }
        bucket.deferred.push(candidate);
      }
      if (picked) {
        takenAfter = step;
        break;
      }
    }
    if (!picked) {
      // The remaining records all conflict with the previous one: preserve every id
      // exactly once, choosing the least-conflicting candidate deterministically.
      picked = previous === null ? null : takeLeastConflicting(previous, buckets, rotation, turn);
    }
    if (!picked) break;
    result.push(picked);
    previous = picked;
    turn = (turn + takenAfter + 1) % rotation.length;
  }
  return repairFeedOrder(result);
}

/* ------------------------------------------------------------------- browse / pages */

export interface CultureBrowseOptions {
  /** Ids of saved records, required when filters.savedOnly is true. */
  savedIds?: Iterable<string> | undefined;
}

export interface CultureRandomOptions {
  /** Recently seen ids; excluded when an alternative exists. */
  seen?: Iterable<string> | undefined;
  /** Ids already served in this session, so a "surprise me" tap never repeats. */
  exclude?: Iterable<string> | undefined;
  /** Injectable source of randomness in [0, 1); defaults to Math.random. */
  random?: (() => number) | undefined;
  /** Entries to draw from when the function is called with only options. */
  entries?: readonly CultureIndexEntry[] | undefined;
}

function clampFeedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return FEED_DEFAULT_LIMIT;
  return Math.min(FEED_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function filterEntries(
  entries: readonly CultureIndexEntry[],
  filters: CultureFilters,
  savedSet: ReadonlySet<string>,
): CultureIndexEntry[] {
  const country = filters.country?.toUpperCase();
  return entries.filter(
    (entry) =>
      (filters.category === undefined || entry.category === filters.category) &&
      (filters.continent === undefined || entry.continent === filters.continent) &&
      (filters.contentType === undefined || entry.contentType === filters.contentType) &&
      (country === undefined || entry.countries.includes(country)) &&
      (filters.savedOnly !== true || savedSet.has(entry.id)),
  );
}

function selectionSignature(filters: CultureFilters, savedSet: ReadonlySet<string>): string {
  const saved = filters.savedOnly === true ? "saved:" + [...savedSet].sort().join(",") : "all";
  return [
    filters.category ?? "",
    filters.continent ?? "",
    filters.contentType ?? "",
    filters.country?.toUpperCase() ?? "",
    filters.search?.trim().toLowerCase() ?? "",
    saved,
  ].join("|");
}

const selectionCache = new WeakMap<
  readonly CultureIndexEntry[],
  Map<string, readonly CultureIndexEntry[]>
>();

function selectionFor(
  entries: readonly CultureIndexEntry[],
  filters: CultureFilters,
  options: CultureBrowseOptions,
): readonly CultureIndexEntry[] {
  const savedSet = new Set(options.savedIds ?? []);
  const signature = selectionSignature(filters, savedSet);
  let cache = selectionCache.get(entries);
  if (!cache) {
    cache = new Map();
    selectionCache.set(entries, cache);
  }
  const cached = cache.get(signature);
  if (cached) {
    // Refresh LRU order: the filter a person is paging through must not be evicted.
    cache.delete(signature);
    cache.set(signature, cached);
    return cached;
  }
  const filtered = filterEntries(entries, filters, savedSet);
  const search = filters.search?.trim() ?? "";
  // Search is a relevance list, not a browse feed: the ranking is the order. Browse is the
  // mixed feed, where the diversity rules above decide the order.
  const selection =
    search.length > 0
      ? rankCultureEntries(filtered, search).map((hit) => hit.entry)
      : mixedFeedOrder(filtered);
  cache.set(signature, selection);
  while (cache.size > ORDER_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  return selection;
}

/**
 * One page of the discovery feed (or of a filtered/search result).
 *
 * The cursor is the stable id of the last item on the previous page, never an offset, so
 * retrying or re-rendering a page cannot duplicate a record. A cursor that is no longer in
 * the current selection (data version changed, or a different filter) starts again from the
 * first page rather than returning a torn list.
 */
export function browseCulture(
  entries: readonly CultureIndexEntry[],
  filters: CultureFilters = {},
  options: CultureBrowseOptions = {},
): CulturePage {
  const limit = clampFeedLimit(filters.limit);
  const selection = selectionFor(entries, filters, options);
  const total = selection.length;
  let start = 0;
  if (filters.cursor) {
    const found = selection.findIndex((entry) => entry.id === filters.cursor);
    if (found >= 0) start = found + 1;
  }
  const items = selection.slice(start, start + limit);
  const last = items[items.length - 1];
  const more = start + items.length < total;
  return more && last ? { items, nextCursor: last.id, total } : { items, total };
}

/** Number of records the current filters/search would page through. */
export function countCultureEntries(
  entries: readonly CultureIndexEntry[],
  filters: CultureFilters = {},
  options: CultureBrowseOptions = {},
): number {
  return selectionFor(entries, filters, options).length;
}

/* ------------------------------------------------------------------ related records */

export interface CultureRelatedOptions {
  limit?: number | undefined;
  /** Genuine declared relationships from a loaded CultureArticle.related; never invented. */
  declared?: readonly string[] | undefined;
}

/**
 * Related records from metadata only: declared relationships first, then shared country,
 * category and tags. Deterministic ordering; the record itself is never returned.
 */
export function relatedCultureEntries(
  entries: readonly CultureIndexEntry[],
  id: string,
  options: CultureRelatedOptions = {},
): CultureIndexEntry[] {
  const target = entries.find((entry) => entry.id === id);
  if (!target) return [];
  const limit = Math.min(
    RELATED_MAX_LIMIT,
    Math.max(1, Math.floor(options.limit ?? RELATED_DEFAULT_LIMIT)),
  );
  const declared = new Set(options.declared ?? []);
  const targetCountries = new Set(target.countries);
  const targetTags = new Set(target.tags.map((tag) => tag.toLowerCase()));
  const scored: { entry: CultureIndexEntry; score: number }[] = [];
  for (const candidate of entries) {
    if (candidate.id === id) continue;
    let score = 0;
    if (declared.has(candidate.id)) score += 50;
    if (candidate.category === target.category) score += 6;
    score += candidate.countries.filter((country) => targetCountries.has(country)).length * 5;
    const sharedTags = candidate.tags.filter((tag) => targetTags.has(tag.toLowerCase())).length;
    score += Math.min(sharedTags, 3) * 3;
    if (score === 0) continue;
    scored.push({ entry: candidate, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || b.entry.weight - a.entry.weight || byId(a.entry, b.entry),
  );
  return scored.slice(0, limit).map((row) => row.entry);
}

/* ------------------------------------------------------------------- random discovery */

const clampRandom = (value: number): number =>
  Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;

/**
 * One random record that is not in the recent-seen history and not in the caller's exclude
 * set. Continents are picked uniformly first, so the result is not a random draw from a
 * Europe-heavy pool. When every record has been seen the seen filter is relaxed (the
 * exclude set still holds); when even that pool is empty the function returns null.
 *
 * The entries may be passed explicitly (the usual form) or read from the loaded compact
 * index when only options are given, so a caller that has already loaded the library does
 * not have to thread the array through.
 */
export function randomCultureEntry(
  entries: readonly CultureIndexEntry[],
  options?: CultureRandomOptions,
): CultureIndexEntry | null;
export function randomCultureEntry(options?: CultureRandomOptions): CultureIndexEntry | null;
export function randomCultureEntry(
  entriesOrOptions: readonly CultureIndexEntry[] | CultureRandomOptions = {},
  maybeOptions: CultureRandomOptions = {},
): CultureIndexEntry | null {
  const explicit = Array.isArray(entriesOrOptions);
  const options = explicit ? maybeOptions : (entriesOrOptions as CultureRandomOptions);
  const entries = explicit
    ? (entriesOrOptions as readonly CultureIndexEntry[])
    : (options.entries ?? peekCultureIndex() ?? []);
  if (entries.length === 0) return null;
  const seen = new Set(options.seen ?? []);
  const exclude = new Set(options.exclude ?? []);
  const random = options.random ?? Math.random;
  const unseen = entries.filter((entry) => !exclude.has(entry.id) && !seen.has(entry.id));
  const pool = unseen.length > 0 ? unseen : entries.filter((entry) => !exclude.has(entry.id));
  if (pool.length === 0) return null;
  const continents = [...new Set(pool.map((entry) => entry.continent))].sort();
  const continent = continents[Math.floor(clampRandom(random()) * continents.length)];
  const inContinent = pool.filter((entry) => entry.continent === continent);
  const weighted = inContinent.length > 0 ? inContinent : pool;
  const total = weighted.reduce((sum, entry) => sum + 0.1 + entry.weight, 0);
  let roll = clampRandom(random()) * total;
  for (const entry of weighted) {
    roll -= 0.1 + entry.weight;
    if (roll <= 0) return entry;
  }
  return weighted[weighted.length - 1] ?? null;
}

export type { CultureCategory };
