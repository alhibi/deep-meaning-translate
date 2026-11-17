import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaceError } from "./geocode";
import {
  COARSE_MAXIMUM_AGE_MS,
  COARSE_TIMEOUT_MS,
  coordinatePlace,
  gpsStoredPlace,
  LOCATION_PLACE_KEY,
  LOCATION_REVOKED_KEY,
  readLocationRevocation,
  readStoredPlace,
  writeLocationRevocation,
  writeStoredPlace,
  type GeolocationErrorLike,
  type GeolocationLike,
  type GeolocationPositionLike,
  type PermissionsLike,
} from "./location";
import type { WeatherPlace } from "./types";
import { useWeatherLocation, type PlaceSearchResult } from "./useWeatherLocation";

function namedPlace(overrides: Partial<WeatherPlace> = {}): WeatherPlace {
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

function geoHarness(
  behavior: { fix?: [number, number]; error?: number; defer?: boolean } = {},
): GeoHarness {
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
      if (behavior.defer) return;
      if (behavior.fix) {
        onSuccess({ coords: { latitude: behavior.fix[0], longitude: behavior.fix[1] } });
      } else if (behavior.error !== undefined) {
        onError?.({ code: behavior.error });
      }
    },
  );
  const watchPosition = vi.fn();
  return {
    api: { getCurrentPosition, watchPosition } as unknown as GeolocationLike,
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
  listenerCount(): number;
}

function permissionHarness(initial: "granted" | "denied" | "prompt"): PermissionHarness {
  const listeners = new Set<() => void>();
  const current = { value: initial };
  return {
    api: {
      async query() {
        return {
          // Live state, like the browser's PermissionStatus the observer holds.
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
    listenerCount() {
      return listeners.size;
    },
  };
}

function makeClient() {
  return {
    search: vi.fn(
      async (_query: string, _language?: string, _signal?: AbortSignal) => [] as WeatherPlace[],
    ),
    reverse: vi.fn(
      async (_latitude: number, _longitude: number, _language?: string, _signal?: AbortSignal) =>
        [] as WeatherPlace[],
    ),
  };
}

function storedText(): string {
  return Object.keys(window.localStorage)
    .map((key) => window.localStorage.getItem(key) ?? "")
    .join("\n");
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("explicit consent", () => {
  it("never requests geolocation on mount, even when permission is already granted", async () => {
    const geo = geoHarness();
    const permissions = permissionHarness("granted");
    const client = makeClient();
    const { result } = renderHook(() =>
      useWeatherLocation({
        language: "en",
        geolocation: geo.api,
        permissions: permissions.api,
        placeClient: client,
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("prompt");
    expect(result.current.canEnable).toBe(true);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(client.search).not.toHaveBeenCalled();
    expect(client.reverse).not.toHaveBeenCalled();
  });

  it("enables location only after the explicit action and then stores a coarse place", async () => {
    const geo = geoHarness({ fix: [52.5201234, 13.4049876] });
    const permissions = permissionHarness("prompt");
    const client = makeClient();
    const { result } = renderHook(() =>
      useWeatherLocation({
        language: "de",
        geolocation: geo.api,
        permissions: permissions.api,
        placeClient: client,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("prompt"));
    await act(async () => {
      await result.current.enableLocation();
    });
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.options[0]).toMatchObject({
      enableHighAccuracy: false,
      maximumAge: COARSE_MAXIMUM_AGE_MS,
      timeout: COARSE_TIMEOUT_MS,
    });
    expect(client.reverse).toHaveBeenCalledWith(52.52, 13.4, "de", expect.anything());
    expect(result.current.status).toBe("granted");
    expect(result.current.reason).toBe("fix-acquired");
    expect(result.current.place).toMatchObject({
      id: "open-meteo:52.52:13.40",
      name: "52.52, 13.40",
      latitude: 52.52,
      longitude: 13.4,
      source: "geolocation",
    });
    const stored = readStoredPlace();
    expect(stored?.source).toBe("gps");
    expect(stored?.place.latitude).toBe(52.52);
    // The raw fix (and the accuracy that came with it) never reaches storage.
    expect(storedText()).not.toContain("52.5201234");
    expect(storedText()).not.toContain("accuracy");
  });

  it("keeps a reverse-geocoded name and its attribution when the server returns one", async () => {
    const geo = geoHarness({ fix: [52.52, 13.4] });
    const permissions = permissionHarness("granted");
    const client = makeClient();
    const attributed = namedPlace({ placeCredit: "© OpenStreetMap contributors" });
    client.reverse.mockResolvedValue([attributed]);
    const { result } = renderHook(() =>
      useWeatherLocation({
        language: "ar",
        geolocation: geo.api,
        permissions: permissions.api,
        placeClient: client,
      }),
    );
    await act(async () => {
      await result.current.enableLocation();
    });
    expect(client.reverse).toHaveBeenCalledWith(52.52, 13.4, "ar", expect.anything());
    expect(result.current.place).toMatchObject({
      name: "Berlin",
      source: "geolocation",
      placeCredit: "© OpenStreetMap contributors",
    });
  });

  it("reports denied, timeout and unsupported cleanly and keeps manual search", async () => {
    const permissions = permissionHarness("prompt");
    const cases: Array<[GeoHarness, "permission-denied" | "timeout"]> = [
      [geoHarness({ error: 1 }), "permission-denied"],
      [geoHarness({ error: 3 }), "timeout"],
    ];
    for (const [geo, kind] of cases) {
      const client = makeClient();
      const { result, unmount } = renderHook(() =>
        useWeatherLocation({
          geolocation: geo.api,
          permissions: permissions.api,
          placeClient: client,
        }),
      );
      await act(async () => {
        await result.current.enableLocation();
      });
      expect(result.current.status).toBe("denied");
      expect(result.current.reason).toBe(kind);
      expect(result.current.error).toEqual({ kind });
      expect(result.current.place).toBeNull();
      // The manual fallback is always available, including after a denial.
      client.search.mockResolvedValue([namedPlace()]);
      let search: PlaceSearchResult | undefined;
      await act(async () => {
        search = await result.current.searchCity("Berlin");
      });
      expect(search).toMatchObject({ ok: true });
      unmount();
    }
  });

  it("degrades to manual-only when the geolocation API is absent", async () => {
    const client = makeClient();
    client.search.mockResolvedValue([namedPlace()]);
    const { result } = renderHook(() =>
      useWeatherLocation({ geolocation: null, permissions: null, placeClient: client }),
    );
    await waitFor(() => expect(result.current.status).toBe("unsupported"));
    expect(result.current.reason).toBe("unsupported-api");
    expect(result.current.canEnable).toBe(false);
    await act(async () => {
      await result.current.enableLocation();
    });
    expect(result.current.status).toBe("unsupported");
    let search: PlaceSearchResult | undefined;
    await act(async () => {
      search = await result.current.searchCity("Berlin");
    });
    expect(search).toMatchObject({ ok: true });
  });
});

describe("manual place fallback", () => {
  it("searches in the active language, persists the chosen place and restores it without locating", async () => {
    const geo = geoHarness();
    const permissions = permissionHarness("prompt");
    const client = makeClient();
    client.search.mockResolvedValue([namedPlace({ name: "برلين", source: "search" })]);
    const { result, unmount } = renderHook(() =>
      useWeatherLocation({
        language: "ar",
        geolocation: geo.api,
        permissions: permissions.api,
        placeClient: client,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("prompt"));
    let search: PlaceSearchResult | undefined;
    await act(async () => {
      search = await result.current.searchCity("  برلين  ");
    });
    expect(client.search).toHaveBeenCalledWith("برلين", "ar", expect.anything());
    expect(search).toMatchObject({ ok: true });
    await act(async () => {
      await result.current.chooseCity(namedPlace({ name: "برلين", source: "search" }));
    });
    expect(result.current.status).toBe("manual");
    expect(result.current.place?.name).toBe("برلين");
    expect(readStoredPlace()).toMatchObject({ source: "manual" });
    expect(readStoredPlace()?.place.source).toBe("search");
    unmount();

    const freshGeo = geoHarness();
    const freshClient = makeClient();
    const { result: restored } = renderHook(() =>
      useWeatherLocation({
        language: "ar",
        geolocation: freshGeo.api,
        permissions: permissionHarness("prompt").api,
        placeClient: freshClient,
      }),
    );
    await waitFor(() => expect(restored.current.status).toBe("manual"));
    expect(restored.current.reason).toBe("restored");
    expect(restored.current.place?.name).toBe("برلين");
    expect(freshGeo.getCurrentPosition).not.toHaveBeenCalled();
    expect(freshClient.reverse).not.toHaveBeenCalled();
  });

  it("uses the new interface language for the next search after a locale change", async () => {
    const client = makeClient();
    client.search.mockResolvedValue([namedPlace()]);
    const { result, rerender } = renderHook(
      ({ language }: { language: "en" | "ar" }) =>
        useWeatherLocation({
          language,
          geolocation: geoHarness().api,
          placeClient: client,
        }),
      { initialProps: { language: "en" } },
    );
    await act(async () => {
      await result.current.searchCity("Berlin");
    });
    expect(client.search).toHaveBeenLastCalledWith("Berlin", "en", expect.anything());
    rerender({ language: "ar" });
    await act(async () => {
      await result.current.searchCity("Berlin");
    });
    expect(client.search).toHaveBeenLastCalledWith("Berlin", "ar", expect.anything());
  });

  it("returns typed search failures and rejects empty queries", async () => {
    const client = makeClient();
    client.search.mockRejectedValue(new PlaceError("rate"));
    const { result } = renderHook(() =>
      useWeatherLocation({ geolocation: geoHarness().api, placeClient: client }),
    );
    let rateFailure: PlaceSearchResult | undefined;
    await act(async () => {
      rateFailure = await result.current.searchCity("Berlin");
    });
    expect(rateFailure).toEqual({ ok: false, error: { kind: "rate" } });
    const callsBefore = client.search.mock.calls.length;
    let emptyFailure: PlaceSearchResult | undefined;
    await act(async () => {
      emptyFailure = await result.current.searchCity("   ");
    });
    expect(emptyFailure).toEqual({ ok: false, error: { kind: "input" } });
    expect(client.search.mock.calls.length).toBe(callsBefore);
  });

  it("clears the stored place and returns to prompt, or to revoked when opted out", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useWeatherLocation({ geolocation: geoHarness().api, placeClient: client }),
    );
    await act(async () => {
      await result.current.chooseCity(namedPlace());
    });
    expect(result.current.status).toBe("manual");
    await act(async () => {
      await result.current.clearPlace();
    });
    expect(result.current.status).toBe("prompt");
    expect(result.current.place).toBeNull();
    expect(readStoredPlace()).toBeNull();

    await writeLocationRevocation("user");
    await act(async () => {
      await result.current.clearPlace();
    });
    expect(result.current.status).toBe("revoked");
    expect(result.current.reason).toBe("user-revoked");
  });

  it("restores a stored GPS place without asking the device again", async () => {
    const geo = geoHarness();
    const client = makeClient();
    await writeStoredPlace(gpsStoredPlace(coordinatePlace(52.52, 13.4) ?? namedPlace()));
    const { result } = renderHook(() =>
      useWeatherLocation({ geolocation: geo.api, placeClient: client }),
    );
    await waitFor(() => expect(result.current.status).toBe("granted"));
    expect(result.current.reason).toBe("restored");
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(client.reverse).not.toHaveBeenCalled();
  });
});

describe("revocation", () => {
  it("clears the stored place, remembers the opt-out and aborts an in-flight fix", async () => {
    const geo = geoHarness({ defer: true });
    const client = makeClient();
    const { result } = renderHook(() =>
      useWeatherLocation({
        geolocation: geo.api,
        permissions: permissionHarness("prompt").api,
        placeClient: client,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("prompt"));
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.enableLocation();
    });
    await waitFor(() => expect(result.current.pending).toBe("locating"));
    expect(result.current.canEnable).toBe(false);
    await act(async () => {
      await result.current.revokeLocation();
    });
    expect(result.current.status).toBe("revoked");
    expect(result.current.reason).toBe("user-revoked");
    expect(result.current.place).toBeNull();
    expect(readStoredPlace()).toBeNull();
    expect(readLocationRevocation()).toBe("user");
    expect(window.localStorage.getItem(LOCATION_REVOKED_KEY)).toBe("user");
    // A late browser callback must not resurrect the place after the opt-out.
    await act(async () => {
      geo.succeed(52.52, 13.4);
      await pending;
    });
    expect(result.current.status).toBe("revoked");
    expect(readStoredPlace()).toBeNull();
    expect(client.reverse).not.toHaveBeenCalled();
  });

  it("treats a browser-level revocation as a withdrawal and drops the GPS place", async () => {
    const geo = geoHarness({ fix: [52.52, 13.4] });
    const permissions = permissionHarness("granted");
    const client = makeClient();
    const { result } = renderHook(() =>
      useWeatherLocation({
        geolocation: geo.api,
        permissions: permissions.api,
        placeClient: client,
      }),
    );
    await vi.waitFor(() => expect(permissions.listenerCount()).toBe(1));
    await act(async () => {
      await result.current.enableLocation();
    });
    expect(result.current.status).toBe("granted");
    expect(readStoredPlace()).not.toBeNull();

    await act(async () => {
      permissions.set("denied");
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe("revoked"));
    expect(result.current.reason).toBe("permission-revoked");
    expect(readStoredPlace()).toBeNull();
    expect(readLocationRevocation()).toBe("permission");
  });

  it("hydrates the revoked state from the stored marker", async () => {
    await writeLocationRevocation("user");
    const geo = geoHarness();
    const { result } = renderHook(() =>
      useWeatherLocation({ geolocation: geo.api, permissions: null, placeClient: makeClient() }),
    );
    await waitFor(() => expect(result.current.status).toBe("revoked"));
    expect(result.current.reason).toBe("user-revoked");
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("aborts a pending search when the person cancels", async () => {
    let resolveSearch: ((places: WeatherPlace[]) => void) | null = null;
    const client = makeClient();
    client.search.mockImplementation(
      () =>
        new Promise<WeatherPlace[]>((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useWeatherLocation({ geolocation: geoHarness().api, placeClient: client }),
    );
    let search: Promise<PlaceSearchResult> = Promise.resolve({
      ok: false,
      error: { kind: "input" },
    });
    await act(async () => {
      search = result.current.searchCity("Berlin");
    });
    expect(result.current.pending).toBe("searching");
    act(() => result.current.cancel());
    expect(result.current.pending).toBe("none");
    await act(async () => {
      resolveSearch?.([namedPlace()]);
      const outcome = await search;
      expect(outcome).toEqual({ ok: false, error: { kind: "aborted" } });
    });
  });

  it("does not write storage after unmount", async () => {
    const geo = geoHarness({ defer: true });
    const client = makeClient();
    const { result, unmount } = renderHook(() =>
      useWeatherLocation({ geolocation: geo.api, permissions: null, placeClient: client }),
    );
    await waitFor(() => expect(result.current.status).toBe("prompt"));
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.enableLocation();
    });
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      geo.succeed(52.52, 13.4);
      await pending;
    });
    expect(window.localStorage.getItem(LOCATION_PLACE_KEY)).toBeNull();
  });
});

describe("permission hydration", () => {
  it("drops a stored GPS place when the permission is already denied on load", async () => {
    await writeStoredPlace(gpsStoredPlace(namedPlace({ source: "geolocation" })));
    const permissions = permissionHarness("denied");
    const geo = geoHarness();
    const { result } = renderHook(() =>
      useWeatherLocation({
        geolocation: geo.api,
        permissions: permissions.api,
        placeClient: makeClient(),
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("revoked"));
    expect(result.current.reason).toBe("permission-revoked");
    expect(result.current.place).toBeNull();
    expect(readStoredPlace()).toBeNull();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("surfaces a stored denial without prompting", async () => {
    const permissions = permissionHarness("denied");
    const { result } = renderHook(() =>
      useWeatherLocation({
        geolocation: geoHarness().api,
        permissions: permissions.api,
        placeClient: makeClient(),
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(result.current.reason).toBe("permission-denied");
  });
});
