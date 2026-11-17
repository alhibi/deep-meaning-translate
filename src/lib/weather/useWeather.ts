/**
 * `useWeather` — stale-while-revalidate weather for one resolved place.
 *
 * The UI never talks to a provider: this hook renders a validated cached snapshot
 * immediately, revalidates only when the contract's freshness window has passed
 * (`WEATHER_FRESH_MS`, or later when the provider declared an expiry), and keeps the last
 * valid forecast when a refresh fails so the screen never blanks because the network did.
 * There is no polling: a revalidation happens on mount, on a manual `refresh()`, when the
 * weather surface becomes visible again, on network recovery, and when the place/units
 * change. A hidden surface requests nothing.
 *
 * Concurrency is coalesced per (rounded place, units, language): two components asking for
 * the same place share one request. A units preference change converts the snapshot in
 * memory instantly (no request) and only refreshes on the next natural window.
 *
 * Location permission/consent belongs to the location layer (A05); this hook takes the
 * already-resolved `WeatherPlace | null`. `deferRefresh` lets the shell postpone a
 * background revalidation while the composer is active.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isNativeApp } from "@/lib/native/config";
import { nativeRequest, NativeTransportError } from "@/lib/native/transport";
import {
  clearCachedSnapshots,
  readCachedSnapshot,
  readUnitsPreference,
  writeCachedSnapshot,
  writeUnitsPreference,
} from "./cache";
import {
  WeatherError,
  classifyWeatherFailure,
  convertSnapshotUnits,
  isWeatherUnits,
  parseWeatherSnapshot,
  roundCoordinate,
  weatherCacheKey,
  weatherErrorKind,
  weatherIsFresh,
  withDeadline,
  type WeatherErrorKind,
  type WeatherLanguage,
} from "./provider";
import {
  WEATHER_FRESH_MS,
  WEATHER_STALE_MS,
  type WeatherPlace,
  type WeatherSnapshot,
  type WeatherUnits,
} from "./types";

/** The route answers within ~5 s; allow one round trip of network headroom. */
const CLIENT_TIMEOUT_MS = 15_000;

export type { WeatherErrorKind } from "./provider";

export type WeatherStatus = "idle" | "loading" | "ready" | "error";

export interface WeatherFreshness {
  /** Age of the shown snapshot at render time (never negative, even with a rolled clock). */
  ageMs: number;
  /** A refresh is due: `ageMs >= WEATHER_FRESH_MS` unless the provider declared a later expiry. */
  isStale: boolean;
  /** Past the useful life of a forecast (`ageMs >= WEATHER_STALE_MS`). */
  isExpired: boolean;
}

export interface UseWeatherOptions {
  /** Resolved place from the location/geocode layer; null means "no place, no weather". */
  place: WeatherPlace | null;
  /** Interface language for the provider call (and the language of resolved labels). */
  language: WeatherLanguage;
  /** Default true; false pauses all fetching (feature off / no consent). */
  enabled?: boolean;
  /** True while the composer is active: keep cached data, skip the background refresh. */
  deferRefresh?: boolean;
}

export interface UseWeatherResult {
  status: WeatherStatus;
  /** Validated, place-labelled snapshot. A cached one renders before any request. */
  snapshot: WeatherSnapshot | null;
  freshness: WeatherFreshness | null;
  /** A background revalidation is in flight while a snapshot is already shown. */
  refreshing: boolean;
  /** Last failure; the previous snapshot is kept. Null after a success or a retry. */
  error: WeatherErrorKind | null;
  /** The device reports no network connection (live via online/offline events). */
  offline: boolean;
  /** Persisted unit preference. */
  units: WeatherUnits;
  setUnits(units: WeatherUnits): void;
  /** Manual retry: ignores the freshness window, respects `enabled`. */
  refresh(): void;
  /** Forget cached snapshots and the shown forecast (keeps the units preference). */
  clear(): void;
}

interface InternalState {
  snapshot: WeatherSnapshot | null;
  error: WeatherErrorKind | null;
  loading: boolean;
  refreshing: boolean;
}

const IDLE: InternalState = { snapshot: null, error: null, loading: false, refreshing: false };

const samePlace = (place: WeatherPlace, latitude: number, longitude: number): boolean =>
  roundCoordinate(place.latitude) === latitude && roundCoordinate(place.longitude) === longitude;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOffline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;

function newest(
  memory: WeatherSnapshot | null,
  cached: WeatherSnapshot | null,
): WeatherSnapshot | null {
  if (!memory) return cached;
  if (!cached) return memory;
  return cached.fetchedAt > memory.fetchedAt ? cached : memory;
}

/** Merge the locally resolved display label onto the server's (name-less) place. */
function withPlaceLabels(snapshot: WeatherSnapshot, place: WeatherPlace): WeatherSnapshot {
  const name = place.name || snapshot.place.name;
  return {
    ...snapshot,
    place: {
      ...snapshot.place,
      ...(name ? { name } : {}),
      ...(place.countryCode ? { countryCode: place.countryCode } : {}),
      ...(place.admin ? { admin: place.admin } : {}),
      ...(place.source ? { source: place.source } : {}),
      ...(place.placeCredit ? { placeCredit: place.placeCredit } : {}),
    },
  };
}

/* --------------------------------------------------------- request coalescing */

interface SharedRequest {
  promise: Promise<WeatherSnapshot>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}

const sharedRequests = new Map<string, SharedRequest>();

/** Test seam: module state must be resettable between deterministic tests. */
export function resetWeatherRequestsForTests(): void {
  for (const request of sharedRequests.values()) request.controller.abort();
  sharedRequests.clear();
}

/**
 * Join the in-flight request for this identity, or become it. Every consumer leaving
 * aborts the shared request only when the last one is gone, so one component's unmount
 * cannot cancel another component's forecast.
 */
function joinRequest(
  key: string,
  run: (signal: AbortSignal) => Promise<WeatherSnapshot>,
): { promise: Promise<WeatherSnapshot>; leave: () => void } {
  let entry = sharedRequests.get(key);
  if (!entry) {
    const controller = new AbortController();
    const created: SharedRequest = {
      promise: Promise.resolve() as unknown as Promise<WeatherSnapshot>,
      controller,
      consumers: 0,
      settled: false,
    };
    created.promise = run(controller.signal).finally(() => {
      created.settled = true;
      if (sharedRequests.get(key) === created) sharedRequests.delete(key);
    });
    // The request may fail; each consumer attaches its own handler. This keeps the shared
    // promise from being reported as unhandled when the last consumer left early.
    void created.promise.catch(() => {});
    sharedRequests.set(key, created);
    entry = created;
  }
  const joined = entry;
  joined.consumers += 1;
  let left = false;
  return {
    promise: joined.promise,
    leave() {
      if (left) return;
      left = true;
      joined.consumers -= 1;
      if (joined.consumers > 0 || joined.settled) return;
      // Defer: React runs an effect's cleanup and its replacement synchronously in one
      // commit, so a re-evaluated effect re-joins this request before the abort fires. Only
      // a real unmount (or a place change) with no consumers left cancels it.
      queueMicrotask(() => {
        if (joined.consumers > 0 || joined.settled) return;
        joined.controller.abort();
        if (sharedRequests.get(key) === joined) sharedRequests.delete(key);
      });
    },
  };
}

/* -------------------------------------------------------------- client fetch */

function mapNativeFailure(error: unknown): WeatherError {
  if (error instanceof NativeTransportError) {
    switch (error.kind) {
      case "timeout":
        return new WeatherError("timeout");
      case "rate":
        return new WeatherError("rate");
      case "input":
        return new WeatherError("input");
      case "network":
      case "offline":
        return new WeatherError("network");
      default:
        return new WeatherError("provider");
    }
  }
  if ((error as { name?: unknown } | null)?.name === "AbortError")
    return new WeatherError("cancelled");
  return new WeatherError("network");
}

function readResponsePayload(payload: unknown): WeatherSnapshot {
  if (!isRecord(payload)) throw new WeatherError("invalid");
  if (payload["ok"] !== true) {
    const kind = payload["kind"];
    const allowed: readonly WeatherErrorKind[] = [
      "input",
      "network",
      "timeout",
      "rate",
      "invalid",
      "provider",
    ];
    if (typeof kind === "string" && (allowed as readonly string[]).includes(kind))
      throw new WeatherError(kind as WeatherErrorKind);
    throw new WeatherError("provider");
  }
  const snapshot = parseWeatherSnapshot(payload["snapshot"]);
  if (!snapshot) throw new WeatherError("invalid");
  return snapshot;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new WeatherError("invalid");
  }
}

/**
 * One forecast request to our own route. The native app uses its versioned endpoint
 * through the existing cross-origin transport (origin-gated on the server); the browser
 * uses the same-origin route. Both carry only rounded coordinates and a bounded body.
 */
async function requestSnapshot(
  latitude: number,
  longitude: number,
  units: WeatherUnits,
  language: WeatherLanguage,
  signal: AbortSignal,
): Promise<WeatherSnapshot> {
  const body = JSON.stringify({ latitude, longitude, units, lang: language });
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const deadline = withDeadline(signal, CLIENT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response =
        isNativeApp() && typeof window !== "undefined"
          ? await nativeRequest("/api/native/v1/weather", {
              method: "POST",
              headers,
              body,
              timeoutMs: CLIENT_TIMEOUT_MS,
              signal: deadline.signal,
            })
          : await fetch("/api/weather", {
              method: "POST",
              headers,
              body,
              signal: deadline.signal,
            });
    } catch (error) {
      throw isNativeApp()
        ? mapNativeFailure(error)
        : classifyWeatherFailure(error, deadline, signal);
    }
    const payload = await readJson(response);
    if (!response.ok && !isRecord(payload)) throw new WeatherError("provider");
    return readResponsePayload(payload);
  } finally {
    deadline.dispose();
  }
}

/* ---------------------------------------------------------------------- hook */

export function useWeather(options: UseWeatherOptions): UseWeatherResult {
  const { place, language, enabled = true, deferRefresh = false } = options;
  const latitude = place ? roundCoordinate(place.latitude) : null;
  const longitude = place ? roundCoordinate(place.longitude) : null;

  // The preference is read once per mount; the first client render may already show it.
  // (SSR renders no snapshot, so the unit label is not part of the hydration markup.)
  const [units, setUnitsState] = useState<WeatherUnits>(() => readUnitsPreference());
  const [state, setState] = useState<InternalState>(IDLE);
  const [offline, setOfflineState] = useState<boolean>(() => isOffline());
  /** Bumped by focus/visibility/online/manual retry: re-evaluates freshness. */
  const [nonce, setNonce] = useState(0);
  const forceRef = useRef(false);
  const generation = useRef(0);
  const snapshotRef = useRef<WeatherSnapshot | null>(null);

  const requestCheck = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const token = ++generation.current;
    const forced = forceRef.current;
    forceRef.current = false;
    let cancelled = false;
    let activeRequest: { leave: () => void } | null = null;

    if (!enabled || latitude === null || longitude === null) {
      snapshotRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with the cached device store
      setState((current) => (current === IDLE ? current : IDLE));
      return () => {
        cancelled = true;
        activeRequest?.leave();
      };
    }

    const cacheKey = weatherCacheKey(latitude, longitude, units);
    const memorySnapshot = snapshotRef.current;
    const reusableMemory =
      memorySnapshot &&
      samePlace(memorySnapshot.place, latitude, longitude) &&
      memorySnapshot.units === units
        ? memorySnapshot
        : memorySnapshot &&
            samePlace(memorySnapshot.place, latitude, longitude) &&
            memorySnapshot.units !== units
          ? convertSnapshotUnits(memorySnapshot, units)
          : null;
    const cached = readCachedSnapshot(latitude, longitude, units);
    const shown = newest(reusableMemory, cached);
    const isFresh = shown ? weatherIsFresh(shown) : false;

    // Keep the chosen snapshot as this hook's memory too, so a units toggle can convert it
    // immediately even when it was hydrated from the cache (never fetched this session).
    snapshotRef.current = shown;
    if (shown) {
      setState((current) =>
        current.snapshot === shown && current.error === null
          ? current
          : { ...current, snapshot: shown, error: null },
      );
    } else {
      setState((current) => (current.snapshot === null ? current : { ...current, snapshot: null }));
    }

    if (!forced && isFresh) return () => {};
    if (deferRefresh && !forced) return () => {};

    setState((current) => ({
      ...current,
      loading: shown === null,
      refreshing: shown !== null,
      error: null,
    }));
    const key = `${cacheKey}|${language}`;
    const joined = joinRequest(key, (signal) =>
      requestSnapshot(latitude, longitude, units, language, signal),
    );
    activeRequest = joined;
    joined.promise
      .then((snapshot) => {
        if (cancelled || token !== generation.current) return;
        snapshotRef.current = snapshot;
        setState({ snapshot, error: null, loading: false, refreshing: false });
        setOfflineState(false);
        void writeCachedSnapshot(snapshot).catch(() => false);
      })
      .catch((error: unknown) => {
        if (cancelled || token !== generation.current) return;
        const kind = weatherErrorKind(error);
        if (kind === "cancelled") return;
        setState((current) => ({
          ...current,
          error: kind,
          loading: false,
          refreshing: false,
        }));
        if (kind === "network") setOfflineState(isOffline());
      })
      .finally(() => {
        joined.leave();
      });
    return () => {
      cancelled = true;
      joined.leave();
    };
  }, [latitude, longitude, units, language, enabled, deferRefresh, nonce]);

  useEffect(() => {
    // Visibility is the only automatic revalidation trigger (A04: no polling, nothing while
    // the surface is hidden). Network recovery is also honoured — it is a state change, not
    // a timer. A composer-active surface is deferred by `deferRefresh`.
    const onVisible = () => {
      if (!enabled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      requestCheck();
    };
    const onOnline = () => {
      setOfflineState(false);
      requestCheck();
    };
    const onOffline = () => setOfflineState(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, requestCheck]);

  const setUnits = useCallback((next: WeatherUnits) => {
    if (!isWeatherUnits(next)) return;
    setUnitsState(next);
    void writeUnitsPreference(next).catch(() => false);
  }, []);

  const refresh = useCallback(() => {
    forceRef.current = true;
    requestCheck();
  }, [requestCheck]);

  const clear = useCallback(() => {
    generation.current += 1;
    snapshotRef.current = null;
    setState(IDLE);
    void clearCachedSnapshots().catch(() => false);
  }, []);

  const raw = state.snapshot;
  const relevant =
    place &&
    latitude !== null &&
    longitude !== null &&
    raw &&
    samePlace(raw.place, latitude, longitude)
      ? raw
      : null;
  const snapshot = useMemo(
    () => (relevant && place ? withPlaceLabels(relevant, place) : relevant),
    [relevant, place],
  );

  // The clock is read in an effect, never during render: freshness is a measured age, and
  // render must stay pure. The dependency list refreshes it whenever what is shown or the
  // surface's attention state changes.
  const [freshness, setFreshness] = useState<WeatherFreshness | null>(null);
  useEffect(() => {
    if (!snapshot) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- age is measured from the clock in an effect, never during render
      setFreshness((current) => (current === null ? current : null));
      return;
    }
    const now = Date.now();
    const ageMs = Math.max(0, now - snapshot.fetchedAt);
    const next: WeatherFreshness = {
      ageMs,
      // "Refresh due" honours a provider-declared expiry as well as our own window.
      isStale: !weatherIsFresh(snapshot, now),
      // Past the useful life: the UI must not present it as current conditions.
      isExpired: ageMs >= WEATHER_STALE_MS,
    };
    setFreshness((current) =>
      current && current.ageMs === next.ageMs && current.isStale === next.isStale ? current : next,
    );
  }, [snapshot, nonce]);

  let status: WeatherStatus;
  if (!enabled || !place) status = "idle";
  else if (snapshot) status = "ready";
  else if (state.loading || state.refreshing) status = "loading";
  else if (state.error) status = "error";
  else status = "idle";

  return {
    status,
    snapshot,
    freshness,
    refreshing: state.refreshing,
    error: state.error,
    offline,
    units,
    setUnits,
    refresh,
    clear,
  };
}
