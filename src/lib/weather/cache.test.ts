import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WEATHER_CACHE_KEY,
  WEATHER_CACHE_MAX_BYTES,
  clearCachedSnapshots,
  parseWeatherCacheDocument,
  readCachedSnapshot,
  readUnitsPreference,
  readWeatherCacheDocument,
  writeCachedSnapshot,
  writeUnitsPreference,
} from "./cache";
import {
  forgetSettingsCache,
  seedSettings,
  setNativeSettingsMode,
  setNativeSettingsReady,
} from "../persistence/settings";
import { WEATHER_SCHEMA_VERSION, type WeatherSnapshot } from "./types";

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
      symbol: "rain",
      isDay: false,
    },
    hourly: [{ time: "2026-11-17T18:00:00+01:00", temperature: 5.3, symbol: "rain" }],
    daily: [
      {
        date: "2026-11-17",
        min: -5.5,
        max: 8.8,
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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  setNativeSettingsMode(false);
  setNativeSettingsReady(false);
  seedSettings({});
});

describe("device weather cache", () => {
  it("stores under the documented key and reads the snapshot back", async () => {
    expect(WEATHER_CACHE_KEY).toBe("lingua.weather.v1");
    expect(await writeCachedSnapshot(snapshot())).toBe(true);
    expect(window.localStorage.getItem(WEATHER_CACHE_KEY)).toBeTruthy();
    const cached = readCachedSnapshot(52.52, 13.41, "metric");
    expect(cached?.current.temperature).toBe(5.3);
    expect(cached?.attribution.license).toBe("CC BY 4.0");
    expect(readCachedSnapshot(52.52, 13.41, "imperial")).toBeNull();
    expect(readCachedSnapshot(48.14, 11.58, "metric")).toBeNull();
  });

  it("keeps a separate entry per unit family", async () => {
    await writeCachedSnapshot(snapshot());
    await writeCachedSnapshot(
      snapshot({ units: "imperial", current: { ...snapshot().current, temperature: 41.5 } }),
    );
    expect(readCachedSnapshot(52.52, 13.41, "metric")?.units).toBe("metric");
    expect(readCachedSnapshot(52.52, 13.41, "imperial")?.units).toBe("imperial");
    expect(readWeatherCacheDocument()?.entries).toHaveLength(2);
  });

  it("discards a document from another schema version (never migrated in place)", () => {
    const raw = JSON.stringify({
      version: WEATHER_SCHEMA_VERSION + 1,
      units: "imperial",
      entries: [snapshot()],
    });
    window.localStorage.setItem(WEATHER_CACHE_KEY, raw);
    expect(readWeatherCacheDocument()).toBeNull();
    expect(readCachedSnapshot(52.52, 13.41, "metric")).toBeNull();
    expect(readUnitsPreference()).toBe("metric");
  });

  it("discards corrupt JSON and non-object documents", () => {
    window.localStorage.setItem(WEATHER_CACHE_KEY, "{not-json");
    expect(readWeatherCacheDocument()).toBeNull();
    window.localStorage.setItem(WEATHER_CACHE_KEY, '"metric"');
    expect(readWeatherCacheDocument()).toBeNull();
    window.localStorage.setItem(WEATHER_CACHE_KEY, "null");
    expect(readWeatherCacheDocument()).toBeNull();
  });

  it("drops a damaged entry but keeps the healthy one", () => {
    const healthy = snapshot();
    const damaged = { ...snapshot(), current: null };
    const raw = JSON.stringify({
      version: WEATHER_SCHEMA_VERSION,
      units: "metric",
      entries: [damaged, healthy],
    });
    window.localStorage.setItem(WEATHER_CACHE_KEY, raw);
    const document = readWeatherCacheDocument();
    expect(document?.entries).toHaveLength(1);
    expect(document?.entries[0]?.place.id).toBe("open-meteo:52.52:13.41");
  });

  it("bounds the document to eight places, newest first", async () => {
    for (let i = 0; i < 9; i++) {
      const latitude = 40 + i;
      await writeCachedSnapshot(
        snapshot({
          place: { ...snapshot().place, id: `open-meteo:${latitude}.00:13.41`, latitude },
        }),
      );
    }
    const document = readWeatherCacheDocument();
    expect(document?.entries).toHaveLength(8);
    expect(document?.entries[0]?.place.latitude).toBe(48);
    expect(document?.entries.some((entry) => entry.place.latitude === 40)).toBe(false);
  });

  it("re-bounds an over-long stored entry list on read", () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      snapshot({ place: { ...snapshot().place, latitude: 40 + index } }),
    );
    window.localStorage.setItem(
      WEATHER_CACHE_KEY,
      JSON.stringify({ version: WEATHER_SCHEMA_VERSION, units: "metric", entries }),
    );
    expect(readWeatherCacheDocument()?.entries).toHaveLength(8);
  });

  it("discards a document larger than the byte cap", () => {
    const raw = JSON.stringify({
      version: WEATHER_SCHEMA_VERSION,
      units: "metric",
      entries: [],
      padding: "x".repeat(WEATHER_CACHE_MAX_BYTES),
    });
    window.localStorage.setItem(WEATHER_CACHE_KEY, raw);
    expect(readWeatherCacheDocument()).toBeNull();
  });

  it("persists the unit preference without a forecast and survives clearing snapshots", async () => {
    expect(readUnitsPreference()).toBe("metric");
    expect(await writeUnitsPreference("imperial")).toBe(true);
    expect(readUnitsPreference()).toBe("imperial");
    await writeCachedSnapshot(snapshot());
    await clearCachedSnapshots();
    expect(readCachedSnapshot(52.52, 13.41, "metric")).toBeNull();
    expect(readUnitsPreference()).toBe("imperial");
  });

  it("refuses to store an invalid snapshot and reports it", async () => {
    expect(
      await writeCachedSnapshot({
        ...snapshot(),
        attributable: false,
      } as unknown as WeatherSnapshot),
    ).toBe(true);
    // The unknown extra key is stripped; a genuinely broken one is refused.
    expect(window.localStorage.getItem(WEATHER_CACHE_KEY)).toBeTruthy();
    window.localStorage.clear();
    expect(
      await writeCachedSnapshot({ ...snapshot(), current: null } as unknown as WeatherSnapshot),
    ).toBe(false);
    expect(window.localStorage.getItem(WEATHER_CACHE_KEY)).toBeNull();
  });

  it("survives the forget-everything path (web clears every lingua.* key)", async () => {
    await writeCachedSnapshot(snapshot());
    await forgetSettingsCache();
    expect(window.localStorage.getItem(WEATHER_CACHE_KEY)).toBeNull();
    expect(readCachedSnapshot(52.52, 13.41, "metric")).toBeNull();
  });

  it("reads a DataStore snapshot on Android (arbitrary lingua.* keys hydrate)", () => {
    // Mirrors nativePort.hydrate(): the boot snapshot is seeded into the settings view
    // before the app renders, and this cache reads through the same API.
    setNativeSettingsMode(true);
    setNativeSettingsReady(true);
    seedSettings({
      [WEATHER_CACHE_KEY]: JSON.stringify({
        version: WEATHER_SCHEMA_VERSION,
        units: "metric",
        entries: [snapshot()],
      }),
    });
    expect(readCachedSnapshot(52.52, 13.41, "metric")?.current.temperature).toBe(5.3);
    expect(readUnitsPreference()).toBe("metric");
  });

  it("exposes the parsed document helper for hostile input", () => {
    expect(parseWeatherCacheDocument(null)).toBeNull();
    expect(parseWeatherCacheDocument("[]")).toBeNull();
    expect(
      parseWeatherCacheDocument(
        JSON.stringify({ version: WEATHER_SCHEMA_VERSION, units: "kelvin", entries: [] }),
      ),
    ).toEqual({ version: WEATHER_SCHEMA_VERSION, units: "metric", entries: [] });
  });
});
