import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWeather, resetWeatherRequestsForTests } from "./useWeather";
import { readCachedSnapshot, readUnitsPreference, writeCachedSnapshot } from "./cache";
import { BERLIN_METRIC } from "./fixtures";
import { normalizeOpenMeteoForecast } from "./openMeteo.server";
import {
  WEATHER_FRESH_MS,
  WEATHER_STALE_MS,
  type WeatherPlace,
  type WeatherSnapshot,
} from "./types";

/** 2026-11-17 18:05 +01:00, the observation hour of the recorded Berlin fixture. */
const NOW = Date.parse("2026-11-17T18:05:00+01:00");

const PLACE: WeatherPlace = {
  id: "open-meteo:52.52:13.41",
  name: "Berlin",
  latitude: 52.52,
  longitude: 13.41,
  countryCode: "DE",
  admin: "Berlin",
  timeZone: "Europe/Berlin",
  source: "search",
};

const OTHER_PLACE: WeatherPlace = {
  id: "open-meteo:48.14:11.58",
  name: "München",
  latitude: 48.14,
  longitude: 11.58,
  timeZone: "Europe/Berlin",
  source: "search",
};

function snapshot(fetchedAt = NOW, place = PLACE): WeatherSnapshot {
  return normalizeOpenMeteoForecast(
    BERLIN_METRIC,
    { latitude: place.latitude, longitude: place.longitude, units: "metric", language: "de" },
    fetchedAt,
  );
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(handler: (call: FetchCall) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = { url: String(input), init };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

const okPayload = (value: WeatherSnapshot) => jsonResponse({ ok: true, snapshot: value });

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(async () => {
  window.localStorage.clear();
  resetWeatherRequestsForTests();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetWeatherRequestsForTests();
  window.localStorage.clear();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

describe("stale-while-revalidate", () => {
  it("renders a fresh cached snapshot without any request", async () => {
    await writeCachedSnapshot(snapshot(NOW - 60_000));
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    const { result } = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.snapshot?.current.temperature).toBe(5.3);
    expect(calls).toHaveLength(0);
    expect(result.current.freshness?.isStale).toBe(false);
  });

  it("renders a stale snapshot immediately and revalidates exactly once", async () => {
    await writeCachedSnapshot(snapshot(NOW - 20 * 60_000));
    const fresher = { ...snapshot(NOW), current: { ...snapshot(NOW).current, temperature: 6.1 } };
    const { calls } = stubFetch(() => okPayload(fresher));
    const { result } = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(result.current.snapshot?.current.temperature).toBe(5.3));
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(result.current.snapshot?.current.temperature).toBe(6.1));
    await waitFor(() => expect(result.current.freshness?.isStale).toBe(false));
    await waitFor(() =>
      expect(readCachedSnapshot(52.52, 13.41, "metric")?.current.temperature).toBe(6.1),
    );
  });

  it("shows loading with no cache and becomes ready on success", async () => {
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    const { result } = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ latitude: 52.52, longitude: 13.41, units: "metric", lang: "de" });
  });

  it("coalesces concurrent refreshes for one place into one request", async () => {
    let resolveRequest: ((response: Response) => void) | null = null;
    const { calls } = stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const first = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    const second = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      resolveRequest?.(okPayload(snapshot(NOW)));
      await Promise.resolve();
    });
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(calls).toHaveLength(1);
    expect(first.result.current.snapshot?.current.temperature).toBe(5.3);
    expect(second.result.current.snapshot?.current.temperature).toBe(5.3);
  });

  it("keeps the last valid forecast when a refresh fails and exposes the failure", async () => {
    await writeCachedSnapshot(snapshot(NOW - 20 * 60_000));
    const { calls } = stubFetch(() => Promise.reject(new TypeError("network down")));
    const { result } = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(result.current.error).toBe("network"));
    expect(result.current.snapshot?.current.temperature).toBe(5.3);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.freshness?.isStale).toBe(true);
    expect(result.current.freshness?.ageMs).toBeGreaterThanOrEqual(20 * 60_000);
  });

  it("rejects an invalid route payload and never renders it", async () => {
    const { calls } = stubFetch(() => jsonResponse({ ok: true, snapshot: { version: 1 } }));
    const { result } = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBe("invalid");
  });

  it("surfaces a rate answer and keeps the cached forecast", async () => {
    await writeCachedSnapshot(snapshot(NOW - 20 * 60_000));
    stubFetch(() => jsonResponse({ ok: false, kind: "rate" }, 429));
    const { result } = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(result.current.error).toBe("rate"));
    expect(result.current.snapshot?.current.temperature).toBe(5.3);
  });
});

describe("units preference", () => {
  it("converts the shown snapshot instantly and persists, without a request", async () => {
    await writeCachedSnapshot(snapshot(NOW - 60_000));
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    const { result } = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.units).toBe("metric");
    act(() => result.current.setUnits("imperial"));
    await waitFor(() => expect(result.current.units).toBe("imperial"));
    expect(result.current.snapshot?.current.temperature).toBe(41.5);
    expect(result.current.snapshot?.units).toBe("imperial");
    expect(calls).toHaveLength(0);
    expect(readUnitsPreference()).toBe("imperial");
  });
});

describe("place and preference changes", () => {
  it("loads the cached forecast for a new place without a request", async () => {
    await writeCachedSnapshot(snapshot(NOW - 60_000));
    await writeCachedSnapshot(snapshot(NOW - 60_000, OTHER_PLACE));
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    const { result, rerender } = renderHook(
      ({ place }: { place: WeatherPlace }) => useWeather({ place, language: "de" }),
      { initialProps: { place: PLACE } },
    );
    await waitFor(() => expect(result.current.snapshot?.place.name).toBe("Berlin"));
    rerender({ place: OTHER_PLACE });
    await waitFor(() => expect(result.current.snapshot?.place.latitude).toBe(48.14));
    expect(result.current.snapshot?.place.name).toBe("München");
    expect(calls).toHaveLength(0);
  });

  it("does nothing while disabled or without a place", async () => {
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    const disabled = renderHook(() => useWeather({ place: PLACE, language: "de", enabled: false }));
    const empty = renderHook(() => useWeather({ place: null, language: "de" }));
    await waitFor(() => expect(disabled.result.current.status).toBe("idle"));
    expect(empty.result.current.status).toBe("idle");
    expect(calls).toHaveLength(0);
  });

  it("defers a stale refresh while the composer is active", async () => {
    await writeCachedSnapshot(snapshot(NOW - 20 * 60_000));
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    const { result, rerender } = renderHook(
      ({ defer }: { defer: boolean }) =>
        useWeather({ place: PLACE, language: "de", deferRefresh: defer }),
      { initialProps: { defer: true } },
    );
    await waitFor(() => expect(result.current.snapshot?.current.temperature).toBe(5.3));
    expect(calls).toHaveLength(0);
    rerender({ defer: false });
    await waitFor(() => expect(calls).toHaveLength(1));
  });
});

describe("revalidation triggers (no polling)", () => {
  it("revalidates on becoming visible when stale", async () => {
    await writeCachedSnapshot(snapshot(NOW - 60_000));
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(calls).toHaveLength(0));
    vi.setSystemTime(NOW + WEATHER_FRESH_MS + 1000);
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it("requests nothing while the surface is hidden", async () => {
    await writeCachedSnapshot(snapshot(NOW - 60_000));
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(calls).toHaveLength(0));
    vi.setSystemTime(NOW + WEATHER_FRESH_MS + 1000);
    act(() => setVisibility("hidden"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(calls).toHaveLength(0);
  });

  it("never revalidates before a provider-declared expiry", async () => {
    const met = { ...snapshot(NOW - 60 * 60_000), expiresAt: NOW + 10 * 60_000 };
    await writeCachedSnapshot(met);
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(calls).toHaveLength(0));
    act(() => setVisibility("visible"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(calls).toHaveLength(0);
    vi.setSystemTime(NOW + 10 * 60_000 + 1000);
    act(() => setVisibility("visible"));
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it("manual refresh ignores the freshness window; clear forgets the device cache", async () => {
    await writeCachedSnapshot(snapshot(NOW - 60_000));
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    const { result } = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.refresh());
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    act(() => result.current.clear());
    await waitFor(() => expect(result.current.snapshot).toBeNull());
    expect(result.current.status).toBe("idle");
    await waitFor(() => expect(readCachedSnapshot(52.52, 13.41, "metric")).toBeNull());
  });

  it("reports offline and recovers on the online event", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    const { result } = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.offline).toBe(false); // the request itself succeeded
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.offline).toBe(true);
    // Move past the freshness window: the in-memory snapshot is now stale, so recovering
    // the network is the moment to revalidate.
    vi.setSystemTime(NOW + WEATHER_FRESH_MS + 1000);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    await waitFor(() => expect(result.current.offline).toBe(false));
  });
});

describe("native app transport", () => {
  it("calls the versioned native route through the origin-gated transport", async () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
    };
    const { calls } = stubFetch(() => okPayload(snapshot(NOW)));
    const { result } = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://fluently.today/api/native/v1/weather");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.mode).toBe("cors");
    expect(calls[0]?.init?.credentials).toBe("omit");
  });
});

describe("freshness exposure", () => {
  it("reports the age and marks a snapshot past three hours as expired", async () => {
    await writeCachedSnapshot(snapshot(NOW - WEATHER_STALE_MS - 1000));
    const { result } = renderHook(() => useWeather({ place: PLACE, language: "de" }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(result.current.freshness?.isExpired).toBe(true);
    expect(result.current.freshness?.isStale).toBe(true);
  });
});
