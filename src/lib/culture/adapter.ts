/**
 * The discovery data contract (UI <-> engine) and the production adapter.
 *
 * This module is the one definition of the shape the discovery UI consumes and the engine
 * produces: component code imports it downwards, and the adapter implements it here without
 * importing anything from src/components.
 *
 * Rules the adapter keeps:
 * - loadPage is cursor-based and returns the next cursor; it must never return the same
 *   cursor twice (the UI stops itself if it does, but that means lost content).
 * - The adapter object is stable for a section's lifetime. A new identity restarts the
 *   feed, exactly like a new query would.
 * - A list record is the shared compact index entry; the full text lives only in
 *   loadItem(), the one call that may load an article body (a per-record chunk).
 * - saved.ids() / saved.entries() are synchronous and device-local: the saved view opens
 *   with no network at all.
 * - Nothing here invents data: a page is exactly the entries the loader validated, the
 *   feature is the deterministic daily pick, related records come from declared links or
 *   genuine shared metadata.
 */
import {
  CULTURE_CATEGORIES,
  type CultureArticle,
  type CultureCategory,
  type CultureContentType,
  type CultureContinent,
  type CultureFilters,
  type CultureIndexEntry,
  type CultureLocale,
} from "./types";
import {
  browseCulture,
  CONTINENT_ORDER,
  FEED_DEFAULT_LIMIT,
  featuredForDay,
  relatedCultureEntries,
  RELATED_DEFAULT_LIMIT,
} from "./discovery";
import {
  CULTURE_CONTENT_TYPES,
  loadCultureIndex,
  loadCultureItem,
  peekCultureIndex,
  type CultureLoadStatus,
} from "./loader";
import { listSavedCultureIds, subscribeCultureSaved, toggleCultureSaved } from "./saved";

/** A compact list record: the shared validated index entry. */
export type CultureListEntry = CultureIndexEntry;

/** A full article for the reading surface. */
export type CultureDetailItem = CultureArticle;

/** One bounded page over the compact index. */
export interface CultureListPage {
  items: CultureListEntry[];
  /** Id of the last item; pass it back to read the next page. Absent on the last page. */
  nextCursor?: string | undefined;
  /** Number of records the active filters/search would page through. */
  total: number;
}

/** One bounded page request over the compact index. */
export interface CulturePageQuery {
  category?: CultureCategory | undefined;
  continent?: CultureContinent | undefined;
  country?: string | undefined;
  language?: CultureLocale | undefined;
  contentType?: CultureContentType | undefined;
  search?: string | undefined;
  savedOnly?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface CultureFacetOption<T extends string = string> {
  value: T;
  count: number;
}

/** Filter options and their totals, derived once from the compact index. */
export interface CultureFacets {
  /** Canonical category order, only categories present in the library. */
  categories: CultureFacetOption<CultureCategory>[];
  /** Canonical continent order, only continents present in the library. */
  continents: CultureFacetOption<CultureContinent>[];
  /** ISO 3166-1 alpha-2 codes: count descending, then code ascending. */
  countries: CultureFacetOption<string>[];
  /** Canonical content-type order, only types present in the library. */
  types: CultureFacetOption<CultureContentType>[];
}

export interface CultureSavedPort {
  /** Stable snapshot: the same reference until the saved set changes. */
  ids(): readonly string[];
  /** Cached compact records for the saved ids, in saved order. Local, never a request. */
  entries(): readonly CultureListEntry[];
  toggle(id: string): void;
  subscribe(listener: () => void): () => void;
}

export interface CultureDiscoveryAdapter {
  /** One cursor page of the compact index under the active filters/search. */
  loadPage(query: CulturePageQuery, signal?: AbortSignal): Promise<CultureListPage>;
  /** Filter options and counts. A rejection degrades to the built-in category list. */
  loadFacets(): Promise<CultureFacets>;
  /** The editorial feature; null means "nothing to feature" (empty library). */
  loadFeatured(): Promise<CultureListEntry | null>;
  /** One full article for the reading surface; null means it is gone from the library. */
  loadItem(id: string): Promise<CultureDetailItem | null>;
  /**
   * Resolve declared related ids (CultureArticle.related) to validated compact entries,
   * preserving the requested order and dropping unknown/duplicate ids. No invented links.
   */
  loadRelated(ids: readonly string[]): Promise<CultureListEntry[]>;
  /** Device-local saved set. */
  saved: CultureSavedPort;
  /** Optional connectivity probe; defaults to navigator.onLine. */
  online?(): boolean;
}

export interface CultureAdapterOptions {
  /**
   * Today's key from useTodayKey() ("YYYY-MM-DD"), read lazily when the feature is
   * requested. The empty string is accepted by the engine and yields a stable,
   * non-rotating pick; the route should pass the hydrated value because the feature is
   * chosen once per section mount.
   */
  dayKey?: (() => string) | undefined;
}

function abortError(): Error {
  if (typeof DOMException === "function") return new DOMException("Aborted", "AbortError");
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function catalogError(status: CultureLoadStatus): Error {
  return new Error("culture-catalog-" + status);
}

function emptyPage(): CultureListPage {
  return { items: [], total: 0 };
}

function toQueryFilters(query: CulturePageQuery): CultureFilters {
  const filters: CultureFilters = { limit: query.limit ?? FEED_DEFAULT_LIMIT };
  if (query.category !== undefined) filters.category = query.category;
  if (query.continent !== undefined) filters.continent = query.continent;
  if (query.country !== undefined) filters.country = query.country;
  if (query.contentType !== undefined) filters.contentType = query.contentType;
  if (query.search !== undefined) filters.search = query.search;
  if (query.savedOnly !== undefined) filters.savedOnly = query.savedOnly;
  if (query.cursor !== undefined) filters.cursor = query.cursor;
  // CultureFilters.language exists for the UI's query contract, but the compact schema v2
  // index does not carry per-record languages, so it deliberately does not filter.
  return filters;
}

function toPage(page: {
  items: CultureIndexEntry[];
  nextCursor?: string | undefined;
  total?: number | undefined;
}): CultureListPage {
  const result: CultureListPage = { items: page.items, total: page.total ?? page.items.length };
  if (page.nextCursor !== undefined) result.nextCursor = page.nextCursor;
  return result;
}

const EMPTY_FACETS: CultureFacets = {
  categories: [],
  continents: [],
  countries: [],
  types: [],
};

/** Attach counts to a canonical value order, dropping values the library does not use. */
function facetOptions<T extends string>(
  order: readonly T[],
  counts: ReadonlyMap<string, number>,
): CultureFacetOption<T>[] {
  return order.flatMap((value) => {
    const count = counts.get(value);
    return count === undefined || count <= 0 ? [] : [{ value, count }];
  });
}

async function loadFacets(): Promise<CultureFacets> {
  const index = await loadCultureIndex();
  if (index.status === "empty") return EMPTY_FACETS;
  if (index.status !== "ok") throw catalogError(index.status);
  const categories = new Map<string, number>();
  const continents = new Map<string, number>();
  const countries = new Map<string, number>();
  const types = new Map<string, number>();
  for (const entry of index.entries) {
    categories.set(entry.category, (categories.get(entry.category) ?? 0) + 1);
    continents.set(entry.continent, (continents.get(entry.continent) ?? 0) + 1);
    types.set(entry.contentType, (types.get(entry.contentType) ?? 0) + 1);
    for (const country of entry.countries) {
      countries.set(country, (countries.get(country) ?? 0) + 1);
    }
  }
  const countryOptions = [...countries.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  return {
    categories: facetOptions(CULTURE_CATEGORIES, categories),
    continents: facetOptions(CONTINENT_ORDER, continents),
    countries: countryOptions,
    types: facetOptions(CULTURE_CONTENT_TYPES, types),
  };
}

function savedEntriesFromIndex(): readonly CultureListEntry[] {
  const ids = listSavedCultureIds();
  if (ids.length === 0) return [];
  const entries = peekCultureIndex();
  if (!entries) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const out: CultureListEntry[] = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Saved articles are device data: ids and cached compact entries are read synchronously, so
 * the saved view opens with no request and works offline. The store notifies for every
 * mutation it owns (including cross-tab writes and restores), so the UI never polls.
 */
function createSavedPort(): CultureSavedPort {
  return {
    ids: () => listSavedCultureIds(),
    entries: () => savedEntriesFromIndex(),
    toggle: (id) => {
      void toggleCultureSaved(id).catch(() => undefined);
    },
    subscribe: (listener) => subscribeCultureSaved(listener),
  };
}

/**
 * Build the adapter the discovery section expects from the engine.
 *
 * Create it once -- module scope in the route, or a useMemo whose dependency never
 * changes. The section treats a new adapter identity as a new library and restarts the
 * feed.
 */
export function createCultureDiscoveryAdapter(
  options: CultureAdapterOptions = {},
): CultureDiscoveryAdapter {
  const saved = createSavedPort();
  return {
    loadPage: async (query: CulturePageQuery, signal?: AbortSignal) => {
      const index = await loadCultureIndex();
      throwIfAborted(signal);
      if (index.status === "empty") return emptyPage();
      if (index.status !== "ok") throw catalogError(index.status);
      const page = browseCulture(index.entries, toQueryFilters(query), {
        savedIds: saved.ids(),
      });
      throwIfAborted(signal);
      return toPage(page);
    },
    loadFacets,
    loadFeatured: async () => {
      const index = await loadCultureIndex();
      if (index.status === "empty") return null;
      if (index.status !== "ok") throw catalogError(index.status);
      return featuredForDay(index.entries, options.dayKey?.() ?? "");
    },
    loadItem: async (id: string) => loadCultureItem(id),
    loadRelated: async (ids: readonly string[]) => {
      const index = await loadCultureIndex();
      if (index.status !== "ok") return [];
      const byId = new Map(index.entries.map((entry) => [entry.id, entry]));
      const out: CultureListEntry[] = [];
      for (const id of new Set(ids)) {
        const entry = byId.get(id);
        if (entry) out.push(entry);
      }
      return out;
    },
    saved,
    online: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
  };
}

/** Related-article limit the adapter uses when a caller wants metadata relationships. */
export const CULTURE_RELATED_DEFAULT_LIMIT = RELATED_DEFAULT_LIMIT;
