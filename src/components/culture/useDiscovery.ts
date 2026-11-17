import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CultureCategory, CultureContinent } from "@/lib/culture/types";
import type {
  CultureDetailItem,
  CultureDiscoveryAdapter,
  CultureFacets,
  CultureListEntry,
  CulturePageQuery,
  CultureSavedPort,
} from "./contract";

/**
 * Feed state for the discovery section.
 *
 * The index is local, but every page read still costs work, so three guards keep the
 * browsing loop controlled:
 * - an in-flight flag: one page at a time, whatever the input does;
 * - a cooldown after each page, so an advertising sentinel or a fast scroll cannot fire
 *   back-to-back requests;
 * - a hard cap on *automatic* incremental pages; past it the person has to ask for more.
 *
 * A page whose cursor repeats the cursor that produced it ends the feed instead of
 * looping, and entries are de-duplicated by id so no card is ever rendered twice.
 */

export const SEARCH_DEBOUNCE_MS = 260;
export const MORE_COOLDOWN_MS = 900;
export const AUTO_PAGE_LIMIT = 2;
export const DEFAULT_PAGE_SIZE = 8;
export const RELATED_LIMIT = 6;

export type FeedStatus = "loading" | "ready" | "error";
export type FeedErrorKind = "offline" | "failed";

interface FeedFilters {
  category?: CultureCategory | undefined;
  continent?: CultureContinent | undefined;
  country?: string | undefined;
  search: string;
}

function buildQuery(
  filters: FeedFilters,
  cursor: string | undefined,
  limit: number,
): CulturePageQuery {
  const query: CulturePageQuery = { limit };
  if (filters.category) query.category = filters.category;
  if (filters.continent) query.continent = filters.continent;
  if (filters.country) query.country = filters.country;
  if (filters.search) query.search = filters.search;
  if (cursor !== undefined) query.cursor = cursor;
  return query;
}

function uniqueById(items: readonly CultureListEntry[]): CultureListEntry[] {
  const seen = new Set<string>();
  const unique: CultureListEntry[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

function subscribeConnectivity(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Real connectivity, read as an external store (no effect write, no polling). The server
 * snapshot is "online" so server-rendered markup and the first client paint agree.
 */
export function useIsOnline(adapter?: Pick<CultureDiscoveryAdapter, "online">): boolean {
  const getSnapshot = useCallback(
    () => (adapter?.online ? adapter.online() : navigator.onLine !== false),
    [adapter],
  );
  return useSyncExternalStore(subscribeConnectivity, getSnapshot, () => true);
}

/** One state value that only changes after the person stopped typing. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (Object.is(value, debounced)) return;
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, debounced, delay]);
  return debounced;
}

export interface CultureFeed {
  entries: CultureListEntry[];
  total: number | undefined;
  status: FeedStatus;
  error: FeedErrorKind | null;
  loadingMore: boolean;
  moreError: FeedErrorKind | null;
  canLoadMore: boolean;
  hasMore: boolean;
  category: CultureCategory | undefined;
  continent: CultureContinent | undefined;
  country: string | undefined;
  search: string;
  searchPending: boolean;
  activeFilters: boolean;
  setCategory: (value: CultureCategory | undefined) => void;
  setContinent: (value: CultureContinent | undefined) => void;
  setCountry: (value: string | undefined) => void;
  setSearch: (value: string) => void;
  clearFilters: () => void;
  retry: () => void;
  loadMore: (auto?: boolean) => void;
}

/**
 * The reading surface mounts fresh per record, so an id change is a remount rather than a
 * reset-in-effect: the record can never be shown for the wrong id, and the new read starts
 * from a clean loading state.
 */
export function useCultureFeed(
  adapter: CultureDiscoveryAdapter,
  pageSize = DEFAULT_PAGE_SIZE,
): CultureFeed {
  const [category, setCategoryState] = useState<CultureCategory | undefined>(undefined);
  const [continent, setContinentState] = useState<CultureContinent | undefined>(undefined);
  const [country, setCountryState] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");

  const trimmedSearch = search.trim();
  const debouncedSearch = useDebouncedValue(trimmedSearch, SEARCH_DEBOUNCE_MS);

  const [entries, setEntries] = useState<CultureListEntry[]>([]);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [error, setError] = useState<FeedErrorKind | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<FeedErrorKind | null>(null);

  const online = useIsOnline(adapter);
  const onlineRef = useRef(online);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  const generation = useRef(0);
  const busy = useRef(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const loadedIds = useRef<Set<string>>(new Set());
  const autoPages = useRef(0);
  const autoCooldownUntil = useRef(0);
  const controllers = useRef<Set<AbortController>>(new Set());

  const abortAll = useCallback(() => {
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
  }, []);

  useEffect(
    () => () => {
      generation.current += 1;
      abortAll();
    },
    [abortAll],
  );

  const filters = useMemo<FeedFilters>(
    () => ({ category, continent, country, search: debouncedSearch }),
    [category, continent, country, debouncedSearch],
  );

  const firstPage = useCallback(() => {
    const generationId = ++generation.current;
    abortAll();
    busy.current = true;
    cursorRef.current = undefined;
    loadedIds.current = new Set();
    autoPages.current = 0;
    autoCooldownUntil.current = 0;
    setEntries([]);
    setNextCursor(undefined);
    setTotal(undefined);
    setStatus("loading");
    setError(null);
    setLoadingMore(false);
    setMoreError(null);

    const controller = new AbortController();
    controllers.current.add(controller);
    adapter
      .loadPage(buildQuery(filters, undefined, pageSize), controller.signal)
      .then((page) => {
        if (generation.current !== generationId) return;
        const pageEntries = uniqueById(page.items);
        loadedIds.current = new Set(pageEntries.map((entry) => entry.id));
        setEntries(pageEntries);
        if (page.total !== undefined) setTotal(page.total);
        if (page.nextCursor === undefined) {
          cursorRef.current = undefined;
          setNextCursor(undefined);
        } else {
          cursorRef.current = page.nextCursor;
          setNextCursor(page.nextCursor);
        }
        setStatus("ready");
      })
      .catch(() => {
        if (generation.current !== generationId || controller.signal.aborted) return;
        setStatus("error");
        setError(onlineRef.current ? "failed" : "offline");
      })
      .finally(() => {
        controllers.current.delete(controller);
        if (generation.current === generationId) busy.current = false;
      });
  }, [abortAll, adapter, filters, pageSize]);

  // The initial read and every filter/search change restart from the first cursor. The
  // loading reset is part of that query change (it is not an event of its own), and the
  // read itself is asynchronous; a synchronous setState here is the intended pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset-on-query-change is derived state, not an event
    firstPage();
  }, [firstPage]);

  const loadMore = useCallback(
    (auto = false) => {
      const cursor = cursorRef.current;
      if (busy.current || cursor === undefined) return;
      if (auto) {
        if (autoPages.current >= AUTO_PAGE_LIMIT) return;
        if (Date.now() < autoCooldownUntil.current) return;
      }

      const generationId = generation.current;
      busy.current = true;
      setLoadingMore(true);
      setMoreError(null);
      const controller = new AbortController();
      controllers.current.add(controller);
      adapter
        .loadPage(buildQuery(filters, cursor, pageSize), controller.signal)
        .then((page) => {
          if (generation.current !== generationId) return;
          const fresh: CultureListEntry[] = [];
          for (const entry of page.items) {
            if (loadedIds.current.has(entry.id)) continue;
            loadedIds.current.add(entry.id);
            fresh.push(entry);
          }
          if (fresh.length) setEntries((previous) => [...previous, ...fresh]);
          if (page.total !== undefined) setTotal(page.total);
          const next = page.nextCursor;
          if (next === undefined || next === cursor) {
            // A repeated cursor would replay the same page forever; end the feed instead.
            cursorRef.current = undefined;
            setNextCursor(undefined);
          } else {
            cursorRef.current = next;
            setNextCursor(next);
          }
          if (auto) autoPages.current += 1;
          autoCooldownUntil.current = Date.now() + MORE_COOLDOWN_MS;
          setLoadingMore(false);
        })
        .catch(() => {
          if (generation.current !== generationId || controller.signal.aborted) return;
          setMoreError(onlineRef.current ? "failed" : "offline");
          setLoadingMore(false);
          autoCooldownUntil.current = Date.now() + MORE_COOLDOWN_MS;
        })
        .finally(() => {
          controllers.current.delete(controller);
          if (generation.current === generationId) busy.current = false;
        });
    },
    [adapter, filters, pageSize],
  );

  const retry = useCallback(() => {
    if (status === "error") {
      firstPage();
      return;
    }
    if (moreError) loadMore(false);
  }, [firstPage, loadMore, moreError, status]);

  const setCategory = useCallback((value: CultureCategory | undefined) => {
    setCategoryState(value);
  }, []);
  const setContinent = useCallback((value: CultureContinent | undefined) => {
    setContinentState(value);
  }, []);
  const setCountry = useCallback((value: string | undefined) => {
    setCountryState(value);
  }, []);
  const clearFilters = useCallback(() => {
    setCategoryState(undefined);
    setContinentState(undefined);
    setCountryState(undefined);
    setSearch("");
  }, []);

  return {
    entries,
    total,
    status,
    error,
    loadingMore,
    moreError,
    canLoadMore: nextCursor !== undefined && status === "ready",
    hasMore: nextCursor !== undefined,
    category,
    continent,
    country,
    search,
    searchPending: trimmedSearch !== debouncedSearch,
    activeFilters: Boolean(category ?? continent ?? country ?? trimmedSearch),
    setCategory,
    setContinent,
    setCountry,
    setSearch,
    clearFilters,
    retry,
    loadMore,
  };
}

const EMPTY_SAVED: readonly string[] = [];
const savedSnapshots = new WeakMap<
  CultureSavedPort,
  { raw: readonly string[]; stable: readonly string[] }
>();

/**
 * A stable snapshot for `useSyncExternalStore`: if the port hands back an equal array
 * with a new identity, the previous reference is kept so React does not loop.
 */
function savedIdsSnapshot(port: CultureSavedPort): readonly string[] {
  const raw = port.ids();
  const cached = savedSnapshots.get(port);
  if (
    cached &&
    cached.raw.length === raw.length &&
    cached.raw.every((id, index) => id === raw[index])
  ) {
    return cached.stable;
  }
  savedSnapshots.set(port, { raw: raw.slice(), stable: raw });
  return raw;
}

export interface SavedCultureState {
  ids: ReadonlySet<string>;
  entries: readonly CultureListEntry[];
  isSaved: (id: string) => boolean;
  toggle: (id: string) => void;
}

/** Device-local saved set. Reading it never touches the network, so it works offline. */
export function useSavedCulture(port: CultureSavedPort): SavedCultureState {
  const subscribe = useCallback((onChange: () => void) => port.subscribe(onChange), [port]);
  const getSnapshot = useCallback(() => savedIdsSnapshot(port), [port]);
  const ids = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SAVED);
  const savedSet = useMemo(() => new Set(ids), [ids]);
  const entries = port.entries();
  const toggle = useCallback(
    (id: string) => {
      port.toggle(id);
    },
    [port],
  );
  return {
    ids: savedSet,
    entries,
    isSaved: (id: string) => savedSet.has(id),
    toggle,
  };
}

export interface FeaturedState {
  status: "loading" | "ready" | "error";
  item: CultureListEntry | null;
}

/** The editorial feature: one record, loaded once. Its failure is silent by design. */
export function useFeatured(adapter: CultureDiscoveryAdapter): FeaturedState {
  const [state, setState] = useState<FeaturedState>({ status: "loading", item: null });
  useEffect(() => {
    let active = true;
    adapter
      .loadFeatured()
      .then((item) => {
        if (!active) return;
        setState({ status: "ready", item });
      })
      .catch(() => {
        if (!active) return;
        setState({ status: "error", item: null });
      });
    return () => {
      active = false;
    };
  }, [adapter]);
  return state;
}

export type RecordState =
  | { status: "loading" }
  | { status: "error"; offline: boolean }
  | { status: "ready"; item: CultureDetailItem; related: CultureListEntry[] };

export interface CultureRecordHandle {
  state: RecordState;
  retry: () => void;
}

/**
 * One record for the reading surface. Related records are a second, optional read: a
 * failure there never hides the record that is already readable.
 */
export function useCultureRecord(
  adapter: CultureDiscoveryAdapter,
  itemId: string,
  online: boolean,
): CultureRecordHandle {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<RecordState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const item = await adapter.loadItem(itemId);
        if (!active) return;
        if (!item) {
          setState({ status: "error", offline: false });
          return;
        }
        setState({ status: "ready", item, related: [] });
        try {
          const related = await adapter.loadRelated(
            item.id,
            (item.related ?? []).slice(0, RELATED_LIMIT),
          );
          if (!active) return;
          setState((previous) =>
            previous.status === "ready" ? { ...previous, related } : previous,
          );
        } catch {
          // Related items are an enhancement; the record stays fully readable without them.
        }
      } catch {
        if (!active || controller.signal.aborted) return;
        setState({ status: "error", offline: !online });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [adapter, itemId, online, nonce]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setNonce((value) => value + 1);
  }, []);

  return { state, retry };
}

/** Filter options and their totals, read once. Failure degrades to the built-in lists. */
export function useFacets(adapter: CultureDiscoveryAdapter): CultureFacets | null {
  const [facets, setFacets] = useState<CultureFacets | null>(null);
  useEffect(() => {
    let active = true;
    adapter
      .loadFacets()
      .then((next) => {
        if (active) setFacets(next);
      })
      .catch(() => {
        if (active) setFacets(null);
      });
    return () => {
      active = false;
    };
  }, [adapter]);
  return facets;
}
