/**
 * Culture discovery (Phase II): what to show when a person is not searching for something
 * specific.
 *
 * The rules here are deterministic and self-contained, because "today's item" must be the
 * same item all day on a device and a feed must not reshuffle while someone scrolls:
 * - `featuredForDay` is a pure function of the local day key (`YYYY-MM-DD`, the
 *   `useTodayKey()` format) and the index, never of `Date.now()` in render. A continent
 *   is picked with equal probability, so a Europe-heavy corpus does not dominate the
 *   featured slot, and a record is never featured two days in a row.
 * - the mixed feed rotates continents so no single continent (Europe in particular) fills
 *   a page, and its adjacency rule is hard: the same category or a shared country never
 *   appears twice in a row unless the remaining records make that impossible.
 * - pagination is a cursor over that stable order (the last seen id) rather than an offset,
 *   so a filtered list cannot duplicate or skip a record when a page is retried.
 * - related records are derived from metadata only (shared country, category, tags, or an
 *   explicitly declared relationship); there is no "similar" content generation.
 * - random discovery excludes the recently seen history and the current session's already
 *   served ids, and picks uniformly across continents before weighting by editorial weight.
 *
 * The index array coming from the loader is stable for a data version, so selections are
 * cached per source array in a bounded map (8 entries, LRU) to make page 2+ cheap.
 */
import { rankCultureEntries, searchCulture } from "./search";
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

const EUROPE: CultureContinent = "europe";
/** Delays European records relative to other continents inside their rotation round. */
const EUROPE_FEED_PENALTY = 0.18;
/** How much the editorial weight may pull a record earlier inside its bucket (~1/4 of hash). */
const WEIGHT_FEED_BONUS = 0.25;
const ORDER_CACHE_LIMIT = 8;
const CONTINENT_ORDER: readonly CultureContinent[] = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];

/* ---------------------------------------------------------------- deterministic bits */

/** FNV-1a over UTF-16 code units: stable across runs and platforms (no Math.random state). */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unitHash(value: string): number {
  return hashString(value) / 0x1_0000_0000;
}

/** Small deterministic PRNG (mulberry32); the seed is always a day key or a dataset hash. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → days since the Unix epoch, or `null` when the key is malformed. */
function dayNumber(dayKey: string): number | null {
  const match = DAY_KEY.exec(dayKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const time = Date.UTC(year, month - 1, day);
  return Number.isFinite(time) ? Math.floor(time / 86_400_000) : null;
}

function dayKeyOf(number: number): string {
  const date = new Date(number * 86_400_000);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const byId = (a: CultureIndexEntry, b: CultureIndexEntry): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/* -------------------------------------------------------------------- featured item */

function pickFeatured(
  entries: readonly CultureIndexEntry[],
  seed: string,
  excludedId?: string,
): CultureIndexEntry | null {
  if (entries.length === 0) return null;
  const pool = excludedId ? entries.filter((entry) => entry.id !== excludedId) : entries;
  if (pool.length === 0) return entries[0] ?? null;
  const random = mulberry32(hashString(`${seed}|featured`));
  const continents = [...new Set(pool.map((entry) => entry.continent))].sort();
  const continentIndex = Math.min(continents.length - 1, Math.floor(random() * continents.length));
  const continent = continents[continentIndex] ?? continents[0];
  const inContinent = pool.filter((entry) => entry.continent === continent).sort(byId);
  const weighted = inContinent.length ? inContinent : [...pool].sort(byId);
  const total = weighted.reduce((sum, entry) => sum + 0.1 + entry.weight, 0);
  let roll = random() * total;
  for (const entry of weighted) {
    roll -= 0.1 + entry.weight;
    if (roll <= 0) return entry;
  }
  return weighted[weighted.length - 1] ?? null;
}

/**
 * Today's featured record — a pure function of `dayKey` and the index.
 * `dayKey` is the `useTodayKey()` format; a malformed key still yields a stable record
 * (it is only used as seed material) but skips the "not yesterday's record" adjustment.
 */
export function featuredForDay(
  entries: readonly CultureIndexEntry[],
  dayKey: string,
): CultureIndexEntry | null {
  if (entries.length === 0) return null;
  const current = pickFeatured(entries, dayKey);
  if (!current) return null;
  const day = dayNumber(dayKey);
  if (day === null) return current;
  const previous = pickFeatured(entries, dayKeyOf(day - 1));
  if (previous && previous.id === current.id) {
    // A one-item index cannot rotate; only a real alternative replaces the repeat.
    return pickFeatured(entries, dayKey, current.id) ?? current;
  }
  return current;
}

/* ---------------------------------------------------------------------- mixed feed */

/** Folded title identity: a museum catalog holds many objects with the same generic name. */
function titleKey(entry: CultureIndexEntry): string {
  return entry.title.en
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function canFollow(
  previous: CultureIndexEntry,
  candidate: CultureIndexEntry,
  recentTitles: readonly string[],
): boolean {
  // The same object name four rows apart reads as a duplicated card even when the records
  // are genuinely different objects; defer it instead of repeating the composition.
  if (recentTitles.includes(titleKey(candidate))) return false;
  if (previous.category === candidate.category) return false;
  if (previous.countries.length === 0 || candidate.countries.length === 0) return true;
  const previousCountries = new Set(previous.countries);
  return !candidate.countries.some((country) => previousCountries.has(country));
}

interface BucketState {
  queue: CultureIndexEntry[];
  deferred: CultureIndexEntry[];
}

/**
 * The whole feed order in one deterministic pass: continents take turns (Europe does not
 * get a slot of its own beyond its share), and a candidate that would repeat the previous
 * record's category or country is deferred, not dropped. The return value is stable for
 * the same input array.
 */
export function mixedFeedOrder(
  entries: readonly CultureIndexEntry[],
): readonly CultureIndexEntry[] {
  if (entries.length <= 1) return entries;
  const first = entries[0];
  const last = entries[entries.length - 1];
  const fingerprint = `${String(entries.length)}:${first?.id ?? ""}:${last?.id ?? ""}`;
  const buckets = new Map<CultureContinent, BucketState>();
  for (const continent of CONTINENT_ORDER) buckets.set(continent, { queue: [], deferred: [] });
  for (const entry of entries) buckets.get(entry.continent)?.queue.push(entry);
  const priority = (entry: CultureIndexEntry): number =>
    unitHash(`${entry.id}\u0000feed`) -
    (entry.continent === EUROPE ? EUROPE_FEED_PENALTY : 0) -
    entry.weight * WEIGHT_FEED_BONUS;
  for (const bucket of buckets.values()) {
    bucket.queue.sort((a, b) => priority(a) - priority(b) || byId(a, b));
  }
  const present = CONTINENT_ORDER.filter(
    (continent) => (buckets.get(continent)?.queue.length ?? 0) > 0,
  );
  const rotation = present.length ? hashString(fingerprint) % present.length : 0;
  const order = [...present.slice(rotation), ...present.slice(0, rotation)];
  const result: CultureIndexEntry[] = [];
  const recentTitles: string[] = [];
  let previous: CultureIndexEntry | null = null;
  /**
   * Which continent gets first refusal on this pick. A fixed starting point would starve
   * every continent after the first (they only feed the tail once it is empty) and turn a
   * country-heavy corpus into one clustered block at the end; a moving start interleaves
   * all buckets in proportion to their size instead.
   */
  let turn = 0;
  const bucketAt = (step: number): BucketState | undefined => {
    const continent = order[(turn + step) % order.length];
    return continent === undefined ? undefined : buckets.get(continent);
  };
  while (result.length < entries.length) {
    let picked: CultureIndexEntry | null = null;
    let takenAfter = -1;
    for (let step = 0; step < order.length; step += 1) {
      const bucket = bucketAt(step);
      if (!bucket) continue;
      // Deferred records were blocked by the previous item, which has changed since.
      for (let i = 0; i < bucket.deferred.length; i += 1) {
        const candidate = bucket.deferred[i];
        if (candidate && (!previous || canFollow(previous, candidate, recentTitles))) {
          bucket.deferred.splice(i, 1);
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
        if (!previous || canFollow(previous, candidate, recentTitles)) {
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
      // The remaining records cannot follow the previous one (for example one category
      // only). Preserve every id exactly once, but still try to avoid repeating a recent
      // object name: only when no candidate clears that bar do we accept the break.
      const take = (allowRecentTitle: boolean): CultureIndexEntry | null => {
        for (let step = 0; step < order.length; step += 1) {
          const bucket = bucketAt(step);
          if (!bucket) continue;
          for (const deferred of [true, false]) {
            const list = deferred ? bucket.deferred : bucket.queue;
            const index = list.findIndex(
              (entry) => allowRecentTitle || !recentTitles.includes(titleKey(entry)),
            );
            if (index >= 0) return list.splice(index, 1)[0] ?? null;
          }
        }
        return null;
      };
      picked = take(false) ?? take(true);
      if (!picked) break;
      takenAfter = 0;
    }
    result.push(picked);
    previous = picked;
    turn = (turn + takenAfter + 1) % Math.max(1, order.length);
    // Four rows is the window in which a repeated object name reads as a duplicate.
    recentTitles.push(titleKey(picked));
    if (recentTitles.length > 4) recentTitles.shift();
  }
  return repairFeedOrder(result);
}

/* ------------------------------------------------------------------- browse / pages */

export interface CultureBrowseOptions {
  /** Ids of saved records, required when `filters.savedOnly` is true. */
  savedIds?: Iterable<string> | undefined;
  /** Subject lookup for search results, when detail bodies are already loaded. */
  subjects?: ((id: string) => string | undefined) | undefined;
}

const selectionCache = new WeakMap<
  readonly CultureIndexEntry[],
  Map<string, readonly CultureIndexEntry[]>
>();

function clampFeedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return FEED_DEFAULT_LIMIT;
  return Math.min(FEED_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function selectionSignature(
  filters: CultureFilters,
  savedSet: ReadonlySet<string>,
  options: CultureBrowseOptions,
): string {
  const saved =
    filters.savedOnly === true ? [...savedSet].sort().join(",") + `:${String(savedSet.size)}` : "-";
  const country = filters.country?.toUpperCase() ?? "";
  const search = filters.search?.trim().toLowerCase() ?? "";
  // The subject lookup changes a search ranking but is not part of the filter text; a
  // boolean marker keeps the order cache honest once detail bodies are available.
  const subjects = options.subjects ? "subjects" : "-";
  return [filters.category ?? "", filters.continent ?? "", country, saved, search, subjects].join(
    "|",
  );
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
      (country === undefined || entry.countries.includes(country)) &&
      (filters.savedOnly !== true || savedSet.has(entry.id)),
  );
}

function selectionFor(
  entries: readonly CultureIndexEntry[],
  filters: CultureFilters,
  options: CultureBrowseOptions,
): readonly CultureIndexEntry[] {
  const savedSet = new Set(options.savedIds ?? []);
  const signature = selectionSignature(filters, savedSet, options);
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
  const selection = search
    ? rankCultureEntries(filtered, search, { subjects: options.subjects }).map((hit) => hit.entry)
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
 * retrying or re-rendering a page cannot duplicate a record. Reaching a cursor that is no
 * longer in the current selection (data version changed, or a different filter) starts
 * again from the first page rather than returning a torn list.
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
  const lastItem = items[items.length - 1];
  const more = start + items.length < total;
  return more && lastItem ? { items, nextCursor: lastItem.id, total } : { items, total };
}

/** Filter ids first (saved-only needs the caller's saved list); search ranking lives above. */
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
  /** Genuine declared relationships from a loaded `CultureItem.related`; never invented. */
  declared?: readonly string[] | undefined;
}

/**
 * Related records from metadata only: declared relationships first, then shared country,
 * then category, then tags, then continent. Deterministic ordering; self is never returned.
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
    if (candidate.continent === target.continent) score += 1;
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

export interface CultureRandomOptions {
  /** Recently seen ids; excluded when an alternative exists. */
  seen?: Iterable<string> | undefined;
  /** Ids already served in this session, so a "surprise me" tap never repeats. */
  exclude?: Iterable<string> | undefined;
  /** Injectable source of randomness in [0, 1); defaults to `Math.random`. */
  random?: (() => number) | undefined;
}

const clampRandom = (value: number): number =>
  Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;

/**
 * One random record that is not in the recent-seen history and not in the caller's
 * exclude set. Continents are picked uniformly first, so the result is not a random draw
 * from a Europe-heavy pool. When every record has been seen, the seen filter is relaxed
 * (the exclude set still holds); when even that pool is empty the function returns `null`.
 */
export function randomCultureEntry(
  entries: readonly CultureIndexEntry[],
  options: CultureRandomOptions = {},
): CultureIndexEntry | null {
  if (entries.length === 0) return null;
  const seen = new Set(options.seen ?? []);
  const exclude = new Set(options.exclude ?? []);
  const random = options.random ?? Math.random;
  const unseen = entries.filter((entry) => !exclude.has(entry.id) && !seen.has(entry.id));
  const pool = unseen.length ? unseen : entries.filter((entry) => !exclude.has(entry.id));
  if (pool.length === 0) return null;
  const continents = [...new Set(pool.map((entry) => entry.continent))].sort();
  const continent = continents[Math.floor(clampRandom(random()) * continents.length)];
  const inContinent = pool.filter((entry) => entry.continent === continent);
  const weighted = inContinent.length ? inContinent : pool;
  const total = weighted.reduce((sum, entry) => sum + 0.1 + entry.weight, 0);
  let roll = clampRandom(random()) * total;
  for (const entry of weighted) {
    roll -= 0.1 + entry.weight;
    if (roll <= 0) return entry;
  }
  return weighted[weighted.length - 1] ?? null;
}

/** Search used by the UI over the compact index; kept here so importers of discovery need one file. */
export { searchCulture };
export type { CultureFilters, CultureCategory };

/**
 * Local repair for the tail the greedy pass cannot interleave (for example a museum catalog
 * whose last remaining rows all carry the same generic name). A swap is accepted only when it
 * strictly reduces the number of adjacent repeated titles and does not increase the number of
 * category/country adjacency breaks, so the hard filter promise is never traded away. Every id
 * stays exactly once, and the result is deterministic: positions are repaired from the tail
 * (where the greedy pass starves first) and partners are scanned in index order.
 */
function repairFeedOrder(order: readonly CultureIndexEntry[]): readonly CultureIndexEntry[] {
  type Mode = "title" | "adjacency";
  const result = [...order];
  const keys = result.map((entry) => titleKey(entry));
  const length = result.length;
  const titleRepeatsAt = (pair: number): number =>
    pair >= 0 && pair + 1 < length && keys[pair] === keys[pair + 1] ? 1 : 0;
  const adjacencyBreaksAt = (pair: number): number => {
    if (pair < 0 || pair + 1 >= length) return 0;
    const before = result[pair];
    const after = result[pair + 1];
    if (!before || !after) return 0;
    return canFollow(before, after, []) ? 0 : 1;
  };
  const scoreAround = (pairs: readonly number[]) => ({
    title: pairs.reduce((sum, pair) => sum + titleRepeatsAt(pair), 0),
    breaks: pairs.reduce((sum, pair) => sum + adjacencyBreaksAt(pair), 0),
  });
  const affected = (position: number): number[] => [position - 1, position, position + 1];
  const trySwap = (position: number, partner: number, mode: Mode): boolean => {
    if (partner === position || Math.abs(partner - position) === 1) return false;
    if (keys[position] === keys[partner]) return false;
    const pairs = [...new Set([...affected(position), ...affected(partner)])];
    const before = scoreAround(pairs);
    const current = result[position];
    const candidate = result[partner];
    if (!current || !candidate) return false;
    result[position] = candidate;
    result[partner] = current;
    keys[position] = titleKey(candidate);
    keys[partner] = titleKey(current);
    const after = scoreAround(pairs);
    // A swap is only kept when it strictly improves the defect under repair and never
    // worsens the other property; this is what keeps the two promises from fighting.
    const accepted =
      mode === "title"
        ? after.title < before.title && after.breaks <= before.breaks
        : after.breaks < before.breaks && after.title <= before.title;
    if (accepted) return true;
    result[position] = current;
    result[partner] = candidate;
    keys[position] = titleKey(current);
    keys[partner] = titleKey(candidate);
    return false;
  };
  const repairPhase = (mode: Mode): void => {
    const defectAt = mode === "title" ? titleRepeatsAt : adjacencyBreaksAt;
    for (let pass = 0; pass < length; pass += 1) {
      let improved = false;
      for (let position = length - 2; position >= 0; position -= 1) {
        if (defectAt(position) === 0) continue;
        for (let partner = 0; partner < length; partner += 1) {
          if (trySwap(position, partner, mode)) {
            improved = true;
            break;
          }
        }
      }
      if (!improved) break;
    }
  };
  // Titles first (the visible duplicate-card defect), then the remaining hard diversity
  // breaks; the second phase may not reintroduce a title repeat.
  repairPhase("title");
  repairPhase("adjacency");
  return result;
}
