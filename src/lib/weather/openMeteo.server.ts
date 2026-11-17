/**
 * Open-Meteo forecast adapter and the shared handler for `/api/weather`.
 *
 * One provider is selected for the whole app (A04 decision: Open-Meteo primary, no key,
 * attribution required). Everything provider-shaped lives in this file: the request URL,
 * the strict response schema, the unit/timezone normalization and the WMO -> symbol map.
 * The route files only own transport authorization, so a provider change touches this file
 * behind the `WeatherProvider` seam from `types.ts`.
 *
 * Request shape (POST, bounded JSON, both /api/weather and /api/native/v1/weather):
 *   { latitude: number, longitude: number, units: "metric"|"imperial", lang: "ar"|"de"|"en" }
 * Response 200: { ok: true, snapshot: WeatherSnapshot }
 * Errors: { ok: false, kind: WeatherErrorKind } with 400/429/504/502.
 *
 * Coordinates are only ever sent to the provider from this server module. They are never
 * logged; the client only ever sends rounded (2dp, ~1 km) values. The response is
 * Cache-Control: no-store because a coordinate-bearing URL must not sit in a shared cache.
 *
 * Licensing boundary (A04, docs/architecture/weather-providers.md): the free Open-Meteo
 * endpoint is explicitly **non-commercial**. Before the product is monetised this one
 * module moves to the customer endpoint (server-held key) or MET Norway becomes primary.
 * `OPEN_METEO_FORECAST_URL` is therefore configuration (env override, validated), never a
 * UI choice: the snapshot carries whatever provider answered and its attribution travels
 * with it. MET Norway is the documented fallback but is NOT implemented in Phase II; a
 * future `metNorway.server.ts` would sit behind the same `WeatherProvider` seam. MET is
 * UTC-only and returns no place timezone, so its adapter would need the place's IANA zone
 * (a query addition) and the snapshot's `expiresAt` from the response `Expires` header.
 * Open-Meteo declares no expiry, so this adapter leaves `expiresAt` absent.
 */
import { z } from "zod";
import { clientAddress, parseAdmittedJson } from "@/lib/requestSafety";
import {
  WEATHER_MAX_DAILY,
  WEATHER_MAX_HOURLY,
  WeatherError,
  classifyWeatherFailure,
  round1,
  roundCoordinate,
  weatherErrorKind,
  weatherPlaceId,
  withDeadline,
  type WeatherErrorKind,
  type WeatherLanguage,
} from "./provider";
import { takeWeatherToken } from "./throttle";
import {
  WEATHER_SCHEMA_VERSION,
  type WeatherAttribution,
  type WeatherDay,
  type WeatherHour,
  type WeatherProvider,
  type WeatherQuery,
  type WeatherSnapshot,
  type WeatherSymbol,
} from "./types";

export const OPEN_METEO_PROVIDER_ID = "open-meteo";
const DEFAULT_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/**
 * The one configuration seam for the provider endpoint (commercial switch, or a customer
 * host). Only an https Open-Meteo host with the expected path is accepted; anything else
 * falls back to the documented default instead of turning a typo into an SSRF.
 */
export function configuredForecastUrl(): string {
  const raw = process.env["OPEN_METEO_FORECAST_URL"];
  if (!raw) return DEFAULT_FORECAST_URL;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return DEFAULT_FORECAST_URL;
    if (!url.hostname.endsWith("open-meteo.com")) return DEFAULT_FORECAST_URL;
    if (url.pathname !== "/v1/forecast") return DEFAULT_FORECAST_URL;
    if (url.username || url.password || url.search || url.hash) return DEFAULT_FORECAST_URL;
    return `${url.origin}${url.pathname}`;
  } catch {
    return DEFAULT_FORECAST_URL;
  }
}

export const OPEN_METEO_FORECAST_URL = configuredForecastUrl();
/** The provider's licence requires this exact credit with a link wherever data is shown. */
export const OPEN_METEO_ATTRIBUTION: WeatherAttribution = {
  provider: OPEN_METEO_PROVIDER_ID,
  text: "Weather data by Open-Meteo.com",
  url: "https://open-meteo.com/",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
};
/** A forecast has no reason to take longer than this; the request's own signal is combined. */
export const WEATHER_UPSTREAM_TIMEOUT_MS = 5000;
export const WEATHER_FORECAST_DAYS = 7;
/** Bodies larger than this are not a forecast; keeps the normalized snapshot small. */
const MAX_PROVIDER_BYTES = 512 * 1024;

/* ------------------------------------------------------------------- WMO symbols */

/**
 * WMO 4677 weather codes, as the provider documents them. Showers are rain/snow (the
 * daily/hourly series has no shower flag), freezing drizzle/rain is sleet (the one symbol
 * that means "wet and freezing"), and anything outside the table is `unknown` — a wrong
 * guess is worse than an honest "unknown" in a weather strip.
 */
const WMO_SYMBOLS: Readonly<Record<number, WeatherSymbol>> = {
  0: "clear",
  1: "clear",
  2: "partly-cloudy",
  3: "cloudy",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "sleet",
  57: "sleet",
  61: "rain",
  63: "rain",
  65: "heavy-rain",
  66: "sleet",
  67: "sleet",
  71: "snow",
  73: "snow",
  75: "snow",
  77: "snow",
  80: "rain",
  81: "rain",
  82: "heavy-rain",
  85: "snow",
  86: "snow",
  95: "thunder",
  96: "thunder",
  99: "thunder",
};

export function wmoSymbol(code: number): WeatherSymbol {
  return WMO_SYMBOLS[code] ?? "unknown";
}

/* -------------------------------------------------------------- response schema */

const NumberValue = z.number();
const NullableNumber = z.number().nullable();
const UnixSeconds = z.number().int().nonnegative();
const WeatherCode = z.number().int();

const CurrentSchema = z.object({
  time: UnixSeconds,
  temperature_2m: NumberValue,
  apparent_temperature: NullableNumber.optional(),
  relative_humidity_2m: NullableNumber.optional(),
  wind_speed_10m: NullableNumber.optional(),
  wind_direction_10m: NullableNumber.optional(),
  weather_code: WeatherCode,
  is_day: z.number().int(),
});
const HourlySchema = z.object({
  time: z.array(UnixSeconds),
  temperature_2m: z.array(NullableNumber),
  precipitation_probability: z.array(NullableNumber).optional(),
  weather_code: z.array(WeatherCode),
});
const DailySchema = z.object({
  time: z.array(UnixSeconds),
  weather_code: z.array(WeatherCode),
  temperature_2m_max: z.array(NullableNumber),
  temperature_2m_min: z.array(NullableNumber),
  precipitation_probability_max: z.array(NullableNumber).optional(),
  sunrise: z.array(NullableNumber).optional(),
  sunset: z.array(NullableNumber).optional(),
});
/** Provider hourly is `forecast_days * 24`; the bound only stops a broken body. */
const MAX_PROVIDER_HOURS = 240;

const ForecastSchema = z
  .object({
    latitude: NumberValue,
    longitude: NumberValue,
    utc_offset_seconds: z.number().int().optional(),
    timezone: z.string().min(1),
    timezone_abbreviation: z.string().optional(),
    current: CurrentSchema,
    hourly: HourlySchema,
    daily: DailySchema,
  })
  .superRefine((data, ctx) => {
    if (data.current.is_day !== 0 && data.current.is_day !== 1) {
      ctx.addIssue({ code: "custom", message: "is_day must be 0 or 1" });
    }
    const { hourly, daily } = data;
    const hours = hourly.time.length;
    if (hours === 0 || hours > MAX_PROVIDER_HOURS) {
      ctx.addIssue({ code: "custom", message: "hourly.time length is out of bounds" });
    }
    if (
      hourly.temperature_2m.length !== hours ||
      hourly.weather_code.length !== hours ||
      (hourly.precipitation_probability !== undefined &&
        hourly.precipitation_probability.length !== hours)
    ) {
      ctx.addIssue({ code: "custom", message: "hourly arrays disagree in length" });
    }
    if (daily.time.length === 0 || daily.time.length > 16) {
      ctx.addIssue({ code: "custom", message: "daily.time length is out of bounds" });
    }
    const days = daily.time.length;
    if (
      daily.weather_code.length !== days ||
      daily.temperature_2m_max.length !== days ||
      daily.temperature_2m_min.length !== days ||
      (daily.precipitation_probability_max !== undefined &&
        daily.precipitation_probability_max.length !== days) ||
      (daily.sunrise !== undefined && daily.sunrise.length !== days) ||
      (daily.sunset !== undefined && daily.sunset.length !== days)
    ) {
      ctx.addIssue({ code: "custom", message: "daily arrays disagree in length" });
    }
  });

type Forecast = z.infer<typeof ForecastSchema>;

/* ------------------------------------------------------------- zone formatting */

const MAX_ZONE_FORMATTERS = 32;
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

/** `Intl` construction is the expensive part; one formatter per zone keeps this cheap. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = zoneFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (zoneFormatters.size >= MAX_ZONE_FORMATTERS) {
    const oldest = zoneFormatters.keys().next();
    if (!oldest.done) zoneFormatters.delete(oldest.value);
  }
  zoneFormatters.set(timeZone, formatter);
  return formatter;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonePartsAt(ms: number, timeZone: string): ZoneParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : Number.NaN;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** True for an IANA zone this runtime can format; an invalid zone is a provider defect. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Provider times are UNIX seconds (UTC instants) because the request asks for
 * `timeformat=unixtime`. The contract wants ISO 8601 **with offset**, so the offset is
 * computed from the instant in the place's zone — not assumed from the response's single
 * `utc_offset_seconds`, which would be one hour wrong for the days after a DST transition
 * inside the seven-day forecast.
 */
export function formatIsoInZone(unixSeconds: number, timeZone: string): string {
  const ms = unixSeconds * 1000;
  const parts = zonePartsAt(ms, timeZone);
  const wallMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetMinutes = Math.round((wallMs - ms) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return (
    `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` +
    `T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}` +
    `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`
  );
}

/** Local calendar date (YYYY-MM-DD) of an instant in the place's zone. */
export function formatDateInZone(unixSeconds: number, timeZone: string): string {
  const parts = zonePartsAt(unixSeconds * 1000, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/* ------------------------------------------------------------------- request URL */

/**
 * The one provider request. `timeformat=unixtime` is deliberate: every provider time is
 * then an exact UTC instant, so the response cannot be read in the wrong zone.
 * `lang` is forwarded for provider-side localization where it exists (the forecast
 * endpoint currently ignores it, probed 2026-11-17: the response was identical with and
 * without it); the query keeps it so a future localized field needs no new query shape.
 */
export function buildOpenMeteoForecastUrl(query: WeatherQuery): string {
  const params = new URLSearchParams({
    latitude: roundCoordinate(query.latitude).toFixed(2),
    longitude: roundCoordinate(query.longitude).toFixed(2),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    timezone: "auto",
    forecast_days: String(WEATHER_FORECAST_DAYS),
    timeformat: "unixtime",
    temperature_unit: query.units === "imperial" ? "fahrenheit" : "celsius",
    wind_speed_unit: query.units === "imperial" ? "mph" : "kmh",
    precipitation_unit: query.units === "imperial" ? "inch" : "mm",
    lang: query.language,
  });
  return `${OPEN_METEO_FORECAST_URL}?${params.toString()}`;
}

/* ---------------------------------------------------------------- normalization */

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Map a validated provider body into the normalized snapshot. Throws `invalid` instead of
 * returning a partial snapshot: a missing temperature on one hour or day discards the
 * whole response, which the route reports as a calm retryable failure.
 */
export function normalizeOpenMeteoForecast(
  raw: unknown,
  query: WeatherQuery,
  fetchedAt: number,
): WeatherSnapshot {
  const parsed = ForecastSchema.safeParse(raw);
  if (!parsed.success) throw new WeatherError("invalid");
  const data: Forecast = parsed.data;

  const timeZone = data.timezone;
  if (!isValidTimeZone(timeZone)) throw new WeatherError("invalid");

  const temperature = data.current.temperature_2m;
  if (!Number.isFinite(temperature)) throw new WeatherError("invalid");
  const apparent = isNumber(data.current.apparent_temperature)
    ? data.current.apparent_temperature
    : undefined;
  const humidity = isNumber(data.current.relative_humidity_2m)
    ? data.current.relative_humidity_2m
    : undefined;
  const windSpeed = isNumber(data.current.wind_speed_10m) ? data.current.wind_speed_10m : undefined;
  const windDirection = isNumber(data.current.wind_direction_10m)
    ? data.current.wind_direction_10m
    : undefined;

  // The first hourly bucket at or after the observation's own hour. The provider starts
  // the series at local midnight, so the already-past hours of today are dropped; the
  // contract bounds the series at 48 h (cache validator) and that is the useful window.
  const firstHour = Math.floor(data.current.time / 3600) * 3600;
  const startIndex = data.hourly.time.findIndex((time) => time >= firstHour);
  if (startIndex < 0) throw new WeatherError("invalid");
  const hourly: WeatherHour[] = [];
  for (let index = startIndex; index < data.hourly.time.length; index++) {
    if (hourly.length >= WEATHER_MAX_HOURLY) break;
    const time = data.hourly.time[index];
    const hourTemperature = data.hourly.temperature_2m[index];
    const code = data.hourly.weather_code[index];
    const probability = data.hourly.precipitation_probability?.[index] ?? null;
    if (time === undefined || hourTemperature === undefined || code === undefined)
      throw new WeatherError("invalid");
    if (hourTemperature === null) throw new WeatherError("invalid");
    hourly.push({
      time: formatIsoInZone(time, timeZone),
      temperature: round1(hourTemperature),
      ...(probability === null ? {} : { precipitationProbability: round1(probability) }),
      symbol: wmoSymbol(code),
    });
  }
  if (hourly.length === 0) throw new WeatherError("invalid");

  const daily: WeatherDay[] = [];
  for (let index = 0; index < data.daily.time.length; index++) {
    if (daily.length >= WEATHER_MAX_DAILY) break;
    const time = data.daily.time[index];
    const code = data.daily.weather_code[index];
    const min = data.daily.temperature_2m_min[index];
    const max = data.daily.temperature_2m_max[index];
    const probability = data.daily.precipitation_probability_max?.[index] ?? null;
    const sunrise = data.daily.sunrise?.[index] ?? null;
    const sunset = data.daily.sunset?.[index] ?? null;
    if (time === undefined || code === undefined) throw new WeatherError("invalid");
    if (min === undefined || max === undefined || min === null || max === null)
      throw new WeatherError("invalid");
    daily.push({
      date: formatDateInZone(time, timeZone),
      min: round1(min),
      max: round1(max),
      ...(probability === null ? {} : { precipitationProbability: round1(probability) }),
      symbol: wmoSymbol(code),
      ...(sunrise === null ? {} : { sunrise: formatIsoInZone(sunrise, timeZone) }),
      ...(sunset === null ? {} : { sunset: formatIsoInZone(sunset, timeZone) }),
    });
  }
  if (daily.length === 0) throw new WeatherError("invalid");

  return {
    version: WEATHER_SCHEMA_VERSION,
    provider: OPEN_METEO_PROVIDER_ID,
    // The provider has no display name for the coordinates (that is the geocoding layer's
    // job and `WeatherQuery` does not carry one); the hook merges the resolved label.
    place: {
      id: weatherPlaceId(query.latitude, query.longitude, OPEN_METEO_PROVIDER_ID),
      name: "",
      latitude: roundCoordinate(query.latitude),
      longitude: roundCoordinate(query.longitude),
      timeZone,
    },
    units: query.units,
    fetchedAt,
    current: {
      time: formatIsoInZone(data.current.time, timeZone),
      temperature: round1(temperature),
      ...(apparent === undefined ? {} : { apparentTemperature: round1(apparent) }),
      ...(humidity === undefined ? {} : { humidity: round1(humidity) }),
      ...(windSpeed === undefined ? {} : { windSpeed: round1(windSpeed) }),
      ...(windDirection === undefined ? {} : { windDirection: round1(windDirection) }),
      symbol: wmoSymbol(data.current.weather_code),
      isDay: data.current.is_day === 1,
    },
    hourly,
    daily,
    attribution: OPEN_METEO_ATTRIBUTION,
  };
}

/* ---------------------------------------------------------------------- provider */

export interface OpenMeteoOptions {
  /** Injected for deterministic tests; defaults to the runtime fetch. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  now?: () => number;
}

function statusFailure(status: number): WeatherError {
  if (status === 429) return new WeatherError("rate");
  if (status === 408) return new WeatherError("timeout");
  if (status >= 500) return new WeatherError("provider");
  return new WeatherError("invalid");
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_PROVIDER_BYTES) throw new WeatherError("invalid");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WeatherError("invalid");
  }
}

/** Open-Meteo adapter: the only module that knows the provider URL, codes and units. */
export function createOpenMeteoProvider(options: OpenMeteoOptions = {}): WeatherProvider {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? WEATHER_UPSTREAM_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  return {
    id: OPEN_METEO_PROVIDER_ID,
    attribution: OPEN_METEO_ATTRIBUTION,
    async forecast(query, signal) {
      const deadline = withDeadline(signal, timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(buildOpenMeteoForecastUrl(query), {
          headers: { Accept: "application/json" },
          signal: deadline.signal,
        });
      } catch (error) {
        deadline.dispose();
        throw classifyWeatherFailure(error, deadline, signal);
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        deadline.dispose();
        throw statusFailure(response.status);
      }
      try {
        const raw = await readJsonBody(response);
        return normalizeOpenMeteoForecast(raw, query, now());
      } catch (error) {
        throw classifyWeatherFailure(error, deadline, signal, "invalid");
      } finally {
        deadline.dispose();
      }
    },
  };
}

export const openMeteoProvider: WeatherProvider = createOpenMeteoProvider();

/* ------------------------------------------------------------ timezone lookups */

const TimeZoneSchema = z.object({
  timezone: z.string().min(1),
  utc_offset_seconds: z.number().optional(),
});

/**
 * Only the place's IANA zone, for the reverse-geocoding label (Nominatim has no timezone).
 * A one-day, one-field forecast is the cheapest authoritative source that returns it
 * (probed 2026-11-17: 333-byte body). Returns null instead of inventing a zone.
 */
export async function fetchOpenMeteoTimeZone(
  latitude: number,
  longitude: number,
  options: {
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
    timeoutMs?: number;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<string | null> {
  const params = new URLSearchParams({
    latitude: roundCoordinate(latitude).toFixed(2),
    longitude: roundCoordinate(longitude).toFixed(2),
    current: "weather_code",
    timezone: "auto",
    forecast_days: "1",
    timeformat: "unixtime",
  });
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const deadline = withDeadline(options.signal, options.timeoutMs ?? WEATHER_UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${OPEN_METEO_FORECAST_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: deadline.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    const raw = await readJsonBody(response);
    const parsed = TimeZoneSchema.safeParse(raw);
    if (!parsed.success || !isValidTimeZone(parsed.data.timezone)) return null;
    return parsed.data.timezone;
  } catch {
    return null;
  } finally {
    deadline.dispose();
  }
}

/* ------------------------------------------------------------- shared responses */

export const WEATHER_JSON_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function weatherJson(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...WEATHER_JSON_HEADERS, ...extraHeaders },
  });
}

/**
 * An honest API surface: only POST is defined on these routes. Without this, a GET falls
 * through to the SSR handler and answers 200 with an HTML document, which looks like a
 * valid response to anything that does not inspect the body.
 */
export function weatherMethodNotAllowed(): Response {
  return new Response(JSON.stringify({ ok: false, kind: "input" }), {
    status: 405,
    headers: {
      ...WEATHER_JSON_HEADERS,
      Allow: "POST, OPTIONS",
    },
  });
}

function failureStatus(kind: WeatherErrorKind): number {
  if (kind === "input") return 400;
  if (kind === "rate") return 429;
  if (kind === "timeout") return 504;
  return 502;
}

function logWeather(event: Record<string, string | number>): void {
  // Deliberately only an outcome and a duration: never a coordinate, a place name, a
  // query string or a provider URL (the URL would contain the rounded coordinates).
  console.info(JSON.stringify({ event: "weather", ...event }));
}

/** POST body for both /api/weather and /api/native/v1/weather. */
export const WeatherBodySchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  units: z.enum(["metric", "imperial"]).default("metric"),
  lang: z.enum(["ar", "de", "en"]).default("en"),
});

type WeatherBody = z.infer<typeof WeatherBodySchema>;

function toQuery(body: WeatherBody): WeatherQuery {
  const language: WeatherLanguage = body.lang;
  return {
    latitude: roundCoordinate(body.latitude),
    longitude: roundCoordinate(body.longitude),
    units: body.units,
    language,
  };
}

/**
 * One handler for the web and native routes: parse the bounded body, spend the weather
 * budget, call the provider with the request's own cancellation signal, and always answer
 * with the normalized snapshot or a named failure.
 */
export async function handleWeatherRequest(
  request: Request,
  provider: WeatherProvider = openMeteoProvider,
): Promise<Response> {
  const admitted = await parseAdmittedJson(request, WeatherBodySchema, () =>
    takeWeatherToken(clientAddress(request)),
  );
  if (!admitted.ok) {
    if (admitted.kind === "rate")
      return weatherJson({ ok: false, kind: "rate" }, 429, { "Retry-After": "60" });
    return weatherJson({ ok: false, kind: "input" }, 400);
  }
  const started = Date.now();
  try {
    const snapshot = await provider.forecast(toQuery(admitted.data), request.signal);
    logWeather({ outcome: "ok", ms: Date.now() - started });
    return weatherJson({ ok: true, snapshot });
  } catch (error) {
    const kind = weatherErrorKind(error);
    if (kind === "cancelled")
      // The caller disconnected (or superseded this request); there is nobody to answer.
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    logWeather({ outcome: kind, ms: Date.now() - started });
    return weatherJson(
      { ok: false, kind },
      failureStatus(kind),
      kind === "rate" ? { "Retry-After": "60" } : {},
    );
  }
}
