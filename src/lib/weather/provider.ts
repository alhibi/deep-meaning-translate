/**
 * Weather contract helpers shared by the server adapter, the device cache and the hook.
 *
 * Nothing here talks to a provider: the adapter maps one provider's response into
 * `types.ts` shapes, and everything else validates/moves that shape. Keeping the
 * validator here means the network response, the device cache and the route body are all
 * checked against one definition — device storage and the network are equally untrusted.
 */
import {
  WEATHER_FRESH_MS,
  WEATHER_SCHEMA_VERSION,
  type WeatherAttribution,
  type WeatherCurrent,
  type WeatherDay,
  type WeatherHour,
  type WeatherPlace,
  type WeatherQuery,
  type WeatherSnapshot,
  type WeatherSymbol,
  type WeatherUnits,
} from "./types";

/** Interface language a provider call may be localized for. */
export type WeatherLanguage = WeatherQuery["language"];

/**
 * Every failure one weather call can produce. The route reports the same names to the
 * client, so the UI never learns a provider URL, a status code or a coordinate.
 * `cancelled` is internal: it means the caller's own AbortSignal fired (unmount, new
 * place), which is a quiet supersession and not an error the UI should show.
 */
export type WeatherErrorKind =
  "input" | "network" | "timeout" | "rate" | "invalid" | "provider" | "cancelled";

export class WeatherError extends Error {
  readonly kind: WeatherErrorKind;

  constructor(kind: WeatherErrorKind, message = kind) {
    super(message);
    this.name = "WeatherError";
    this.kind = kind;
  }
}

export function weatherErrorKind(error: unknown): WeatherErrorKind {
  return error instanceof WeatherError ? error.kind : "provider";
}

/** The provider's own response is not something the UI may show. */
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

export const WEATHER_UNITS: readonly WeatherUnits[] = ["metric", "imperial"];

export function isWeatherSymbol(value: unknown): value is WeatherSymbol {
  return typeof value === "string" && (WEATHER_SYMBOLS as readonly string[]).includes(value);
}

export function isWeatherUnits(value: unknown): value is WeatherUnits {
  return value === "metric" || value === "imperial";
}

/**
 * Weather accuracy does not need a precise fix, so anything stored or sent is rounded to
 * two decimals (~1 km). Never keep a raw GPS value: the rounded number is the identity.
 */
export function roundCoordinate(value: number): number {
  return halfAwayFromZero(value, 100);
}

/** One decimal is what the provider itself returns; conversion paths keep the same price. */
export function round1(value: number): number {
  return halfAwayFromZero(value, 10);
}

/**
 * Math.round rounds .5 toward +Infinity, so a negative temperature would round
 * asymmetrically (-0.15 -> -0.1 instead of -0.2). Round magnitudes and re-apply the sign,
 * and never keep JavaScript's -0 (it serializes differently and reads as damage).
 */
function halfAwayFromZero(value: number, factor: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(Math.abs(value) * factor) / factor;
  const result = value < 0 ? -rounded : rounded;
  return Object.is(result, -0) ? 0 : result;
}

const coordinateText = (value: number) => roundCoordinate(value).toFixed(2);

/** Stable place identity: rounded coordinates + provider, never the raw fix (types.ts). */
export function weatherPlaceId(
  latitude: number,
  longitude: number,
  provider = "open-meteo",
): string {
  return `${provider}:${coordinateText(latitude)}:${coordinateText(longitude)}`;
}

/** Cache identity for one snapshot: the place identity plus the unit family it is in. */
export function weatherCacheKey(latitude: number, longitude: number, units: WeatherUnits): string {
  return `${weatherPlaceId(latitude, longitude)}|${units}`;
}

/* --------------------------------------------------------------------- validation */

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?[+-]\d{2}:\d{2}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** 2001-09-09 .. 5138-11-16: rejects 0/NaN/"now" style damage without rejecting any real fetch. */
const MIN_EPOCH = 1_000_000_000_000;
const MAX_EPOCH = 100_000_000_000_000;

/** Capacities the cache and the validator both enforce (lead contract: 48 h / 16 d). */
export const WEATHER_MAX_HOURLY = 48;
export const WEATHER_MAX_DAILY = 16;
/** A snapshot larger than this is damage, not a forecast. Keeps the on-device value well under 200 KiB. */
export const WEATHER_MAX_SNAPSHOT_BYTES = 200 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function parsePlace(value: unknown): WeatherPlace | null {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const name = value["name"];
  const latitude = value["latitude"];
  const longitude = value["longitude"];
  const timeZone = value["timeZone"];
  if (typeof id !== "string" || !id) return null;
  if (typeof name !== "string") return null;
  if (!finite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!finite(longitude) || longitude < -180 || longitude > 180) return null;
  if (typeof timeZone !== "string" || !timeZone) return null;
  const countryCode = value["countryCode"];
  const admin = value["admin"];
  const source = value["source"];
  const placeCredit = value["placeCredit"];
  if (countryCode !== undefined && (typeof countryCode !== "string" || !countryCode)) return null;
  if (admin !== undefined && typeof admin !== "string") return null;
  if (
    source !== undefined &&
    source !== "search" &&
    source !== "geolocation" &&
    source !== "default"
  )
    return null;
  if (placeCredit !== undefined && typeof placeCredit !== "string") return null;
  return {
    id,
    name,
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
    ...(typeof countryCode === "string" ? { countryCode } : {}),
    ...(typeof admin === "string" ? { admin } : {}),
    timeZone,
    ...(source === "search" || source === "geolocation" || source === "default" ? { source } : {}),
    ...(typeof placeCredit === "string" ? { placeCredit } : {}),
  };
}

function parseCurrent(value: unknown): WeatherCurrent | null {
  if (!isRecord(value)) return null;
  const time = value["time"];
  const temperature = value["temperature"];
  const symbol = value["symbol"];
  const isDay = value["isDay"];
  if (typeof time !== "string" || !ISO_WITH_OFFSET.test(time)) return null;
  if (!finite(temperature)) return null;
  if (!isWeatherSymbol(symbol)) return null;
  if (typeof isDay !== "boolean") return null;
  const apparentTemperature = value["apparentTemperature"];
  const humidity = value["humidity"];
  const windSpeed = value["windSpeed"];
  const windDirection = value["windDirection"];
  if (apparentTemperature !== undefined && !finite(apparentTemperature)) return null;
  if (humidity !== undefined && (!finite(humidity) || humidity < 0 || humidity > 100)) return null;
  if (windSpeed !== undefined && (!finite(windSpeed) || windSpeed < 0)) return null;
  if (
    windDirection !== undefined &&
    (!finite(windDirection) || windDirection < 0 || windDirection > 360)
  )
    return null;
  return {
    time,
    temperature,
    ...(apparentTemperature !== undefined
      ? { apparentTemperature: apparentTemperature as number }
      : {}),
    ...(humidity !== undefined ? { humidity: humidity as number } : {}),
    ...(windSpeed !== undefined ? { windSpeed: windSpeed as number } : {}),
    ...(windDirection !== undefined ? { windDirection: windDirection as number } : {}),
    symbol,
    isDay,
  };
}

function parseHour(value: unknown): WeatherHour | null {
  if (!isRecord(value)) return null;
  const time = value["time"];
  const temperature = value["temperature"];
  const symbol = value["symbol"];
  if (typeof time !== "string" || !ISO_WITH_OFFSET.test(time)) return null;
  if (!finite(temperature)) return null;
  if (!isWeatherSymbol(symbol)) return null;
  const probability = value["precipitationProbability"];
  if (probability !== undefined && (!finite(probability) || probability < 0 || probability > 100))
    return null;
  return {
    time,
    temperature,
    ...(probability !== undefined ? { precipitationProbability: probability as number } : {}),
    symbol,
  };
}

function parseDay(value: unknown): WeatherDay | null {
  if (!isRecord(value)) return null;
  const date = value["date"];
  const min = value["min"];
  const max = value["max"];
  const symbol = value["symbol"];
  if (typeof date !== "string" || !DATE_ONLY.test(date)) return null;
  if (!finite(min) || !finite(max)) return null;
  if (!isWeatherSymbol(symbol)) return null;
  const probability = value["precipitationProbability"];
  const sunrise = value["sunrise"];
  const sunset = value["sunset"];
  if (probability !== undefined && (!finite(probability) || probability < 0 || probability > 100))
    return null;
  if (sunrise !== undefined && (typeof sunrise !== "string" || !ISO_WITH_OFFSET.test(sunrise)))
    return null;
  if (sunset !== undefined && (typeof sunset !== "string" || !ISO_WITH_OFFSET.test(sunset)))
    return null;
  return {
    date,
    min,
    max,
    ...(probability !== undefined ? { precipitationProbability: probability as number } : {}),
    symbol,
    ...(typeof sunrise === "string" ? { sunrise } : {}),
    ...(typeof sunset === "string" ? { sunset } : {}),
  };
}

function parseAttribution(value: unknown): WeatherAttribution | null {
  if (!isRecord(value)) return null;
  const provider = value["provider"];
  const attributionText = value["text"];
  const url = value["url"];
  const license = value["license"];
  const licenseUrl = value["licenseUrl"];
  if (typeof provider !== "string" || !provider) return null;
  if (typeof attributionText !== "string" || !attributionText) return null;
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return null;
  if (license !== undefined && (typeof license !== "string" || !license)) return null;
  if (
    licenseUrl !== undefined &&
    (typeof licenseUrl !== "string" || !/^https?:\/\//.test(licenseUrl))
  )
    return null;
  return {
    provider,
    text: attributionText,
    url,
    ...(typeof license === "string" ? { license } : {}),
    ...(typeof licenseUrl === "string" ? { licenseUrl } : {}),
  };
}

function parseList<T>(value: unknown, max: number, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return null;
  const out: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

/**
 * The one device/network read validator. Returns a sanitized copy (unknown keys dropped)
 * or null; a malformed snapshot is discarded as a whole rather than partially rendered.
 * Coordinates are re-rounded on read so a stored value cannot reintroduce a precise fix.
 */
export function parseWeatherSnapshot(value: unknown): WeatherSnapshot | null {
  if (!isRecord(value)) return null;
  if (value["version"] !== WEATHER_SCHEMA_VERSION) return null;
  const provider = value["provider"];
  if (typeof provider !== "string" || !provider) return null;
  const place = parsePlace(value["place"]);
  if (!place) return null;
  const units = value["units"];
  if (!isWeatherUnits(units)) return null;
  const fetchedAt = value["fetchedAt"];
  if (!finite(fetchedAt) || fetchedAt < MIN_EPOCH || fetchedAt > MAX_EPOCH) return null;
  const issuedAt = value["issuedAt"];
  if (issuedAt !== undefined && (typeof issuedAt !== "string" || !ISO_WITH_OFFSET.test(issuedAt)))
    return null;
  const expiresAt = value["expiresAt"];
  if (
    expiresAt !== undefined &&
    (!finite(expiresAt) || expiresAt < MIN_EPOCH || expiresAt > MAX_EPOCH)
  )
    return null;
  const current = parseCurrent(value["current"]);
  if (!current) return null;
  const hourly = parseList(value["hourly"], WEATHER_MAX_HOURLY, parseHour);
  if (!hourly) return null;
  const daily = parseList(value["daily"], WEATHER_MAX_DAILY, parseDay);
  if (!daily) return null;
  const attribution = parseAttribution(value["attribution"]);
  if (!attribution) return null;
  return {
    version: WEATHER_SCHEMA_VERSION,
    provider,
    place,
    units,
    fetchedAt,
    ...(typeof issuedAt === "string" ? { issuedAt } : {}),
    ...(finite(expiresAt) ? { expiresAt } : {}),
    current,
    hourly,
    daily,
    attribution,
  };
}

/* ------------------------------------------------------------------- freshness */

/**
 * May this snapshot be served without asking the provider again?
 *
 * Two wins make it fresh: the app's own window (`WEATHER_FRESH_MS`) and a provider-declared
 * expiry (MET Norway's `Expires`, carried as `expiresAt`). The provider's own validity
 * always wins: revalidating before it has expired is wasted quota and, for MET, against its
 * documented minimum repeat interval.
 */
export function weatherIsFresh(snapshot: WeatherSnapshot, now = Date.now()): boolean {
  if (snapshot.expiresAt !== undefined && now < snapshot.expiresAt) return true;
  return now - snapshot.fetchedAt < WEATHER_FRESH_MS;
}

/* ------------------------------------------------------------------- units conversion */

const KMH_PER_MPH = 1.609344;

/**
 * Re-label a snapshot into the other unit family without a second provider call.
 *
 * A units preference is a display choice, not a new forecast: converting the snapshot in
 * memory lets the person switch instantly, and the next scheduled revalidation fetches the
 * preferred units natively. Only the unit-bearing numbers change; probabilities, humidity,
 * wind direction, times and attribution are unit-free.
 */
export function convertSnapshotUnits(
  snapshot: WeatherSnapshot,
  units: WeatherUnits,
): WeatherSnapshot {
  if (snapshot.units === units) return snapshot;
  const toImperial = units === "imperial";
  const temperature = (value: number) =>
    round1(toImperial ? (value * 9) / 5 + 32 : ((value - 32) * 5) / 9);
  const speed = (value: number) => round1(toImperial ? value / KMH_PER_MPH : value * KMH_PER_MPH);
  return {
    ...snapshot,
    units,
    current: {
      ...snapshot.current,
      temperature: temperature(snapshot.current.temperature),
      ...(snapshot.current.apparentTemperature !== undefined
        ? { apparentTemperature: temperature(snapshot.current.apparentTemperature) }
        : {}),
      ...(snapshot.current.windSpeed !== undefined
        ? { windSpeed: speed(snapshot.current.windSpeed) }
        : {}),
    },
    hourly: snapshot.hourly.map((hour) => ({
      ...hour,
      temperature: temperature(hour.temperature),
    })),
    daily: snapshot.daily.map((day) => ({
      ...day,
      min: temperature(day.min),
      max: temperature(day.max),
    })),
  };
}

/* ------------------------------------------------------------------------- deadlines */

export interface Deadline {
  /** Hand this to fetch: it aborts when the deadline expires or the caller aborts. */
  signal: AbortSignal;
  /** True only when this deadline is what aborted the work (not the caller). */
  timedOut: () => boolean;
  /** Release the timer/listeners when the request finished. */
  dispose: () => void;
}

/**
 * One cancellation source for a bounded outbound call: the caller's AbortSignal combined
 * with a hard deadline. The two are kept distinguishable — a caller abort is a quiet
 * supersession that must never surface as "timeout", and the transport deadline is the
 * timeout the UI reports. Uses `AbortSignal.timeout`/`AbortSignal.any` when the runtime
 * has them and falls back to a timer/listener composition for older WebViews.
 */
export function withDeadline(caller: AbortSignal | undefined, timeoutMs: number): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nativeTimeout: AbortSignal | null = null;

  const onTimeout = () => {
    timedOut = true;
    controller.abort();
  };
  if (typeof AbortSignal.timeout === "function") {
    try {
      nativeTimeout = AbortSignal.timeout(timeoutMs);
    } catch {
      nativeTimeout = null;
    }
  }
  if (nativeTimeout) {
    if (nativeTimeout.aborted) onTimeout();
    else nativeTimeout.addEventListener("abort", onTimeout, { once: true });
  } else {
    timer = setTimeout(onTimeout, timeoutMs);
  }

  const onCallerAbort = () => controller.abort();
  if (caller) {
    if (caller.aborted) controller.abort();
    else caller.addEventListener("abort", onCallerAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      if (timer) clearTimeout(timer);
      nativeTimeout?.removeEventListener("abort", onTimeout);
      caller?.removeEventListener("abort", onCallerAbort);
    },
  };
}

/**
 * Map a fetch/body failure into the product's weather failure names. Order matters: the
 * deadline is checked first, because when it fires the fetch rejects with an AbortError
 * that would otherwise look like a caller cancellation.
 */
export function classifyWeatherFailure(
  error: unknown,
  deadline?: Deadline,
  caller?: AbortSignal,
  /** What a non-abort failure means for this call (a read failure is `invalid`). */
  fallback: WeatherErrorKind = "network",
): WeatherError {
  if (error instanceof WeatherError) return error;
  if (deadline?.timedOut()) return new WeatherError("timeout");
  if (caller?.aborted) return new WeatherError("cancelled");
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "TimeoutError") return new WeatherError("timeout");
  if (name === "AbortError") return new WeatherError("cancelled");
  return new WeatherError(fallback);
}
