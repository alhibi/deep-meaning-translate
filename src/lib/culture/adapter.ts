import type {
  CultureCategory,
  CultureContinent,
  CultureIndexEntry,
  CultureItem,
  LocalizedText,
} from "./types";
import { CULTURE_CATEGORIES, type CultureFilters } from "./types";
import {
  browseCulture,
  featuredForDay,
  relatedCultureEntries,
  RELATED_DEFAULT_LIMIT,
} from "./discovery";
import {
  loadCultureIndex,
  loadCultureItem,
  peekCultureIndex,
  type CultureLoadStatus,
} from "./loader";
import { listSavedCultureIds, subscribeCultureSaved, toggleCultureSaved } from "./saved";

/**
 * The discovery data contract (A11 UI <-> A10/A09 engine).
 *
 * This module is the one definition of the shape the discovery UI consumes and the engine
 * produces: the component tree imports it downwards, and a production adapter implements it
 * here without importing anything from \`src/components\`.
 *
 * Rules the adapter keeps:
 * - \`loadPage\` is cursor-based and returns the next cursor; it must never return the same
 *   cursor twice (the UI stops itself if it does, but that means lost content).
 * - The adapter object is stable for a section's lifetime. A new identity restarts the
 *   feed, exactly like a new query would.
 * - A list record is the shared compact index entry plus the optional original title. Media
 *   lives on \`CultureIndexEntry.media\`; missing media is a typographic card, not an error.
 * - \`saved.ids()\` / \`saved.entries()\` are synchronous and device-local: a saved view opens
 *   with no network at all.
 * - \`loadItem\` is the only call that may fetch a large body (a per-record chunk).
 */

/**
 * A full record plus the optional editorial reason the reading surface shows as
 * "why it is distinctive". Ingestion supplies it only when the source states a reason in
 * its own words; absent means the block is not rendered. The UI never writes one.
 */
export type CultureDetailItem = CultureItem & { whyDistinctive?: LocalizedText };

/**
 * A compact list record: the shared index entry plus the title in its own language when the
 * source supplies one. Everything else a card needs is in the index entry (including the
 * small media block).
 */
export interface CultureListEntry extends CultureIndexEntry {
  /** The title in its own language, when the record has one different from the translations. */
  titleOriginal?: string | undefined;
  /** ISO code or language name the original title is written in. */
  titleOriginalLanguage?: string | undefined;
}

/** One bounded page over the compact index. */
export interface CultureListPage {
  items: CultureListEntry[];
  nextCursor?: string | undefined;
  total?: number | undefined;
}

/** One bounded page request over the compact index. */
export interface CulturePageQuery {
  category?: CultureCategory | undefined;
  continent?: CultureContinent | undefined;
  country?: string | undefined;
  search?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface CultureFacetOption<T extends string> {
  value: T;
  count: number;
}

/** Filter options and their totals, derived once from the compact index. */
export interface CultureFacets {
  categories: CultureFacetOption<CultureCategory>[];
  continents: CultureFacetOption<CultureContinent>[];
  /** ISO 3166-1 alpha-2 codes. */
  countries: CultureFacetOption<string>[];
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
  /** The editorial feature; null means "nothing to feature" (empty or filtered corpus). */
  loadFeatured(): Promise<CultureListEntry | null>;
  /** One full record for the reading surface; null means it is gone from the corpus. */
  loadItem(id: string): Promise<CultureDetailItem | null>;
  /**
   * Related records for one reading surface: declared relationships first, then genuine
   * metadata relationships (never invented). The adapter may use either source.
   */
  loadRelated(itemId: string, declared: readonly string[]): Promise<CultureListEntry[]>;
  /** Device-local saved set. */
  saved: CultureSavedPort;
  /** Optional connectivity probe; defaults to navigator.onLine. */
  online?(): boolean;
}

/**
 * The production adapter: the A10 discovery engine (loader, ranking, saved store) behind the
 * contract above.
 *
 * Create it once — module scope in the route, or a useMemo whose dependency never changes.
 * The section treats a new adapter identity as a new catalog and restarts the feed.
 *
 * Nothing here invents data: a page is exactly the compact index entries the loader
 * validated, the feature's original title comes from its own record body, and related records
 * come from declared relationships or genuine shared metadata.
 */

const CONTINENTS: readonly CultureContinent[] = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];

const RELATED_LIMIT = RELATED_DEFAULT_LIMIT;

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
  const filters: CultureFilters = { limit: query.limit };
  if (query.category) filters.category = query.category;
  if (query.continent) filters.continent = query.continent;
  if (query.country) filters.country = query.country;
  if (query.search) filters.search = query.search;
  if (query.cursor) filters.cursor = query.cursor;
  return filters;
}

/** Attach the original title the body carries and the compact index does not. */
function withBody(entry: CultureListEntry, item: CultureItem | null): CultureListEntry {
  if (!item) return entry;
  const enriched: CultureListEntry = { ...entry };
  if (item.title.original) enriched.titleOriginal = item.title.original;
  if (item.title.originalLanguage) enriched.titleOriginalLanguage = item.title.originalLanguage;
  return enriched;
}

function savedEntriesFromIndex(): readonly CultureListEntry[] {
  const ids = listSavedCultureIds();
  if (!ids.length) return [];
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
 * Saved records are device data: ids and cached compact entries are read synchronously, so
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

async function loadFacets(): Promise<CultureFacets> {
  const index = await loadCultureIndex();
  if (index.status === "empty") return { categories: [], continents: [], countries: [] };
  if (index.status !== "ok") throw catalogError(index.status);
  const categories = new Map<CultureCategory, number>();
  const continents = new Map<CultureContinent, number>();
  const countries = new Map<string, number>();
  for (const entry of index.entries) {
    categories.set(entry.category, (categories.get(entry.category) ?? 0) + 1);
    continents.set(entry.continent, (continents.get(entry.continent) ?? 0) + 1);
    for (const country of entry.countries) {
      countries.set(country, (countries.get(country) ?? 0) + 1);
    }
  }
  return {
    categories: CULTURE_CATEGORIES.flatMap((category) => {
      const count = categories.get(category);
      return count ? [{ value: category, count }] : [];
    }),
    continents: CONTINENTS.flatMap((continent) => {
      const count = continents.get(continent);
      return count ? [{ value: continent, count }] : [];
    }),
    countries: [...countries.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
  };
}

/**
 * Build the adapter the discovery section expects from the A10 engine.
 *
 * The featured record is the one place the adapter reads a body: the hero gets the title in
 * its own language, and a failure there falls back to the compact index entry rather than
 * blocking the section.
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
      const page = browseCulture(index.entries, toQueryFilters(query));
      throwIfAborted(signal);
      const result: CultureListPage = { items: page.items };
      if (page.nextCursor !== undefined) result.nextCursor = page.nextCursor;
      if (page.total !== undefined) result.total = page.total;
      return result;
    },
    loadFacets,
    loadFeatured: async () => {
      const index = await loadCultureIndex();
      if (index.status === "empty") return null;
      if (index.status !== "ok") throw catalogError(index.status);
      const featured = featuredForDay(index.entries, options.dayKey?.() ?? "");
      if (!featured) return null;
      try {
        const item = await loadCultureItem(featured.id);
        return withBody(featured, item);
      } catch {
        return featured;
      }
    },
    loadItem: async (id: string) => {
      const item = await loadCultureItem(id);
      return item as CultureDetailItem | null;
    },
    loadRelated: async (itemId: string, declared: readonly string[]) => {
      const index = await loadCultureIndex();
      if (index.status !== "ok") return [];
      return relatedCultureEntries(index.entries, itemId, {
        declared,
        limit: RELATED_LIMIT,
      });
    },
    saved,
  };
}
