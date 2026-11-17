import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WeatherError,
  classifyWeatherFailure,
  convertSnapshotUnits,
  isWeatherSymbol,
  isWeatherUnits,
  parseWeatherSnapshot,
  round1,
  roundCoordinate,
  weatherCacheKey,
  weatherErrorKind,
  weatherIsFresh,
  weatherPlaceId,
  withDeadline,
} from "./provider";
import { WEATHER_FRESH_MS, WEATHER_SCHEMA_VERSION, type WeatherSnapshot } from "./types";

const NOW = 1_794_936_000_000;

function snapshot(overrides: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
  return {
    version: WEATHER_SCHEMA_VERSION,
    provider: "open-meteo",
    place: {
      id: "open-meteo:52.52:13.41",
      name: "Berlin",
      latitude: 52.52,
      longitude: 13.41,
      timeZone: "Europe/Berlin",
    },
    units: "metric",
    fetchedAt: NOW,
    current: {
      time: "2026-11-17T18:00:00+01:00",
      temperature: 5.3,
      apparentTemperature: 1.7,
      humidity: 88,
      windSpeed: 14.8,
      windDirection: 129,
      symbol: "rain",
      isDay: false,
    },
    hourly: [
      {
        time: "2026-11-17T18:00:00+01:00",
        temperature: 5.3,
        precipitationProbability: 100,
        symbol: "rain",
      },
      { time: "2026-11-17T19:00:00+01:00", temperature: -0.15, symbol: "snow" },
    ],
    daily: [
      {
        date: "2026-11-17",
        min: -5.5,
        max: 8.8,
        precipitationProbability: 100,
        symbol: "rain",
        sunrise: "2026-11-17T07:31:30+01:00",
        sunset: "2026-11-17T16:06:00+01:00",
      },
    ],
    attribution: {
      provider: "open-meteo",
      text: "Weather data by Open-Meteo.com",
      url: "https://open-meteo.com/",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("coordinate and place identity", () => {
  it("rounds to two decimals and never keeps negative zero", () => {
    expect(roundCoordinate(52.52437)).toBe(52.52);
    expect(roundCoordinate(-13.405)).toBe(-13.41);
    expect(roundCoordinate(-0.001)).toBe(0);
    expect(Object.is(roundCoordinate(-0.001), -0)).toBe(false);
  });

  it("rounds half away from zero, symmetrically for negative values", () => {
    expect(round1(-0.15)).toBe(-0.2);
    expect(round1(-0.04)).toBe(0);
    expect(round1(0.05)).toBe(0.1);
    expect(Object.is(round1(-0.04), -0)).toBe(false);
  });

  it("derives one stable place id from rounded coordinates + provider", () => {
    expect(weatherPlaceId(52.52437, 13.41053)).toBe("open-meteo:52.52:13.41");
    expect(weatherPlaceId(52.524, 13.41)).toBe(weatherPlaceId(52.521, 13.414));
    expect(weatherPlaceId(52.52, 13.41, "met-no")).toBe("met-no:52.52:13.41");
  });

  it("keys the cache by place and unit family", () => {
    expect(weatherCacheKey(52.52, 13.41, "metric")).toBe("open-meteo:52.52:13.41|metric");
    expect(weatherCacheKey(52.52, 13.41, "imperial")).not.toBe(
      weatherCacheKey(52.52, 13.41, "metric"),
    );
  });
});

describe("units conversion", () => {
  it("converts temperatures, apparent temperature derived from real fixtures and wind speed", () => {
    const imperial = convertSnapshotUnits(snapshot(), "imperial");
    expect(imperial.units).toBe("imperial");
    expect(imperial.current.temperature).toBe(41.5); // 5.3 C
    expect(imperial.current.apparentTemperature).toBe(35.1); // 1.7 C
    expect(imperial.current.windSpeed).toBe(9.2); // 14.8 km/h
    expect(imperial.hourly[0]?.temperature).toBe(41.5);
    expect(imperial.daily[0]?.min).toBe(22.1); // -5.5 C
    expect(imperial.daily[0]?.max).toBe(47.8); // 8.8 C
    // Unit-free values are untouched.
    expect(imperial.current.humidity).toBe(88);
    expect(imperial.hourly[0]?.precipitationProbability).toBe(100);
    expect(imperial.place).toEqual(snapshot().place);
    expect(imperial.fetchedAt).toBe(NOW);
  });

  it("rounds negative Fahrenheit values with the same one-decimal rule", () => {
    const metric = convertSnapshotUnits(
      snapshot({
        units: "imperial",
        current: {
          ...snapshot().current,
          temperature: -32.2,
          apparentTemperature: -39.9,
          windSpeed: 0.6,
        },
      }),
      "metric",
    );
    expect(metric.current.temperature).toBe(-35.7);
    expect(metric.current.apparentTemperature).toBe(-39.9);
    expect(metric.current.windSpeed).toBe(1.0);
  });

  it("is a no-op (same reference) when the family is unchanged", () => {
    const original = snapshot();
    expect(convertSnapshotUnits(original, "metric")).toBe(original);
  });
});

describe("snapshot validation on read", () => {
  it("accepts a valid snapshot, strips unknown keys and re-rounds coordinates", () => {
    const value = {
      ...snapshot({ place: { ...snapshot().place, latitude: 52.52437 } }),
      injected: true,
    };
    const parsed = parseWeatherSnapshot(value);
    expect(parsed).not.toBeNull();
    expect(parsed?.place.latitude).toBe(52.52);
    expect(parsed && "injected" in parsed).toBe(false);
    expect(parsed?.attribution.license).toBe("CC BY 4.0");
  });

  it("keeps the optional reverse-geocoding provenance", () => {
    const parsed = parseWeatherSnapshot(
      snapshot({
        place: {
          ...snapshot().place,
          source: "geolocation",
          placeCredit: "Place name © OpenStreetMap contributors",
        },
      }),
    );
    expect(parsed?.place.source).toBe("geolocation");
    expect(parsed?.place.placeCredit).toBe("Place name © OpenStreetMap contributors");
  });

  it("rejects another schema version", () => {
    expect(parseWeatherSnapshot({ ...snapshot(), version: 2 })).toBeNull();
  });

  it("rejects a partial or damaged snapshot as a whole", () => {
    const base = snapshot();
    expect(parseWeatherSnapshot({ ...base, current: undefined })).toBeNull();
    expect(
      parseWeatherSnapshot({ ...base, attribution: { ...base.attribution, url: "not-a-url" } }),
    ).toBeNull();
    expect(parseWeatherSnapshot({ ...base, daily: [] })).toBeNull();
    const { fetchedAt: _omitted, ...withoutFetchedAt } = base;
    expect(parseWeatherSnapshot(withoutFetchedAt)).toBeNull();
    // A bare Z is not an offset-qualified ISO time.
    expect(
      parseWeatherSnapshot({ ...base, current: { ...base.current, time: "2026-11-17T17:00:00Z" } }),
    ).toBeNull();
    // Optional fields, when present, must be valid too.
    expect(
      parseWeatherSnapshot({ ...base, current: { ...base.current, humidity: 140 } }),
    ).toBeNull();
    expect(
      parseWeatherSnapshot({ ...base, current: { ...base.current, apparentTemperature: null } }),
    ).toBeNull();
  });

  it("enforces the 48-hour and 16-day array caps", () => {
    const base = snapshot();
    const hour = { time: "2026-11-17T18:00:00+01:00", temperature: 1, symbol: "rain" as const };
    const day = { ...base.daily[0]!, date: "2026-11-17" };
    expect(
      parseWeatherSnapshot({ ...base, hourly: Array.from({ length: 48 }, () => hour) }),
    ).not.toBeNull();
    expect(
      parseWeatherSnapshot({ ...base, hourly: Array.from({ length: 49 }, () => hour) }),
    ).toBeNull();
    expect(
      parseWeatherSnapshot({ ...base, daily: Array.from({ length: 16 }, () => day) }),
    ).not.toBeNull();
    expect(
      parseWeatherSnapshot({ ...base, daily: Array.from({ length: 17 }, () => day) }),
    ).toBeNull();
  });

  it("rejects a bad provider-declared expiry", () => {
    expect(parseWeatherSnapshot({ ...snapshot(), expiresAt: "tomorrow" })).toBeNull();
    expect(parseWeatherSnapshot({ ...snapshot(), expiresAt: 0 })).toBeNull();
    expect(parseWeatherSnapshot({ ...snapshot(), expiresAt: NOW + 60_000 })).not.toBeNull();
  });

  it("knows the contract's symbol and unit unions", () => {
    expect(isWeatherSymbol("heavy-rain")).toBe(true);
    expect(isWeatherSymbol("monsoon")).toBe(false);
    expect(isWeatherUnits("metric")).toBe(true);
    expect(isWeatherUnits("kelvin")).toBe(false);
  });
});

describe("freshness policy", () => {
  it("is fresh inside the app window", () => {
    expect(weatherIsFresh(snapshot({ fetchedAt: NOW }), NOW + 60_000)).toBe(true);
    expect(weatherIsFresh(snapshot({ fetchedAt: NOW }), NOW + WEATHER_FRESH_MS - 1)).toBe(true);
  });

  it("becomes stale when the window passes", () => {
    expect(weatherIsFresh(snapshot({ fetchedAt: NOW }), NOW + WEATHER_FRESH_MS)).toBe(false);
  });

  it("never revalidates before a provider-declared expiry, even past our window", () => {
    const met = snapshot({ fetchedAt: NOW, expiresAt: NOW + 30 * 60_000 });
    expect(weatherIsFresh(met, NOW + 20 * 60_000)).toBe(true);
    expect(weatherIsFresh(met, NOW + 31 * 60_000)).toBe(false);
  });
});

describe("deadlines and failure classification", () => {
  it("aborts with a timeout after the deadline and reports it as a timeout", async () => {
    const deadline = withDeadline(undefined, 10);
    expect(deadline.timedOut()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(deadline.timedOut()).toBe(true);
    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
  });

  it("distinguishes the caller's abort from the deadline", () => {
    const controller = new AbortController();
    const deadline = withDeadline(controller.signal, 10_000);
    controller.abort();
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timedOut()).toBe(false);
    deadline.dispose();
  });

  it("maps failures to the product's names, deadline first", async () => {
    const timedOut = withDeadline(undefined, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(classifyWeatherFailure(new TypeError("failed"), timedOut, undefined).kind).toBe(
      "timeout",
    );
    timedOut.dispose();
    const caller = new AbortController();
    caller.abort();
    expect(classifyWeatherFailure(new Error("x"), undefined, caller.signal).kind).toBe("cancelled");
    expect(classifyWeatherFailure(new Error("x"), undefined, undefined, "invalid").kind).toBe(
      "invalid",
    );
    expect(classifyWeatherFailure(new TypeError("network"), undefined, undefined).kind).toBe(
      "network",
    );
    expect(classifyWeatherFailure(new WeatherError("rate")).kind).toBe("rate");
    expect(weatherErrorKind(new WeatherError("timeout"))).toBe("timeout");
    expect(weatherErrorKind(new Error("other"))).toBe("provider");
  });
});
