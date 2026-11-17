import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  CultureDiscoveryAdapter,
  CultureFacets,
  CulturePageQuery,
} from "@/lib/culture/adapter";
import type {
  CultureCategory,
  CultureContentType,
  CultureContinent,
  CultureIndexEntry,
  CultureLocale,
} from "@/lib/culture/types";
import { COPY } from "./copy";

/**
 * Feed state for the written library.
 *
 * The library is local, but browsing is still a reading loop that must stay quiet:
 * - the search is debounced, so a sentence being typed is not a request per keystroke;
 * - one page is in flight at a time, whatever the person does;
 * - a short cooldown follows every page, so a held key or a fast tap cannot fire again;
 * - there is a hard page cap and an explicit "more" control — no scroll sentinel, no
 *   uncontrolled infinite feed;
 * - cursors that repeat end the feed instead of looping, and entries are de-duplicated
 *   by id so the same piece is never rendered twice.
 *
 * The saved view is entirely local: it opens with no request and works offline.
 */

export const SEARCH_DEBOUNCE_MS = 280;
export const MORE_COOLDOWN_MS = 700;
/** Hard cap on pages fetched in one feed lifetime, including the first one. */
export const MAX_PAGES = 12;
export const PAGE_SIZE = 8;

export const CONTENT_TYPES: readonly CultureContentType[] = [
  "feature",
  "note",
  "language",
  "scene",
  "contrast",
  "detail",
];

export const CONTINENTS: readonly CultureContinent[] = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];

export const ALL_CATEGORIES: readonly CultureCategory[] = Object.keys(
  COPY.en.categories,
) as CultureCategory[];

export type DiscoveryStatus =
  "loading" | "ready" | "empty" | "error" | "offline" | "catalog-unavailable";

export type FeedFailure = "failed" | "offline" | "catalog";

function classifyFailure(error: unknown, online: boolean): FeedFailure {
  const message = error instanceof Error ? error.message : "";
  // The production adapter rejects with "culture-catalog-<status>" when the bundled
  // catalog cannot be read at all; that is a different surface from a failed page.
  if (/catalog|version/i.test(message)) return "catalog";
  return online ? "failed" : "offline";
}

function statusFor(failure: FeedFailure): DiscoveryStatus {
  if (failure === "catalog") return "catalog-unavailable";
  if (failure === "offline") return "offline";
  return "error";
}

/** Real connectivity, read as an external store: no polling and no effect write. */
export function useIsOnline(adapter: CultureDiscoveryAdapter): boolean {
  const getSnapshot = useCallback(
    () => (adapter.online ? adapter.online() : navigator.onLine !== false),
    [adapter],
  );
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    return () => {
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
    };
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

/** One state value that only changes after the person stopped typing. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (Object.is(value, debounced)) return undefined;
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, debounced, delay]);
  return debounced;
}

function subscribeConnectivity(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function buildQuery(input: {
  category?: CultureCategory | undefined;
  continent?: CultureContinent | undefined;
  country?: string | undefined;
  language?: CultureLocale | undefined;
  contentType?: CultureContentType | undefined;
  search?: string | undefined;
  cursor?: string | undefined;
}): CulturePageQuery {
  const query: CulturePageQuery = { limit: PAGE_SIZE };
  if (input.category) query.category = input.category;
  if (input.continent) query.continent = input.continent;
  if (input.country) query.country = input.country;
  if (input.language) query.language = input.language;
  if (input.contentType) query.contentType = input.contentType;
  if (input.search) query.search = input.search;
  if (input.cursor) query.cursor = input.cursor;
  return query;
}

function uniqueEntries(
  items: readonly CultureIndexEntry[],
  seen: Set<string>,
): CultureIndexEntry[] {
  const out: CultureIndexEntry[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function matchesSavedFilters(
  entry: CultureIndexEntry,
  filters: {
    category?: CultureCategory | undefined;
    continent?: CultureContinent | undefined;
    country?: string | undefined;
    contentType?: CultureContentType | undefined;
    language?: string | undefined;
    search?: string | undefined;
  },
): boolean {
  if (filters.category && entry.category !== filters.category) return false;
  if (filters.continent && entry.continent !== filters.continent) return false;
  if (filters.country && !entry.countries.includes(filters.country)) return false;
  if (filters.contentType && entry.contentType !== filters.contentType) return false;
  if (filters.language) {
    const needle = filters.language.toLowerCase();
    const inTags = entry.tags.some((tag) => tag.toLowerCase().includes(needle));
    if (!inTags) return false;
  }
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const haystack = [
      entry.title.ar,
      entry.title.de,
      entry.title.en,
      entry.teaser.ar,
      entry.teaser.de,
      entry.teaser.en,
      ...entry.tags,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export interface CultureFeed {
  status: DiscoveryStatus;
  entries: CultureIndexEntry[];
  total: number;
  featured: CultureIndexEntry | null;
  facets: CultureFacets | null;
  online: boolean;
  savedOnly: boolean;
  savedIds: ReadonlySet<string>;
  savedEntries: readonly CultureIndexEntry[];
  category: CultureCategory | undefined;
  continent: CultureContinent | undefined;
  country: string | undefined;
  language: CultureLocale | undefined;
  contentType: CultureContentType | undefined;
  search: string;
  searchPending: boolean;
  filtersActive: boolean;
  setCategory(value: CultureCategory | undefined): void;
  setContinent(value: CultureContinent | undefined): void;
  setCountry(value: string | undefined): void;
  setLanguage(value: CultureLocale | undefined): void;
  setContentType(value: CultureContentType | undefined): void;
  setSearch(value: string): void;
  setSavedOnly(value: boolean): void;
  clearFilters(): void;
  retry(): void;
  loadMore(): void;
  canLoadMore: boolean;
  loadingMore: boolean;
  moreError: boolean;
  cooldown: boolean;
  pageCount: number;
  isSaved(id: string): boolean;
  toggleSaved(id: string): void;
}

export function useCultureFeed(adapter: CultureDiscoveryAdapter): CultureFeed {
  const online = useIsOnline(adapter);

  const [category, setCategory] = useState<CultureCategory | undefined>(undefined);
  const [continent, setContinent] = useState<CultureContinent | undefined>(undefined);
  const [country, setCountry] = useState<string | undefined>(undefined);
  const [language, setLanguage] = useState<CultureLocale | undefined>(undefined);
  const [contentType, setContentType] = useState<CultureContentType | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);

  const trimmedSearch = search.trim();
  const debouncedSearch = useDebouncedValue(trimmedSearch, SEARCH_DEBOUNCE_MS);

  const [entries, setEntries] = useState<CultureIndexEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<DiscoveryStatus>("loading");
  const [featured, setFeatured] = useState<CultureIndexEntry | null>(null);
  const [facets, setFacets] = useState<CultureFacets | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  const generation = useRef(0);
  const controllers = useRef<Set<AbortController>>(new Set());
  const cursorRef = useRef<string | undefined>(undefined);
  const seenIds = useRef<Set<string>>(new Set());
  const pagesRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const cooldownUntil = useRef(0);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armCooldown = useCallback(() => {
    if (typeof window === "undefined") return;
    cooldownUntil.current = Date.now() + MORE_COOLDOWN_MS;
    setCooldown(true);
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    cooldownTimer.current = setTimeout(() => {
      cooldownUntil.current = 0;
      cooldownTimer.current = null;
      setCooldown(false);
    }, MORE_COOLDOWN_MS);
  }, []);

  const abortAll = useCallback(() => {
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
  }, []);

  useEffect(() => {
    const current = controllers.current;
    return () => {
      generation.current += 1;
      for (const controller of current) controller.abort();
      current.clear();
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
      cooldownTimer.current = null;
    };
  }, []);

  /* Facets and the daily feature are independent, one-shot reads; either failing is
     local and never takes the feed down with it. */
  useEffect(() => {
    let cancelled = false;
    adapter
      .loadFacets()
      .then((value) => {
        if (!cancelled) setFacets(value);
      })
      .catch(() => {
        if (!cancelled) setFacets(null);
      });
    adapter
      .loadFeatured()
      .then((value) => {
        if (!cancelled) setFeatured(value);
      })
      .catch(() => {
        if (!cancelled) setFeatured(null);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  /* A new query is a new first page. The generation counter is the only thing allowed
     to commit a result: an aborted or superseded response resolves into the void. */
  useEffect(() => {
    if (savedOnly) {
      // The device shelf is local and synchronous: no request may outlive this view.
      generation.current += 1;
      abortAll();
      return undefined;
    }
    const controller = new AbortController();
    controllers.current.add(controller);
    const generationId = ++generation.current;
    pagesRef.current = 0;
    loadingMoreRef.current = false;
    seenIds.current = new Set();
    cursorRef.current = undefined;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new query owns a fresh feed state
    setEntries([]);
    setTotal(0);
    setNextCursor(undefined);
    setStatus("loading");
    setMoreError(false);
    setLoadingMore(false);
    setPageCount(0);
    setCooldown(false);
    cooldownUntil.current = 0;

    adapter
      .loadPage(
        buildQuery({
          category,
          continent,
          country,
          language,
          contentType,
          search: debouncedSearch || undefined,
        }),
        controller.signal,
      )
      .then((page) => {
        if (generation.current !== generationId) return;
        const items = uniqueEntries(page.items, seenIds.current);
        pagesRef.current = 1;
        cursorRef.current = page.nextCursor;
        setEntries(items);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setPageCount(1);
        setStatus(items.length > 0 ? "ready" : "empty");
        armCooldown();
      })
      .catch((error: unknown) => {
        if (generation.current !== generationId || controller.signal.aborted) return;
        setStatus(statusFor(classifyFailure(error, online)));
      });

    return () => {
      controller.abort();
    };
    // The debounced search is the query; raw keystrokes deliberately do not run this
    // effect. A language filter is one deliberate choice, not typing.
  }, [
    adapter,
    savedOnly,
    category,
    continent,
    country,
    contentType,
    language,
    debouncedSearch,
    online,
    reloadNonce,
    armCooldown,
    abortAll,
  ]);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (savedOnly || !cursor) return;
    if (loadingMoreRef.current) return;
    if (Date.now() < cooldownUntil.current) return;
    if (pagesRef.current >= MAX_PAGES) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    const generationId = generation.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreError(false);

    adapter
      .loadPage(
        buildQuery({
          category,
          continent,
          country,
          language,
          contentType,
          search: debouncedSearch || undefined,
          cursor,
        }),
        controller.signal,
      )
      .then((page) => {
        if (generation.current !== generationId) return;
        const fresh = uniqueEntries(page.items, seenIds.current);
        pagesRef.current += 1;
        const next = page.nextCursor;
        // A cursor that repeats the one that produced this page would loop forever.
        cursorRef.current = next === cursor ? undefined : next;
        setEntries((previous) => [...previous, ...fresh]);
        setNextCursor(cursorRef.current);
        setPageCount(pagesRef.current);
        armCooldown();
      })
      .catch((error: unknown) => {
        if (generation.current !== generationId || controller.signal.aborted) return;
        // A failed next page is retryable immediately: do not keep the reading cooldown
        // from a page that never arrived.
        cooldownUntil.current = 0;
        setCooldown(false);
        setMoreError(true);
        void error;
      })
      .finally(() => {
        if (generation.current !== generationId) return;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [
    adapter,
    savedOnly,
    category,
    continent,
    country,
    contentType,
    language,
    debouncedSearch,
    armCooldown,
  ]);

  const retry = useCallback(() => setReloadNonce((value) => value + 1), []);

  const clearFilters = useCallback(() => {
    setCategory(undefined);
    setContinent(undefined);
    setCountry(undefined);
    setLanguage(undefined);
    setContentType(undefined);
    setSearch("");
  }, []);

  const subscribeSaved = useCallback(
    (onChange: () => void) => adapter.saved.subscribe(onChange),
    [adapter],
  );
  const getSavedIds = useCallback(() => adapter.saved.ids(), [adapter]);
  const savedIdsList = useSyncExternalStore(subscribeSaved, getSavedIds, getSavedIds);
  // The saved ids are the stable external snapshot; the compact records are derived from
  // them, so the store never has to fake a new array identity on every read.
  const savedEntriesAll = useMemo(() => {
    const byId = new Map(adapter.saved.entries().map((entry) => [entry.id, entry]));
    return savedIdsList.flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    });
  }, [adapter, savedIdsList]);
  const savedIds = useMemo(() => new Set(savedIdsList), [savedIdsList]);

  const filters = useMemo(
    () => ({
      category,
      continent,
      country,
      contentType,
      language,
      search: debouncedSearch || undefined,
    }),
    [category, continent, country, contentType, language, debouncedSearch],
  );

  const savedEntries = useMemo(
    () => savedEntriesAll.filter((entry) => matchesSavedFilters(entry, filters)),
    [savedEntriesAll, filters],
  );

  const filtersActive =
    category !== undefined ||
    continent !== undefined ||
    country !== undefined ||
    contentType !== undefined ||
    language !== undefined ||
    trimmedSearch !== "";

  const visibleEntries = savedOnly ? savedEntries : entries;
  const resolvedStatus: DiscoveryStatus = savedOnly
    ? savedEntries.length > 0
      ? "ready"
      : "empty"
    : status;

  const toggleSaved = useCallback((id: string) => adapter.saved.toggle(id), [adapter]);

  const searchPending = trimmedSearch !== debouncedSearch;

  const canLoadMore =
    !savedOnly &&
    status === "ready" &&
    nextCursor !== undefined &&
    !loadingMore &&
    !cooldown &&
    pageCount < MAX_PAGES;

  return {
    status: resolvedStatus,
    entries: visibleEntries,
    total: savedOnly ? savedEntries.length : total,
    featured,
    facets,
    online,
    savedOnly,
    savedIds,
    savedEntries: savedEntriesAll,
    category,
    continent,
    country,
    language,
    contentType,
    search,
    searchPending,
    filtersActive,
    setCategory,
    setContinent,
    setCountry,
    setLanguage,
    setContentType,
    setSearch,
    setSavedOnly,
    clearFilters,
    retry,
    loadMore,
    canLoadMore,
    loadingMore,
    moreError,
    cooldown,
    pageCount,
    isSaved: (id: string) => savedIds.has(id),
    toggleSaved,
  };
}
