import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COARSE_MAXIMUM_AGE_MS,
  COARSE_POSITION_OPTIONS,
  COARSE_TIMEOUT_MS,
  clearLocationRevocation,
  clearStoredPlace,
  coordinatePlace,
  currentCoarseFix,
  deviceTimeZone,
  detectLocationSupport,
  gpsStoredPlace,
  hydrateLocationState,
  INITIAL_LOCATION_STATE,
  LOCATION_PLACE_KEY,
  LOCATION_REVOKED_KEY,
  LocationFailure,
  locationErrorForPlaceFailure,
  locationReducer,
  manualStoredPlace,
  mapGeolocationError,
  normalizePermissionState,
  observeGeolocationPermission,
  parseLocationRevocation,
  parseStoredPlace,
  placeWithSource,
  readGeolocationPermission,
  readLocationRevocation,
  readStoredPlace,
  reasonForError,
  writeLocationRevocation,
  writeStoredPlace,
  type GeolocationErrorLike,
  type GeolocationLike,
  type GeolocationPositionLike,
  type LocationState,
  type PermissionsLike,
} from "./location";
import type { WeatherPlace } from "./types";

function place(overrides: Partial<WeatherPlace> = {}): WeatherPlace {
  return {
    id: "open-meteo:52.52:13.40",
    name: "Berlin",
    latitude: 52.52,
    longitude: 13.4,
    timeZone: "Europe/Berlin",
    countryCode: "DE",
    ...overrides,
  };
}

interface GeoHarness {
  api: GeolocationLike;
  getCurrentPosition: ReturnType<typeof vi.fn>;
  watchPosition: ReturnType<typeof vi.fn>;
  options: PositionOptions[];
  succeed(latitude: number, longitude: number): void;
  fail(code: number): void;
}

function geoHarness(behavior: { fix?: [number, number]; error?: number } = {}): GeoHarness {
  let success: ((position: GeolocationPositionLike) => void) | null = null;
  let failure: ((error: GeolocationErrorLike) => void) | null = null;
  const options: PositionOptions[] = [];
  const getCurrentPosition = vi.fn(
    (
      onSuccess: (position: GeolocationPositionLike) => void,
      onError?: (error: GeolocationErrorLike) => void,
      positionOptions?: PositionOptions,
    ) => {
      success = onSuccess;
      failure = onError ?? null;
      if (positionOptions) options.push(positionOptions);
      if (behavior.fix) {
        onSuccess({
          coords: {
            latitude: behavior.fix[0],
            longitude: behavior.fix[1],
            accuracy: 5000,
          },
        });
      } else if (behavior.error !== undefined) {
        onError?.({ code: behavior.error });
      }
    },
  );
  const watchPosition = vi.fn();
  const api = { getCurrentPosition, watchPosition } as unknown as GeolocationLike;
  return {
    api,
    getCurrentPosition,
    watchPosition,
    options,
    succeed(latitude, longitude) {
      success?.({ coords: { latitude, longitude } });
    },
    fail(code) {
      failure?.({ code });
    },
  };
}

interface PermissionHarness {
  api: PermissionsLike;
  set(state: "granted" | "denied" | "prompt"): void;
}

function permissionHarness(initial: "granted" | "denied" | "prompt"): PermissionHarness {
  const listeners = new Set<() => void>();
  const current = { value: initial };
  return {
    api: {
      async query() {
        return {
          // A live PermissionStatus: the state getter reflects a later change, exactly
          // like the browser object the app watches for revocation.
          get state() {
            return current.value;
          },
          addEventListener: (_type: "change", listener: () => void) => {
            listeners.add(listener);
          },
          removeEventListener: (_type: "change", listener: () => void) => {
            listeners.delete(listener);
          },
        };
      },
    },
    set(state) {
      current.value = state;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("consent state machine", () => {
  const granted = (): LocationState => ({
    status: "granted",
    reason: "fix-acquired",
    place: place(),
    error: null,
    phase: "idle",
  });

  it("starts in prompt and never locates by itself", () => {
    expect(INITIAL_LOCATION_STATE).toEqual({
      status: "prompt",
      reason: "not-requested",
      place: null,
      error: null,
      phase: "idle",
    });
    expect(locationReducer(INITIAL_LOCATION_STATE, { type: "consent" })).toMatchObject({
      status: "prompt",
      phase: "locating",
    });
    expect(locationReducer(INITIAL_LOCATION_STATE, { type: "fix-acquired" })).toMatchObject({
      phase: "resolving",
    });
  });

  it("resolves a coarse fix to the granted state", () => {
    const state = locationReducer(granted(), { type: "resolved", place: place() });
    expect(state).toMatchObject({ status: "granted", reason: "fix-acquired", place: place() });
  });

  it("keeps a displayed place when a refresh fails and records the reason", () => {
    const manual: LocationState = {
      status: "manual",
      reason: "city-selected",
      place: place({ source: "search" }),
      error: null,
      phase: "idle",
    };
    const state = locationReducer(manual, {
      type: "failed",
      error: { kind: "timeout" },
      fixAcquired: false,
    });
    expect(state).toMatchObject({ status: "manual", place: manual.place, reason: "timeout" });
  });

  it("denies when no place exists and no permission was granted", () => {
    const state = locationReducer(INITIAL_LOCATION_STATE, {
      type: "failed",
      error: { kind: "permission-denied" },
      fixAcquired: false,
    });
    expect(state).toMatchObject({
      status: "denied",
      reason: "permission-denied",
      place: null,
      phase: "idle",
    });
  });

  it("reports a granted permission with a failed geocode as granted plus a reason", () => {
    const state = locationReducer(INITIAL_LOCATION_STATE, {
      type: "failed",
      error: { kind: "geocode-failed" },
      fixAcquired: true,
    });
    expect(state).toMatchObject({
      status: "granted",
      reason: "geocode-failed",
      place: null,
      error: { kind: "geocode-failed" },
    });
  });

  it("moves to manual after a city is chosen", () => {
    const state = locationReducer(INITIAL_LOCATION_STATE, {
      type: "manual",
      place: place({ source: "search" }),
    });
    expect(state).toMatchObject({ status: "manual", reason: "city-selected" });
  });

  it("revokes and clears the place", () => {
    expect(locationReducer(granted(), { type: "revoked", by: "user" })).toMatchObject({
      status: "revoked",
      reason: "user-revoked",
      place: null,
    });
    expect(locationReducer(granted(), { type: "revoked", by: "permission" })).toMatchObject({
      status: "revoked",
      reason: "permission-revoked",
      place: null,
    });
  });

  it("clears back to prompt, unsupported or revoked according to the environment", () => {
    expect(
      locationReducer(granted(), {
        type: "cleared",
        revoked: null,
        supported: true,
        secureContext: true,
      }),
    ).toEqual(INITIAL_LOCATION_STATE);
    expect(
      locationReducer(granted(), {
        type: "cleared",
        revoked: null,
        supported: false,
        secureContext: true,
      }),
    ).toMatchObject({ status: "unsupported", reason: "unsupported-api" });
    expect(
      locationReducer(granted(), {
        type: "cleared",
        revoked: "user",
        supported: true,
        secureContext: true,
      }),
    ).toMatchObject({ status: "revoked", reason: "user-revoked" });
  });

  it("cancels a locating phase without changing the place", () => {
    const locating: LocationState = {
      status: "manual",
      reason: "city-selected",
      place: place({ source: "search" }),
      error: { kind: "network" },
      phase: "locating",
    };
    expect(locationReducer(locating, { type: "cancelled" })).toMatchObject({
      phase: "idle",
      error: null,
      place: locating.place,
    });
  });

  it("maps error kinds and place failures to reasons", () => {
    expect(reasonForError("permission-denied")).toBe("permission-denied");
    expect(reasonForError("position-unavailable")).toBe("position-unavailable");
    expect(reasonForError("timeout")).toBe("timeout");
    expect(reasonForError("unsupported")).toBe("unsupported-api");
    expect(reasonForError("geocode-not-found")).toBe("geocode-not-found");
    expect(reasonForError("rate")).toBe("geocode-failed");
    expect(reasonForError("network")).toBe("geocode-failed");
    expect(locationErrorForPlaceFailure("rate")).toBe("rate");
    expect(locationErrorForPlaceFailure("timeout")).toBe("timeout");
    expect(locationErrorForPlaceFailure("input")).toBe("geocode-failed");
    expect(locationErrorForPlaceFailure("provider")).toBe("geocode-failed");
    expect(locationErrorForPlaceFailure("aborted")).toBe("aborted");
  });
});

describe("hydration without prompting", () => {
  const base = { supported: true, secureContext: true, permission: "prompt" as const };

  it("unsupported or insecure contexts say so and keep manual search", () => {
    expect(
      hydrateLocationState({
        ...base,
        supported: false,
        secureContext: true,
        stored: null,
        revoked: null,
      }),
    ).toMatchObject({ status: "unsupported", reason: "unsupported-api" });
    expect(
      hydrateLocationState({
        ...base,
        supported: true,
        secureContext: false,
        stored: null,
        revoked: null,
      }),
    ).toMatchObject({ status: "unsupported", reason: "insecure-context" });
  });

  it("restores a stored manual place without touching the device location", () => {
    const stored = { v: 1 as const, source: "manual" as const, place: place({ source: "search" }) };
    expect(
      hydrateLocationState({ ...base, permission: "unknown", stored, revoked: null }),
    ).toMatchObject({ status: "manual", reason: "restored", place: stored.place });
  });

  it("restores a stored GPS place as granted when permission is still usable", () => {
    const stored = {
      v: 1 as const,
      source: "gps" as const,
      place: place({ source: "geolocation" }),
    };
    expect(hydrateLocationState({ ...base, stored, revoked: null })).toMatchObject({
      status: "granted",
      reason: "restored",
    });
  });

  it("hides a stored GPS place when permission is denied or the person revoked", () => {
    const stored = {
      v: 1 as const,
      source: "gps" as const,
      place: place({ source: "geolocation" }),
    };
    expect(
      hydrateLocationState({ ...base, permission: "denied", stored, revoked: null }),
    ).toMatchObject({ status: "revoked", reason: "permission-revoked", place: null });
    expect(
      hydrateLocationState({ ...base, permission: "granted", stored, revoked: "user" }),
    ).toMatchObject({ status: "revoked", reason: "user-revoked", place: null });
  });

  it("surfaces an explicit denial or in-app revocation", () => {
    expect(
      hydrateLocationState({ ...base, permission: "denied", stored: null, revoked: null }),
    ).toMatchObject({ status: "denied", reason: "permission-denied" });
    expect(
      hydrateLocationState({ ...base, permission: "prompt", stored: null, revoked: "user" }),
    ).toMatchObject({ status: "revoked", reason: "user-revoked" });
  });

  it("does not elevate a granted permission into a location request", () => {
    expect(
      hydrateLocationState({ ...base, permission: "granted", stored: null, revoked: null }),
    ).toEqual(INITIAL_LOCATION_STATE);
  });
});

describe("coarse geolocation wrapper", () => {
  it("asks for a coarse, cached fix and returns only rounded coordinates", async () => {
    const geo = geoHarness();
    const pending = currentCoarseFix(geo.api);
    geo.succeed(52.5201234, 13.4049876);
    await expect(pending).resolves.toEqual({ latitude: 52.52, longitude: 13.4 });
    expect(geo.options[0]).toMatchObject({
      enableHighAccuracy: false,
      maximumAge: COARSE_MAXIMUM_AGE_MS,
      timeout: COARSE_TIMEOUT_MS,
    });
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it("never upgrades the request to high accuracy, even if a caller asks", async () => {
    const geo = geoHarness();
    const pending = currentCoarseFix(geo.api, { enableHighAccuracy: true });
    geo.succeed(52.52, 13.4);
    await pending;
    expect(geo.options[0]?.enableHighAccuracy).toBe(false);
  });

  it("maps PERMISSION_DENIED, POSITION_UNAVAILABLE and TIMEOUT", async () => {
    for (const [code, kind] of [
      [1, "permission-denied"],
      [2, "position-unavailable"],
      [3, "timeout"],
      [99, "position-unavailable"],
    ] as const) {
      const geo = geoHarness({ error: code });
      await expect(currentCoarseFix(geo.api)).rejects.toMatchObject({
        name: "LocationFailure",
        kind,
      });
    }
    expect(mapGeolocationError(null)).toBe("position-unavailable");
  });

  it("rejects when no geolocation API exists", async () => {
    await expect(currentCoarseFix(null)).rejects.toBeInstanceOf(LocationFailure);
  });

  it("rejects an invalid position instead of resolving a half fix", async () => {
    const geo = geoHarness();
    const pending = currentCoarseFix(geo.api);
    geo.succeed(Number.NaN, 13.4);
    await expect(pending).rejects.toMatchObject({ kind: "position-unavailable" });
  });

  it("uses the coarse defaults constant and carries no accuracy", () => {
    expect(COARSE_POSITION_OPTIONS.enableHighAccuracy).toBe(false);
    expect(COARSE_POSITION_OPTIONS.maximumAge).toBe(5 * 60_000);
    expect(COARSE_POSITION_OPTIONS.timeout).toBe(12_000);
  });

  it("detects support from the injected API, not only from the global", () => {
    const geo = geoHarness();
    expect(detectLocationSupport(geo.api)).toMatchObject({ supported: true });
    expect(detectLocationSupport(null)).toMatchObject({ supported: false });
  });
});

describe("permissions", () => {
  it("normalizes and reads permission state without prompting", async () => {
    expect(normalizePermissionState("granted")).toBe("granted");
    expect(normalizePermissionState("denied")).toBe("denied");
    expect(normalizePermissionState("prompt")).toBe("prompt");
    expect(normalizePermissionState("weird")).toBe("unknown");
    expect(await readGeolocationPermission(permissionHarness("denied").api)).toBe("denied");
    expect(await readGeolocationPermission(null)).toBe("unknown");
    expect(
      await readGeolocationPermission({
        async query() {
          throw new Error("not supported");
        },
      }),
    ).toBe("unknown");
  });

  it("observes the initial state and a later revocation, and stops on unsubscribe", async () => {
    const harness = permissionHarness("granted");
    const seen: string[] = [];
    const stop = observeGeolocationPermission(harness.api, (state) => seen.push(state));
    await vi.waitFor(() => expect(seen).toEqual(["granted"]));
    harness.set("denied");
    expect(seen).toEqual(["granted", "denied"]);
    stop();
    harness.set("granted");
    expect(seen).toEqual(["granted", "denied"]);
  });

  it("is a no-op when the Permissions API is absent", () => {
    const stop = observeGeolocationPermission(null, () => {
      throw new Error("must not run");
    });
    expect(() => stop()).not.toThrow();
  });
});

describe("coarse place persistence", () => {
  it("stores only the validated, rounded record", async () => {
    const written = await writeStoredPlace(gpsStoredPlace(place()));
    expect(written).toBe(true);
    const raw = window.localStorage.getItem(LOCATION_PLACE_KEY);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("52.5201234");
    const parsed = JSON.parse(raw ?? "null") as Record<string, unknown>;
    expect(parsed["v"]).toBe(1);
    expect(parsed["source"]).toBe("gps");
    const storedPlace = parsed["place"] as Record<string, unknown>;
    expect(storedPlace["latitude"]).toBe(52.52);
    expect(storedPlace["source"]).toBe("geolocation");
    expect(raw).not.toContain("accuracy");
  });

  it("re-quantizes a tampered/legacy record on read", async () => {
    window.localStorage.setItem(
      LOCATION_PLACE_KEY,
      JSON.stringify({
        v: 1,
        source: "gps",
        place: { ...place(), latitude: 52.5201234, longitude: 13.4049876 },
      }),
    );
    const stored = readStoredPlace();
    expect(stored?.place.latitude).toBe(52.52);
    expect(stored?.place.longitude).toBe(13.4);
  });

  it("round-trips, then clears the stored place", async () => {
    await writeStoredPlace(
      manualStoredPlace(place()) ?? { v: 1, source: "manual", place: place() },
    );
    expect(readStoredPlace()).toMatchObject({ source: "manual" });
    await clearStoredPlace();
    expect(readStoredPlace()).toBeNull();
    expect(window.localStorage.getItem(LOCATION_PLACE_KEY)).toBeNull();
  });

  it("rejects damaged or future stored records", () => {
    expect(parseStoredPlace(null)).toBeNull();
    expect(parseStoredPlace({ v: 2, source: "gps", place: place() })).toBeNull();
    expect(parseStoredPlace({ v: 1, source: "other", place: place() })).toBeNull();
    expect(parseStoredPlace({ v: 1, source: "gps", place: { ...place(), name: "" } })).toBeNull();
    expect(parseStoredPlace({ v: 1, source: "gps", place: place() })).toMatchObject({ v: 1 });
  });

  it("persists and clears the revocation marker", async () => {
    expect(readLocationRevocation()).toBeNull();
    await writeLocationRevocation("user");
    expect(readLocationRevocation()).toBe("user");
    expect(window.localStorage.getItem(LOCATION_REVOKED_KEY)).toBe("user");
    await clearLocationRevocation();
    expect(readLocationRevocation()).toBeNull();
    expect(parseLocationRevocation("permission")).toBe("permission");
    expect(parseLocationRevocation("bogus")).toBeNull();
  });

  it("rejects writing a place that cannot be validated", async () => {
    const written = await writeStoredPlace({
      v: 1,
      source: "gps",
      place: { ...place(), latitude: 200 },
    });
    expect(written).toBe(false);
    expect(window.localStorage.getItem(LOCATION_PLACE_KEY)).toBeNull();
  });

  it("is removed by the app's existing forget-everything path", async () => {
    await writeStoredPlace(gpsStoredPlace(place()));
    await writeLocationRevocation("user");
    const { clearDeviceData } = await import("@/lib/clearData");
    await clearDeviceData();
    expect(window.localStorage.getItem(LOCATION_PLACE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LOCATION_REVOKED_KEY)).toBeNull();
  });
});

describe("coordinate fallback place", () => {
  it("is honest, coarse and uses A06's cache identity", () => {
    const fallback = coordinatePlace(52.5201234, 13.4049876, { timeZone: "Europe/Berlin" });
    expect(fallback).toMatchObject({
      id: "open-meteo:52.52:13.40",
      name: "52.52, 13.40",
      latitude: 52.52,
      longitude: 13.4,
      timeZone: "Europe/Berlin",
      source: "geolocation",
    });
    expect(fallback?.placeCredit).toBeUndefined();
    expect(fallback?.countryCode).toBeUndefined();
  });

  it("rejects an unusable fix and falls back to a device time zone", () => {
    expect(coordinatePlace(Number.NaN, 13.4)).toBeNull();
    expect(deviceTimeZone().length).toBeGreaterThan(0);
    const fallback = coordinatePlace(52.52, 13.4, { timeZone: "  " });
    expect(fallback?.timeZone).toBe(deviceTimeZone());
  });

  it("marks the source without dropping a required attribution", () => {
    const named = place({ source: "search", placeCredit: "© OpenStreetMap contributors" });
    const geolocated = placeWithSource(named, "geolocation");
    expect(geolocated.source).toBe("geolocation");
    expect(geolocated.placeCredit).toBe("© OpenStreetMap contributors");
    expect(gpsStoredPlace(named).place.source).toBe("geolocation");
    expect(manualStoredPlace(named)?.place.source).toBe("search");
  });
});
