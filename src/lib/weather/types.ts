/**
 * Shared weather contract (Phase II).
 *
 * The UI renders a normalized snapshot and never talks to a provider. One adapter maps a
 * provider response into this shape, so a provider change is one file. Coordinates are
 * deliberately coarse in anything that is persisted: weather accuracy does not need a
 * precise fix, and a precise position is not retained (see docs/security).
 */

/** Bumped when the persisted snapshot shape changes. A cache of another version is discarded. */
export const WEATHER_SCHEMA_VERSION = 1;

export type WeatherUnits = "metric" | "imperial";

/** Normalized condition symbols. Adapters map provider codes; the UI owns the drawing. */
export type WeatherSymbol =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy-rain"
  | "sleet"
  | "snow"
  | "thunder"
  | "unknown";

export interface WeatherPlace {
  /** Stable cache identity. Derived from rounded coordinates + provider, never the raw GPS fix. */
  id: string;
  /** Display label in the interface language when known ("Berlin · Deutschland"). */
  name: string;
  /** Rounded to two decimals (~1 km) for anything stored. */
  latitude: number;
  longitude: number;
  countryCode?: string | undefined;
  admin?: string | undefined;
  timeZone: string;
  /** How this place was chosen. Geolocation only after explicit consent. */
  source?: "search" | "geolocation" | "default";
  /**
   * Required credit for the place name when it was resolved by a third party (the
   * reverse-geocoding service), e.g. "Place name © OpenStreetMap contributors".
   * Absent for names chosen manually from the forecast provider's own geocoder.
   */
  placeCredit?: string | undefined;
}

export interface WeatherCurrent {
  /** Provider observation time (ISO 8601 with offset). Not the fetch time. */
  time: string;
  temperature: number;
  apparentTemperature?: number | undefined;
  humidity?: number | undefined;
  windSpeed?: number | undefined;
  windDirection?: number | undefined;
  symbol: WeatherSymbol;
  isDay: boolean;
}

export interface WeatherHour {
  time: string;
  temperature: number;
  precipitationProbability?: number | undefined;
  symbol: WeatherSymbol;
}

export interface WeatherDay {
  /** Local calendar date, YYYY-MM-DD in the place's time zone. */
  date: string;
  min: number;
  max: number;
  precipitationProbability?: number | undefined;
  symbol: WeatherSymbol;
  sunrise?: string | undefined;
  sunset?: string | undefined;
}

export interface WeatherAttribution {
  provider: string;
  text: string;
  url: string;
  /** Human-readable licence name the attribution text links to (e.g. "CC BY 4.0"). */
  license?: string | undefined;
  licenseUrl?: string | undefined;
}

export interface WeatherSnapshot {
  version: typeof WEATHER_SCHEMA_VERSION;
  provider: string;
  place: WeatherPlace;
  units: WeatherUnits;
  /** When today fetched it (ms epoch). */
  fetchedAt: number;
  /** When the provider issued/updated the forecast (ISO 8601), when supplied. */
  issuedAt?: string | undefined;
  /**
   * Provider-declared expiry (ms epoch) when it supplies one (MET Norway does, as an
   * HTTP Expires header). The cache must not revalidate before it even if the app's own
   * freshness window is shorter.
   */
  expiresAt?: number | undefined;
  current: WeatherCurrent;
  hourly: WeatherHour[];
  daily: WeatherDay[];
  attribution: WeatherAttribution;
}

/** What the adapter is asked for. Coordinates are only sent to our own server route. */
export interface WeatherQuery {
  latitude: number;
  longitude: number;
  units: WeatherUnits;
  /** Interface language for provider-side localization where supported. */
  language: "ar" | "de" | "en";
}

export interface WeatherProvider {
  readonly id: string;
  readonly attribution: WeatherAttribution;
  /** Fetch and normalize. Must throw a typed error, never return a partial snapshot. */
  forecast(query: WeatherQuery, signal?: AbortSignal): Promise<WeatherSnapshot>;
}

/** Freshness policy in one place: the UI and the cache both read it. */
export const WEATHER_FRESH_MS = 15 * 60 * 1000;
export const WEATHER_STALE_MS = 3 * 60 * 60 * 1000;
