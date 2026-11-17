/**
 * React binding for the location layer: explicit-consent state, coarse device location,
 * localized manual place search and the persisted place.
 *
 * The hook is deliberately inert on mount: it reads the stored coarse place, the sticky
 * revocation marker and the (non-prompting) permission state, but it never calls
 * `getCurrentPosition` until a person invokes `enableLocation()` from a real gesture.
 * Denied, revoked and unsupported all leave `searchCity` available, because a manual
 * place is always a valid fallback.
 *
 * Integration (owned by the lead): pass `language` from the UI locale, render the
 * consent/denied/revoked/unsupported states from `status` + `reason`, and feed
 * `place` to A06's `useWeather(place)`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPlaceClient,
  normalizePlaceQuery,
  PlaceError,
  type PlaceClient,
  type PlaceErrorKind,
  type PlaceLanguage,
  type WeatherPlaceCandidate,
} from "./geocode";
import {
  clearLocationRevocation,
  clearStoredPlace,
  coordinatePlace,
  currentCoarseFix,
  detectLocationSupport,
  gpsStoredPlace,
  hydrateLocationState,
  INITIAL_LOCATION_STATE,
  LocationFailure,
  locationErrorForPlaceFailure,
  locationReducer,
  manualStoredPlace,
  observeGeolocationPermission,
  placeWithSource,
  readGeolocationPermission,
  readLocationRevocation,
  readStoredPlace,
  writeLocationRevocation,
  writeStoredPlace,
  type GeolocationLike,
  type LocationError,
  type LocationErrorKind,
  type LocationReason,
  type LocationState,
  type LocationStatus,
  type PermissionsLike,
} from "./location";
import type { WeatherPlace } from "./types";

export type WeatherLocationPending = "none" | "locating" | "searching";

export interface PlaceSearchSuccess {
  readonly ok: true;
  readonly places: WeatherPlaceCandidate[];
}
export interface PlaceSearchFailure {
  readonly ok: false;
  readonly error: { readonly kind: PlaceErrorKind };
}
export type PlaceSearchResult = PlaceSearchSuccess | PlaceSearchFailure;

export interface WeatherLocationOptions {
  /** Interface language for localized place labels (ar/de/en). Defaults to English. */
  readonly language?: PlaceLanguage | undefined;
  /** Injected for tests and alternate shells; defaults to the browser API at call time. */
  readonly geolocation?: GeolocationLike | null | undefined;
  /** Injected for tests; defaults to `navigator.permissions` at effect time. */
  readonly permissions?: PermissionsLike | null | undefined;
  /** Injected for tests; defaults to the same-origin server route client. */
  readonly placeClient?: PlaceClient | undefined;
}

export interface WeatherLocation {
  readonly status: LocationStatus;
  readonly reason: LocationReason;
  readonly place: WeatherPlace | null;
  readonly error: LocationError | null;
  readonly pending: WeatherLocationPending;
  /** False when this context cannot request a device fix at all (manual search still works). */
  readonly supported: boolean;
  /** True when an explicit consent action can be offered right now. */
  readonly canEnable: boolean;
  /** The only function that may request geolocation: call it from a real user gesture. */
  enableLocation(): Promise<void>;
  /** Aborts any in-flight locate or search without changing the current place. */
  cancel(): void;
  /** Localized forward search; never rejects. */
  searchCity(query: string): Promise<PlaceSearchResult>;
  /** Persists a chosen coarse place; the device location is not requested. */
  chooseCity(candidate: WeatherPlaceCandidate): Promise<void>;
  /** Removes the stored place (keeps the revocation marker, if any). */
  clearPlace(): Promise<void>;
  /** Clears the stored place and aborts in-flight work; the person opted out. */
  revokeLocation(): Promise<void>;
}

function normalizeLanguage(language: PlaceLanguage | undefined): PlaceLanguage {
  return language === "ar" || language === "de" || language === "en" ? language : "en";
}

function resolveGeolocation(
  geolocation: GeolocationLike | null | undefined,
): GeolocationLike | null {
  if (geolocation !== undefined) return geolocation;
  if (typeof navigator === "undefined") return null;
  const api = (navigator as unknown as { geolocation?: GeolocationLike }).geolocation;
  return api && typeof api.getCurrentPosition === "function" ? api : null;
}

function fixFailureKind(error: unknown): LocationErrorKind {
  if (error instanceof LocationFailure) return error.kind;
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "AbortError") return "aborted";
  return "position-unavailable";
}

function placeFailureKind(error: unknown): PlaceErrorKind {
  return error instanceof PlaceError ? error.kind : "provider";
}

export function useWeatherLocation(options: WeatherLocationOptions = {}): WeatherLocation {
  const [state, setState] = useState<LocationState>(INITIAL_LOCATION_STATE);
  const [searching, setSearching] = useState(false);

  // One client for the life of the hook; injections are for tests, never for production.
  const [client] = useState<PlaceClient>(() => options.placeClient ?? createPlaceClient());
  const language = normalizeLanguage(options.language);
  const languageRef = useRef<PlaceLanguage>(language);
  const injectedGeolocation = options.geolocation;
  const permissions = options.permissions;

  const locateOperation = useRef(0);
  const searchOperation = useRef(0);
  const locateAbort = useRef<AbortController | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const disposed = useRef(false);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    disposed.current = false;
    let active = true;
    const support = detectLocationSupport(injectedGeolocation);
    const stored = readStoredPlace();
    const revoked = readLocationRevocation();
    if (stored?.source === "gps" && revoked) void clearStoredPlace();

    void (async () => {
      const permission = await readGeolocationPermission(permissions);
      if (!active) return;
      // A user action that already started must win over a late hydration read.
      if (locateOperation.current !== 0 || searchOperation.current !== 0) return;
      const hiddenGps = stored?.source === "gps" && (revoked !== null || permission === "denied");
      const next = hydrateLocationState({
        supported: support.supported,
        secureContext: support.secureContext,
        permission,
        stored: stored && !hiddenGps ? stored : null,
        revoked,
      });
      if (next.status === "revoked" && stored?.source === "gps") {
        await clearStoredPlace();
        if (!active) return;
      }
      setState(next);
    })();

    // A browser/OS revocation is a withdrawal of consent: drop the derived place and
    // surface it as revoked instead of silently keeping the last location on screen.
    const stop = observeGeolocationPermission(permissions, (permission) => {
      if (!active || permission !== "denied") return;
      const current = readStoredPlace();
      if (!current || current.source !== "gps") return;
      void clearStoredPlace();
      void writeLocationRevocation("permission");
      setState((prev) => locationReducer(prev, { type: "revoked", by: "permission" }));
    });

    return () => {
      active = false;
      disposed.current = true;
      locateOperation.current += 1;
      searchOperation.current += 1;
      locateAbort.current?.abort();
      searchAbort.current?.abort();
      locateAbort.current = null;
      searchAbort.current = null;
      stop();
    };
  }, [injectedGeolocation, permissions]);

  const enableLocation = useCallback(async (): Promise<void> => {
    if (disposed.current) return;
    const support = detectLocationSupport(injectedGeolocation);
    if (!support.supported || !support.secureContext) {
      setState((prev) =>
        locationReducer(prev, { type: "unsupported", secureContext: support.secureContext }),
      );
      return;
    }
    const operation = ++locateOperation.current;
    locateAbort.current?.abort();
    const controller = new AbortController();
    locateAbort.current = controller;
    setState((prev) => locationReducer(prev, { type: "consent" }));
    const current = (): boolean =>
      !disposed.current && operation === locateOperation.current && !controller.signal.aborted;
    try {
      // Explicit consent is the only thing that clears this device's opt-out.
      await clearLocationRevocation();
      const fix = await currentCoarseFix(resolveGeolocation(injectedGeolocation));
      if (!current()) return;
      setState((prev) => locationReducer(prev, { type: "fix-acquired" }));
      let namedPlaces: WeatherPlace[] = [];
      try {
        namedPlaces = await client.reverse(
          fix.latitude,
          fix.longitude,
          languageRef.current,
          controller.signal,
        );
      } catch (error) {
        if (!current()) return;
        const kind = placeFailureKind(error);
        if (kind === "aborted") return;
        setState((prev) =>
          locationReducer(prev, {
            type: "failed",
            error: { kind: locationErrorForPlaceFailure(kind) },
            fixAcquired: true,
          }),
        );
        return;
      }
      if (!current()) return;
      // Server reverse geocoding names the locality when it can; otherwise the honest
      // coordinate label is the floor. No city is ever invented.
      const named = namedPlaces[0];
      const place = named
        ? placeWithSource(named, "geolocation")
        : coordinatePlace(fix.latitude, fix.longitude);
      if (!place) {
        setState((prev) =>
          locationReducer(prev, {
            type: "failed",
            error: { kind: "geocode-failed" },
            fixAcquired: true,
          }),
        );
        return;
      }
      await writeStoredPlace(gpsStoredPlace(place));
      if (!current()) return;
      setState((prev) => locationReducer(prev, { type: "resolved", place }));
    } catch (error) {
      if (!current()) return;
      const kind = fixFailureKind(error);
      if (kind === "aborted") return;
      if (kind === "permission-denied") {
        const stored = readStoredPlace();
        if (stored?.source === "gps") {
          await clearStoredPlace();
          await writeLocationRevocation("permission");
          if (!current()) return;
          setState((prev) => locationReducer(prev, { type: "revoked", by: "permission" }));
          return;
        }
      }
      setState((prev) =>
        locationReducer(prev, { type: "failed", error: { kind }, fixAcquired: false }),
      );
    } finally {
      if (operation === locateOperation.current) locateAbort.current = null;
    }
  }, [client, injectedGeolocation]);

  const cancel = useCallback((): void => {
    locateOperation.current += 1;
    searchOperation.current += 1;
    locateAbort.current?.abort();
    searchAbort.current?.abort();
    locateAbort.current = null;
    searchAbort.current = null;
    if (!disposed.current) setSearching(false);
    setState((prev) => locationReducer(prev, { type: "cancelled" }));
  }, []);

  const searchCity = useCallback(
    async (query: string): Promise<PlaceSearchResult> => {
      if (disposed.current) return { ok: false, error: { kind: "aborted" } };
      const normalized = normalizePlaceQuery(query);
      if (!normalized) return { ok: false, error: { kind: "input" } };
      const operation = ++searchOperation.current;
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;
      setSearching(true);
      try {
        const places = await client.search(normalized, languageRef.current, controller.signal);
        if (disposed.current || operation !== searchOperation.current) {
          return { ok: false, error: { kind: "aborted" } };
        }
        return { ok: true, places };
      } catch (error) {
        if (error instanceof PlaceError) return { ok: false, error: { kind: error.kind } };
        return {
          ok: false,
          error: { kind: controller.signal.aborted ? "aborted" : "provider" },
        };
      } finally {
        if (operation === searchOperation.current && !disposed.current) {
          setSearching(false);
          searchAbort.current = null;
        }
      }
    },
    [client],
  );

  const chooseCity = useCallback(async (candidate: WeatherPlaceCandidate): Promise<void> => {
    if (disposed.current) return;
    const stored = manualStoredPlace(candidate);
    if (!stored) {
      setState((prev) =>
        locationReducer(prev, {
          type: "failed",
          error: { kind: "geocode-failed" },
          fixAcquired: false,
        }),
      );
      return;
    }
    locateOperation.current += 1;
    locateAbort.current?.abort();
    locateAbort.current = null;
    await writeStoredPlace(stored);
    if (disposed.current) return;
    setState((prev) => locationReducer(prev, { type: "manual", place: stored.place }));
  }, []);

  const clearPlace = useCallback(async (): Promise<void> => {
    if (disposed.current) return;
    locateOperation.current += 1;
    locateAbort.current?.abort();
    locateAbort.current = null;
    await clearStoredPlace();
    if (disposed.current) return;
    const support = detectLocationSupport(injectedGeolocation);
    setState((prev) =>
      locationReducer(prev, {
        type: "cleared",
        revoked: readLocationRevocation(),
        supported: support.supported,
        secureContext: support.secureContext,
      }),
    );
  }, [injectedGeolocation]);

  const revokeLocation = useCallback(async (): Promise<void> => {
    if (disposed.current) return;
    locateOperation.current += 1;
    searchOperation.current += 1;
    locateAbort.current?.abort();
    searchAbort.current?.abort();
    locateAbort.current = null;
    searchAbort.current = null;
    if (!disposed.current) setSearching(false);
    await clearStoredPlace();
    await writeLocationRevocation("user");
    if (disposed.current) return;
    setState((prev) => locationReducer(prev, { type: "revoked", by: "user" }));
  }, []);

  const support = detectLocationSupport(injectedGeolocation);
  const pending: WeatherLocationPending =
    state.phase === "locating" || state.phase === "resolving"
      ? "locating"
      : searching
        ? "searching"
        : "none";

  return {
    status: state.status,
    reason: state.reason,
    place: state.place,
    error: state.error,
    pending,
    supported: support.supported,
    canEnable: support.supported && support.secureContext && pending === "none",
    enableLocation,
    cancel,
    searchCity,
    chooseCity,
    clearPlace,
    revokeLocation,
  };
}
