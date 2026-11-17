/**
 * Location acquisition for the weather strip: explicit consent, a coarse fix and the
 * privacy seatbelt around it.
 *
 * The rules this module exists to enforce:
 *
 * 1. **No geolocation without explicit consent.** The state machine starts in
 *    `prompt`; only the hook's user-initiated `enableLocation()` calls
 *    `getCurrentPosition`. Nothing here runs on load.
 * 2. **Coarse means coarse.** The browser is asked for a network-level fix
 *    (`enableHighAccuracy: false`, five-minute `maximumAge`, 12 s timeout), so a cached
 *    or cheap fix is preferred; there is no `watchPosition` and no background tracking.
 *    The fix is quantized to two decimals (~1 km) inside `currentCoarseFix` and the raw
 *    value never escapes that function.
 * 3. **Only the coarse place is kept.** The stored record is
 *    `{ v, source, place { id, name, 2dp lat/lon, timeZone, … } }`; no raw fix, no
 *    accuracy, no timestamp and no history. A revocation clears it.
 * 4. **The only place that touches the geolocation API.** The weather UI consumes the
 *    hook, never `navigator.geolocation` directly.
 */

import { readDeviceValue, removeDeviceValue, writeDeviceValue } from "@/lib/persistence/settings";
import {
  coarseCoordinates,
  placeIdentity,
  sanitizePlace,
  type PlaceErrorKind,
  type WeatherPlaceCandidate,
} from "./geocode";
import type { WeatherPlace } from "./types";

/** Persisted coarse place. The `lingua.` prefix keeps it inside the app's own namespace. */
export const LOCATION_PLACE_KEY = "lingua.weather.place.v1";
/** Sticky in-app opt-out; cleared only by an explicit consent action. */
export const LOCATION_REVOKED_KEY = "lingua.weather.location.revoked.v1";
export const STORED_PLACE_VERSION = 1;

/** A cached network fix is fine for weather; five minutes never hides a moved person. */
export const COARSE_MAXIMUM_AGE_MS = 5 * 60_000;
/** Bounded wait: a device with no usable fix falls back to manual search calmly. */
export const COARSE_TIMEOUT_MS = 12_000;
export const COARSE_POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: COARSE_MAXIMUM_AGE_MS,
  timeout: COARSE_TIMEOUT_MS,
};

/* ------------------------------------------------------------------- states */

export type LocationStatus = "unsupported" | "denied" | "prompt" | "granted" | "manual" | "revoked";

/** Why the current status is what it is; the UI maps this to calm copy. */
export type LocationReason =
  | "not-requested"
  | "restored"
  | "fix-acquired"
  | "city-selected"
  | "permission-denied"
  | "position-unavailable"
  | "timeout"
  | "geocode-failed"
  | "geocode-not-found"
  | "unsupported-api"
  | "insecure-context"
  | "user-revoked"
  | "permission-revoked";

export type LocationErrorKind =
  | "permission-denied"
  | "position-unavailable"
  | "timeout"
  | "unsupported"
  | "geocode-failed"
  | "geocode-not-found"
  | "rate"
  | "network"
  | "invalid-query"
  | "aborted";

export interface LocationError {
  readonly kind: LocationErrorKind;
}

export type LocationPhase = "idle" | "locating" | "resolving";

export interface LocationState {
  readonly status: LocationStatus;
  readonly reason: LocationReason;
  readonly place: WeatherPlace | null;
  readonly error: LocationError | null;
  readonly phase: LocationPhase;
}

export const INITIAL_LOCATION_STATE: LocationState = {
  status: "prompt",
  reason: "not-requested",
  place: null,
  error: null,
  phase: "idle",
};

export type LocationRevocation = "user" | "permission";

function unsupportedState(secureContext: boolean): LocationState {
  return {
    status: "unsupported",
    reason: secureContext ? "unsupported-api" : "insecure-context",
    place: null,
    error: null,
    phase: "idle",
  };
}

function revokedState(by: LocationRevocation): LocationState {
  return {
    status: "revoked",
    reason: by === "user" ? "user-revoked" : "permission-revoked",
    place: null,
    error: null,
    phase: "idle",
  };
}

export function reasonForError(kind: LocationErrorKind): LocationReason {
  switch (kind) {
    case "permission-denied":
      return "permission-denied";
    case "position-unavailable":
      return "position-unavailable";
    case "timeout":
      return "timeout";
    case "unsupported":
      return "unsupported-api";
    case "geocode-failed":
      return "geocode-failed";
    case "geocode-not-found":
      return "geocode-not-found";
    case "rate":
    case "network":
      return "geocode-failed";
    // These two never become a persistent reason: a cancelled or malformed search does
    // not change the location mode. The mapping exists only for switch exhaustiveness.
    case "invalid-query":
    case "aborted":
      return "not-requested";
  }
}

/** Maps the geocode client's failure kinds onto this layer's state error kinds. */
export function locationErrorForPlaceFailure(kind: PlaceErrorKind): LocationErrorKind {
  switch (kind) {
    case "rate":
      return "rate";
    case "network":
      return "network";
    case "timeout":
      return "timeout";
    case "input":
    case "provider":
      return "geocode-failed";
    case "aborted":
      return "aborted";
  }
}

/* --------------------------------------------------------------- state machine */

export type LocationEvent =
  | { readonly type: "consent" }
  | { readonly type: "fix-acquired" }
  | { readonly type: "resolved"; readonly place: WeatherPlace }
  | { readonly type: "failed"; readonly error: LocationError; readonly fixAcquired: boolean }
  | { readonly type: "manual"; readonly place: WeatherPlace }
  | {
      readonly type: "cleared";
      readonly revoked: LocationRevocation | null;
      readonly supported: boolean;
      readonly secureContext: boolean;
    }
  | { readonly type: "revoked"; readonly by: LocationRevocation }
  | { readonly type: "unsupported"; readonly secureContext: boolean }
  | { readonly type: "cancelled" };

/**
 * The whole consent machine in one pure function. A permission request is only ever
 * triggered outside this reducer by the hook's explicit `enableLocation()`; the reducer
 * itself has no side effects, so the transition table is deterministic and testable.
 */
export function locationReducer(state: LocationState, event: LocationEvent): LocationState {
  switch (event.type) {
    case "consent":
      return { ...state, phase: "locating", error: null };
    case "fix-acquired":
      return { ...state, phase: "resolving" };
    case "resolved":
      return {
        status: "granted",
        reason: "fix-acquired",
        place: event.place,
        error: null,
        phase: "idle",
      };
    case "failed": {
      const reason = reasonForError(event.error.kind);
      // A displayed place (manual or restored) stays displayed on a failed refresh: the
      // failure explains why the device path did not replace it, it does not erase it.
      if (state.place) return { ...state, reason, error: event.error, phase: "idle" };
      if (event.fixAcquired && event.error.kind !== "permission-denied") {
        return {
          status: "granted",
          reason,
          place: null,
          error: event.error,
          phase: "idle",
        };
      }
      return { status: "denied", reason, place: null, error: event.error, phase: "idle" };
    }
    case "manual":
      return {
        status: "manual",
        reason: "city-selected",
        place: event.place,
        error: null,
        phase: "idle",
      };
    case "cleared": {
      if (event.revoked) return revokedState(event.revoked);
      if (!event.supported || !event.secureContext) return unsupportedState(event.secureContext);
      return INITIAL_LOCATION_STATE;
    }
    case "revoked":
      return revokedState(event.by);
    case "unsupported":
      return unsupportedState(event.secureContext);
    case "cancelled":
      return { ...state, phase: "idle", error: null };
  }
}

/* ----------------------------------------------------------------- hydration */

export type PermissionInfo = "granted" | "denied" | "prompt" | "unknown";

export interface LocationEnvironment {
  readonly supported: boolean;
  readonly secureContext: boolean;
  readonly permission: PermissionInfo;
  /** A validated stored place, if this device has one. */
  readonly stored: StoredPlace | null;
  /** A sticky in-app opt-out, if the person revoked location on this device. */
  readonly revoked: LocationRevocation | null;
}

/**
 * Decides the state on first paint in the browser. It never prompts: the stored place is
 * reused, an explicit denial/revocation is surfaced as such, and everything else waits
 * for the person to press "use my location".
 */
export function hydrateLocationState(env: LocationEnvironment): LocationState {
  if (env.stored) {
    const place = env.stored.place;
    if (env.stored.source === "manual") {
      return { status: "manual", reason: "restored", place, error: null, phase: "idle" };
    }
    if (env.permission === "denied" || env.revoked) {
      // A stored GPS-derived place is location data the person withdrew; it must not be
      // displayed. The hook clears the record; this branch is the display decision.
      return revokedState(env.revoked ?? "permission");
    }
    return { status: "granted", reason: "restored", place, error: null, phase: "idle" };
  }
  if (env.revoked) return revokedState(env.revoked);
  if (!env.supported || !env.secureContext) return unsupportedState(env.secureContext);
  if (env.permission === "denied") {
    return {
      status: "denied",
      reason: "permission-denied",
      place: null,
      error: null,
      phase: "idle",
    };
  }
  return INITIAL_LOCATION_STATE;
}

/* ------------------------------------------------------------ geolocation API */

export interface GeolocationPositionLike {
  readonly coords: {
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracy?: number;
  };
}

export interface GeolocationErrorLike {
  readonly code: number;
  readonly message?: string;
}

/** The narrow API this layer may use: one shot, no watch, no background updates. */
export interface GeolocationLike {
  getCurrentPosition(
    success: (position: GeolocationPositionLike) => void,
    error?: (error: GeolocationErrorLike) => void,
    options?: PositionOptions,
  ): void;
}

/** A rounded fix. The raw browser position is quantized before this object exists. */
export interface CoarseFix {
  readonly latitude: number;
  readonly longitude: number;
}

export type LocationFixErrorKind =
  "permission-denied" | "position-unavailable" | "timeout" | "unsupported" | "aborted";

export class LocationFailure extends Error {
  constructor(readonly kind: LocationFixErrorKind) {
    super(kind);
    this.name = "LocationFailure";
  }
}

export function currentGeolocation(): GeolocationLike | null {
  if (typeof navigator === "undefined") return null;
  const geolocation = (navigator as unknown as { geolocation?: GeolocationLike }).geolocation;
  return geolocation && typeof geolocation.getCurrentPosition === "function" ? geolocation : null;
}

export interface LocationSupport {
  readonly supported: boolean;
  readonly secureContext: boolean;
}

/** Uses the injected geolocation when a test/alternate shell supplies one. */
export function detectLocationSupport(
  injected?: GeolocationLike | null | undefined,
): LocationSupport {
  if (typeof window === "undefined") return { supported: false, secureContext: false };
  const secureContext = typeof window.isSecureContext === "boolean" ? window.isSecureContext : true;
  const geolocation = injected === undefined ? currentGeolocation() : injected;
  return {
    supported: !!geolocation && typeof geolocation.getCurrentPosition === "function",
    secureContext,
  };
}

export function mapGeolocationError(
  error: GeolocationErrorLike | null | undefined,
): LocationFixErrorKind {
  switch (error?.code) {
    case 1:
      return "permission-denied";
    case 2:
      return "position-unavailable";
    case 3:
      return "timeout";
    default:
      return "position-unavailable";
  }
}

/**
 * One coarse fix. The success callback quantizes immediately and discards the raw
 * position and its accuracy, so no precise value ever leaves this function.
 */
export function currentCoarseFix(
  geolocation: GeolocationLike | null | undefined,
  overrides: PositionOptions = {},
): Promise<CoarseFix> {
  return new Promise((resolve, reject) => {
    if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
      reject(new LocationFailure("unsupported"));
      return;
    }
    // Coarse is the default and cannot be overridden into a precise request.
    const options: PositionOptions = {
      ...COARSE_POSITION_OPTIONS,
      ...overrides,
      enableHighAccuracy: false,
    };
    try {
      geolocation.getCurrentPosition(
        (position) => {
          const coordinates = coarseCoordinates(
            position?.coords?.latitude,
            position?.coords?.longitude,
          );
          if (!coordinates) {
            reject(new LocationFailure("position-unavailable"));
            return;
          }
          resolve(coordinates);
        },
        (error) => reject(new LocationFailure(mapGeolocationError(error))),
        options,
      );
    } catch {
      reject(new LocationFailure("position-unavailable"));
    }
  });
}

/* ------------------------------------------------------------ permissions API */

export interface PermissionStatusLike {
  readonly state: string;
  addEventListener?: ((type: "change", listener: () => void) => void) | undefined;
  removeEventListener?: ((type: "change", listener: () => void) => void) | undefined;
}

export interface PermissionsLike {
  query(descriptor: { name: "geolocation" }): Promise<PermissionStatusLike>;
}

export function normalizePermissionState(state: unknown): PermissionInfo {
  return state === "granted" || state === "denied" || state === "prompt" ? state : "unknown";
}

function resolvePermissions(permissions?: PermissionsLike | null): PermissionsLike | null {
  if (permissions !== undefined) return permissions;
  if (typeof navigator === "undefined") return null;
  const api = (navigator as unknown as { permissions?: PermissionsLike }).permissions;
  return api && typeof api.query === "function" ? api : null;
}

/** Reads the current permission without prompting (unknown where the API is absent). */
export async function readGeolocationPermission(
  permissions?: PermissionsLike | null,
): Promise<PermissionInfo> {
  const api = resolvePermissions(permissions);
  if (!api) return "unknown";
  try {
    const status = await api.query({ name: "geolocation" });
    return normalizePermissionState(status?.state);
  } catch {
    return "unknown";
  }
}

/**
 * Watches for a permission change (a revocation from the browser/OS settings) and reports
 * the initial state as well. Returns an unsubscribe function; never prompts.
 */
export function observeGeolocationPermission(
  permissions: PermissionsLike | null | undefined,
  onChange: (state: PermissionInfo) => void,
): () => void {
  const api = resolvePermissions(permissions);
  if (!api) return () => {};
  let disposed = false;
  let status: PermissionStatusLike | null = null;
  const emit = (): void => {
    if (disposed || !status) return;
    onChange(normalizePermissionState(status.state));
  };
  const handle = (): void => emit();
  Promise.resolve()
    .then(() => api.query({ name: "geolocation" }))
    .then((next) => {
      if (disposed || !next) return;
      status = next;
      next.addEventListener?.("change", handle);
      emit();
    })
    .catch(() => {});
  return () => {
    disposed = true;
    status?.removeEventListener?.("change", handle);
    status = null;
  };
}

/* ---------------------------------------------------------- display place */

/**
 * An honest placeholder for a coarse fix when the server could not name the locality.
 * No city is guessed: the label is the rounded coordinate pair and the id is A06's
 * documented weather-cache identity for those coordinates.
 */
export function coordinatePlace(
  latitude: number,
  longitude: number,
  options: { readonly timeZone?: string | undefined } = {},
): WeatherPlace | null {
  const coordinates = coarseCoordinates(latitude, longitude);
  if (!coordinates) return null;
  const timeZone = options.timeZone?.trim() || deviceTimeZone();
  return sanitizePlace({
    id: placeIdentity(coordinates.latitude, coordinates.longitude),
    name: `${coordinates.latitude.toFixed(2)}, ${coordinates.longitude.toFixed(2)}`,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    timeZone,
    source: "geolocation",
  });
}

/** The device's IANA zone for the coordinate fallback; the forecast snapshot stays authoritative. */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === "string" && zone.trim()) return zone.trim().slice(0, 64);
  } catch {
    /* fall through */
  }
  return "UTC";
}

/** Marks how a place was chosen without inventing fields the source did not supply. */
export function placeWithSource(
  place: WeatherPlace,
  source: NonNullable<WeatherPlace["source"]>,
): WeatherPlace {
  return { ...place, source };
}

/* --------------------------------------------------------------- persistence */

export type StoredPlaceSource = "gps" | "manual";

export interface StoredPlace {
  readonly v: typeof STORED_PLACE_VERSION;
  readonly source: StoredPlaceSource;
  readonly place: WeatherPlace;
}

/**
 * Validates a stored record. Coordinates are re-quantized on read: an older/tampered
 * record can never reintroduce a precise fix into memory.
 */
export function parseStoredPlace(raw: unknown): StoredPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record["v"] !== STORED_PLACE_VERSION) return null;
  const source = record["source"];
  if (source !== "gps" && source !== "manual") return null;
  const place = sanitizePlace(record["place"]);
  if (!place) return null;
  return { v: STORED_PLACE_VERSION, source, place };
}

function readJson(key: string): unknown {
  const raw = readDeviceValue(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function readStoredPlace(): StoredPlace | null {
  if (typeof window === "undefined") return null;
  return parseStoredPlace(readJson(LOCATION_PLACE_KEY));
}

/** Writes only the validated, rounded record; returns whether the device kept it. */
export async function writeStoredPlace(value: StoredPlace): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const place = sanitizePlace(value.place);
  if (!place) return false;
  const stored: StoredPlace = { v: STORED_PLACE_VERSION, source: value.source, place };
  return writeDeviceValue(LOCATION_PLACE_KEY, JSON.stringify(stored));
}

export async function clearStoredPlace(): Promise<void> {
  if (typeof window === "undefined") return;
  await removeDeviceValue(LOCATION_PLACE_KEY);
}

export function parseLocationRevocation(raw: string | null): LocationRevocation | null {
  return raw === "user" || raw === "permission" ? raw : null;
}

export function readLocationRevocation(): LocationRevocation | null {
  if (typeof window === "undefined") return null;
  return parseLocationRevocation(readDeviceValue(LOCATION_REVOKED_KEY));
}

export async function writeLocationRevocation(value: LocationRevocation): Promise<boolean> {
  return writeDeviceValue(LOCATION_REVOKED_KEY, value);
}

export async function clearLocationRevocation(): Promise<void> {
  await removeDeviceValue(LOCATION_REVOKED_KEY);
}

/** The stored-place envelope for a resolved device location. */
export function gpsStoredPlace(place: WeatherPlace): StoredPlace {
  return { v: STORED_PLACE_VERSION, source: "gps", place: placeWithSource(place, "geolocation") };
}

/** The stored-place envelope for a manually chosen place. */
export function manualStoredPlace(candidate: WeatherPlaceCandidate): StoredPlace | null {
  const place = sanitizePlace(candidate);
  if (!place) return null;
  return { v: STORED_PLACE_VERSION, source: "manual", place: placeWithSource(place, "search") };
}
