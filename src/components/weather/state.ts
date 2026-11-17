import type { Locale } from "@/lib/i18n";
import type { WeatherSnapshot, WeatherSymbol, WeatherUnits } from "@/lib/weather/types";
import { WEATHER_FRESH_MS, WEATHER_STALE_MS } from "@/lib/weather/types";

/**
 * The weather hook (A06) reports these three facts and the location hook (A05) reports the
 * other one. The strip only renders a forecast when a snapshot exists; every other state is
 * derived from the location status, so "no permission" can never look like "no weather".
 */
export type WeatherStatus = "idle" | "loading" | "ready" | "error";
export type WeatherErrorKind = "input" | "network" | "timeout" | "rate" | "invalid" | "provider";

export type WeatherLocationStatus =
  "unsupported" | "denied" | "prompt" | "granted" | "manual" | "revoked";

export type WeatherLocationReason =
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

export type WeatherPending = "none" | "locating" | "searching";

/** A06's freshness verdict, passed through by the integration owner. */
export interface WeatherFreshnessView {
  ageMs: number;
  isStale: boolean;
  isExpired: boolean;
}

export interface WeatherForecastView {
  snapshot: WeatherSnapshot | null;
  status: WeatherStatus;
  freshness: WeatherFreshnessView | null;
  offline?: boolean | undefined;
  refreshing?: boolean | undefined;
  error?: WeatherErrorKind | null | undefined;
}

export interface WeatherLocationView {
  status: WeatherLocationStatus;
  pending?: WeatherPending | undefined;
  canEnable?: boolean | undefined;
  reason?: WeatherLocationReason | undefined;
}

export interface WeatherStripProps {
  locale: Locale;
  forecast: WeatherForecastView;
  location: WeatherLocationView;
  units: WeatherUnits;
  /** Manual retry: the strip's error state and the sheet's "Update" control. */
  onRefresh: () => void;
  /** Must call the location hook's enableLocation() from a real user gesture only. */
  onEnableLocation: () => void;
  /** Opens the manual city alternative owned by the integration (A05 picker). */
  onChooseCity: () => void;
  onUnitsChange: (units: WeatherUnits) => void;
  /** Open the expanded surface immediately; used by integration tests and deep links. */
  defaultOpen?: boolean | undefined;
}

export interface WeatherSheetProps {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  forecast: WeatherForecastView;
  location: WeatherLocationView;
  units: WeatherUnits;
  onRefresh: () => void;
  onEnableLocation: () => void;
  onChooseCity: () => void;
  onUnitsChange: (units: WeatherUnits) => void;
}

export type WeatherFreshness = "fresh" | "stale" | "expired";

export type WeatherSurface =
  | WeatherForecastSurface
  | { kind: "loading"; locating: boolean }
  | { kind: "need-place"; reason: WeatherLocationReason }
  | { kind: "permission" }
  | { kind: "denied"; revoked: boolean; reason: WeatherLocationReason | null }
  | { kind: "unsupported"; reason: WeatherLocationReason | null }
  | { kind: "offline-empty" }
  | { kind: "error" };

export interface WeatherForecastSurface {
  kind: "forecast";
  snapshot: WeatherSnapshot;
  freshness: WeatherFreshness;
  /** null when freshness was not supplied: the UI then makes no age or freshness claim. */
  ageMs: number | null;
  offline: boolean;
  updateFailed: boolean;
  locationOff: boolean;
}

export const WEATHER_SYMBOLS: readonly WeatherSymbol[] = [
  "clear",
  "partly-cloudy",
  "cloudy",
  "fog",
  "drizzle",
  "rain",
  "heavy-rain",
  "sleet",
  "snow",
  "thunder",
  "unknown",
];

export function isWeatherSymbol(value: unknown): value is WeatherSymbol {
  return typeof value === "string" && (WEATHER_SYMBOLS as readonly string[]).includes(value);
}

/**
 * One place decides which surface a set of facts may paint.
 *
 * Rules, in order:
 * 1. A snapshot always renders (stale-while-revalidate), with its age and its degradation
 *    flags — but never as "fresh" when freshness says otherwise.
 * 2. Without a snapshot, the location status decides: an absent permission is an invitation,
 *    not an empty forecast. A granted location whose geocode failed is a "choose a city"
 *    state, because permission is fine and retrying the fix cannot become a place.
 * 3. Only after that do forecast errors/offline show their calm empty state.
 */
export function resolveWeatherSurface(input: {
  forecast: WeatherForecastView;
  location: WeatherLocationView;
}): WeatherSurface {
  const { forecast, location } = input;
  if (forecast.snapshot) return forecastSurface(forecast.snapshot, forecast, location);

  switch (location.status) {
    case "unsupported":
      return { kind: "unsupported", reason: location.reason ?? null };
    case "denied":
      return { kind: "denied", revoked: false, reason: location.reason ?? null };
    case "revoked":
      return { kind: "denied", revoked: true, reason: location.reason ?? null };
    case "prompt":
      return { kind: "permission" };
    case "granted":
    case "manual": {
      if (location.reason === "geocode-failed" || location.reason === "geocode-not-found") {
        return { kind: "need-place", reason: location.reason };
      }
      if (forecast.offline === true) return { kind: "offline-empty" };
      if (forecast.status === "error") return { kind: "error" };
      // "locating" is about the location fix only; a forecast request in flight is just loading.
      return { kind: "loading", locating: location.pending === "locating" };
    }
  }
}

function forecastSurface(
  snapshot: WeatherSnapshot,
  forecast: WeatherForecastView,
  location: WeatherLocationView,
): WeatherForecastSurface {
  const supplied = forecast.freshness;
  const ageMs = supplied && Number.isFinite(supplied.ageMs) ? Math.max(0, supplied.ageMs) : null;
  // Trust the caller's verdict AND the age it reported: if either says the data is old, it is
  // old. This is the one rule that keeps a cache from ever being painted as current.
  const expired =
    supplied?.isExpired === true || (ageMs !== null && ageMs > WEATHER_STALE_MS) === true;
  const stale =
    expired ||
    supplied === null ||
    supplied?.isStale === true ||
    (ageMs !== null && ageMs > WEATHER_FRESH_MS);
  const freshness: WeatherFreshness = expired ? "expired" : stale ? "stale" : "fresh";
  return {
    kind: "forecast",
    snapshot,
    freshness,
    ageMs,
    offline: forecast.offline === true,
    updateFailed: forecast.status === "error" || (forecast.error ?? null) !== null,
    locationOff: location.status === "denied" || location.status === "revoked",
  };
}
