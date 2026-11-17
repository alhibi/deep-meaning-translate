import type {
  WeatherCurrent,
  WeatherDay,
  WeatherSnapshot,
  WeatherHour,
  WeatherPlace,
} from "@/lib/weather/types";
import { WEATHER_SCHEMA_VERSION } from "@/lib/weather/types";
import type { WeatherForecastView, WeatherLocationView, WeatherStripProps } from "./state";

/**
 * Deterministic fixtures for the weather component tests. Nothing here is a mock of runtime
 * behaviour: these are plain inputs in the shared contract's shape, with a fixed clock so
 * every age/label assertion is repeatable.
 */
export const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

const ISO = (ms: number) => new Date(ms).toISOString();

export const PLACE: WeatherPlace = {
  id: "open-meteo:52.52:13.41",
  name: "Berlin · Deutschland",
  latitude: 52.52,
  longitude: 13.41,
  countryCode: "DE",
  admin: "Berlin",
  timeZone: "Europe/Berlin",
  source: "search",
};

export const CURRENT: WeatherCurrent = {
  time: ISO(NOW),
  temperature: 12,
  apparentTemperature: 10,
  humidity: 64,
  windSpeed: 14,
  windDirection: 220,
  symbol: "partly-cloudy",
  isDay: true,
};

export function makeHours(count = 24): WeatherHour[] {
  return Array.from({ length: count }, (_value, index) => {
    const hour: WeatherHour = {
      time: ISO(NOW + index * HOUR),
      temperature: 12 - Math.floor(index / 3),
      symbol: index % 2 === 0 ? "partly-cloudy" : "cloudy",
    };
    if (index % 3 === 0) hour.precipitationProbability = 20;
    if (index % 5 === 0 && index > 0) hour.precipitationProbability = 40;
    return hour;
  });
}

export function makeDays(count = 7): WeatherDay[] {
  return Array.from({ length: count }, (_value, index) => {
    const day: WeatherDay = {
      date: new Date(NOW + index * 24 * HOUR).toISOString().slice(0, 10),
      min: 4 + index,
      max: 12 + index,
      symbol: index === 0 ? "partly-cloudy" : index === 1 ? "rain" : "clear",
      precipitationProbability: index === 0 ? 40 : index === 1 ? 70 : 0,
    };
    if (index === 0) {
      day.sunrise = "2026-11-17T07:42:00+01:00";
      day.sunset = "2026-11-17T16:35:00+01:00";
    }
    return day;
  });
}

export function makeSnapshot(overrides: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
  return {
    version: WEATHER_SCHEMA_VERSION,
    provider: "open-meteo",
    place: PLACE,
    units: "metric",
    fetchedAt: NOW - 5 * MINUTE,
    issuedAt: "2026-11-17T11:00:00+01:00",
    current: CURRENT,
    hourly: makeHours(),
    daily: makeDays(),
    attribution: {
      provider: "open-meteo",
      text: "Weather data by Open-Meteo.com",
      url: "https://open-meteo.com/",
    },
    ...overrides,
  };
}

export function makeForecast(overrides: Partial<WeatherForecastView> = {}): WeatherForecastView {
  return {
    snapshot: makeSnapshot(),
    status: "ready",
    freshness: { ageMs: 5 * MINUTE, isStale: false, isExpired: false },
    offline: false,
    refreshing: false,
    error: null,
    ...overrides,
  };
}

export function makeLocation(overrides: Partial<WeatherLocationView> = {}): WeatherLocationView {
  return { status: "granted", pending: "none", canEnable: true, ...overrides };
}

export const noop = () => {};

export function makeProps(overrides: Partial<WeatherStripProps> = {}): WeatherStripProps {
  return {
    locale: "en",
    forecast: makeForecast(),
    location: makeLocation(),
    units: "metric",
    onRefresh: noop,
    onEnableLocation: noop,
    onChooseCity: noop,
    onUnitsChange: noop,
    ...overrides,
  };
}
