/**
 * Place lookup for the weather surfaces: forward geocoding via Open-Meteo, reverse
 * geocoding via Nominatim, both **server-side only** (the client never calls a provider).
 *
 * Forward: `https://geocoding-api.open-meteo.com/v1/search` — no key, localized name,
 * country/admin1/timezone (probed 2026-11-17).
 * Reverse: Open-Meteo has no reverse endpoint (probed: 400 without `name`, and an empty
 * name returns no results). Nominatim is used instead (format=jsonv2, localized
 * `display_name`/`address`). Its usage policy requires a descriptive User-Agent and at most
 * one request per second, so every reverse call goes through one serialized queue and
 * successful labels are cached in memory for the process lifetime. The service is
 * pluggable behind `ReverseGeocoder` so a distribution where the policy is a problem can
 * swap it without touching the route. The place label must carry its credit
 * ("Place name © OpenStreetMap contributors", ODbL) wherever it is shown.
 *
 * Request shape (POST, bounded JSON, web /api/weather/place and native
 * /api/native/v1/weather/place), exactly one of:
 *   forward: { q: string 1..80 code points, lang: "ar"|"de"|"en" }
 *   reverse: { latitude: number -90..90, longitude: number -180..180, lang }
 * Response 200: { ok: true, places: WeatherPlace[] } (max 8; forward only; reverse returns
 * one place, or an empty list when the reverse service fails — never an invented name).
 * Errors: { ok: false, kind } with 400/429/504/502.
 *
 * Neither the query text nor a coordinate is logged.
 */
import { z } from "zod";
import { clientAddress, parseAdmittedJson } from "@/lib/requestSafety";
import {
  WeatherError,
  classifyWeatherFailure,
  roundCoordinate,
  weatherErrorKind,
  weatherPlaceId,
  withDeadline,
  type WeatherErrorKind,
} from "./provider";
import { fetchOpenMeteoTimeZone, isValidTimeZone, weatherJson } from "./openMeteo.server";
import { takePlaceToken } from "./throttle";
import type { WeatherPlace } from "./types";

export const OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
export const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
/** A descriptive identity is required by the Nominatim usage policy (no generic UA). */
export const NOMINATIM_USER_AGENT = "today-weather/1.0 (+https://fluently.today)";
/** Attribution the resolved reverse name must carry wherever it is shown. */
export const NOMINATIM_PLACE_CREDIT = "Place name © OpenStreetMap contributors";
export const PLACE_MAX_RESULTS = 8;
export const PLACE_UPSTREAM_TIMEOUT_MS = 5000;
const MAX_REVERSE_CACHE = 500;
const NOMINATIM_MIN_INTERVAL_MS = 1000;
const MAX_PLACE_NAME = 80;
const LANG = z.enum(["ar", "de", "en"]);
type PlaceLanguage = z.infer<typeof LANG>;

/* ------------------------------------------------------------------ request body */

const ForwardRequest = z.strictObject({
  q: z
    .string()
    .trim()
    .min(1)
    // Code points, not UTF-16 units: an Arabic letter + haraka or an emoji is one character
    // to the person typing it.
    .refine((value) => Array.from(value).length <= MAX_PLACE_NAME),
  lang: LANG,
});
const ReverseRequest = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  lang: LANG,
});
/** Exactly one shape: a mixed body fails both branches and is refused as input. */
export const PlaceRequestSchema = z.union([ForwardRequest, ReverseRequest]);
export type PlaceRequest = z.infer<typeof PlaceRequestSchema>;

/* ------------------------------------------------------------- forward geocoding */

const GeoPlaceSchema = z.object({
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  country_code: z.string().min(2).max(2).optional(),
  admin1: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
});
const GeoSearchSchema = z.object({ results: z.array(GeoPlaceSchema).max(50).optional() });

/**
 * Map provider results to the shared place shape. A result without a usable IANA timezone
 * is skipped rather than filled with a guess: every snapshot needs a real zone.
 */
export function mapGeocodingResults(raw: unknown): WeatherPlace[] {
  const parsed = GeoSearchSchema.safeParse(raw);
  if (!parsed.success) return [];
  const places: WeatherPlace[] = [];
  const seen = new Set<string>();
  for (const result of parsed.data.results ?? []) {
    const timeZone = result.timezone;
    if (!timeZone || !isValidTimeZone(timeZone)) continue;
    const latitude = roundCoordinate(result.latitude);
    const longitude = roundCoordinate(result.longitude);
    const id = weatherPlaceId(latitude, longitude);
    if (seen.has(id)) continue;
    seen.add(id);
    places.push({
      id,
      name: result.name.slice(0, MAX_PLACE_NAME),
      latitude,
      longitude,
      ...(result.country_code ? { countryCode: result.country_code.toUpperCase() } : {}),
      ...(result.admin1 ? { admin: result.admin1 } : {}),
      timeZone,
      source: "search",
    });
    if (places.length >= PLACE_MAX_RESULTS) break;
  }
  return places;
}

/* ------------------------------------------------------------- reverse geocoding */

export interface ReverseLabel {
  name: string;
  countryCode?: string | undefined;
  admin?: string | undefined;
}

/** The seam: any implementation must return null on failure, never a guessed name. */
export interface ReverseGeocoder {
  readonly id: string;
  reverse(
    latitude: number,
    longitude: number,
    language: PlaceLanguage,
    signal?: AbortSignal | undefined,
  ): Promise<ReverseLabel | null>;
}

export interface NominatimQueue {
  /** Run one call no sooner than the policy interval after the previous one. */
  schedule<T>(run: () => Promise<T>): Promise<T>;
}

/**
 * One serialized, spaced queue for the whole process: Nominatim asks for at most one
 * request per second and no bursts. A multi-instance deployment would need one more
 * coordination layer; recorded as a risk in the task note rather than hidden here.
 */
export function createNominatimQueue(minIntervalMs = NOMINATIM_MIN_INTERVAL_MS): NominatimQueue {
  let chain: Promise<unknown> = Promise.resolve();
  let lastStartedAt = 0;
  return {
    schedule<T>(run: () => Promise<T>): Promise<T> {
      const next = chain.then(async () => {
        const wait = Math.max(0, lastStartedAt + minIntervalMs - Date.now());
        if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
        lastStartedAt = Date.now();
        return run();
      });
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

const nominatimQueue = createNominatimQueue();

const NominatimAddressSchema = z.object({
  // Empty strings are common in Nominatim's address object; treat them as absent below.
  city: z.string().optional(),
  locality: z.string().optional(),
  town: z.string().optional(),
  village: z.string().optional(),
  state: z.string().optional(),
  country_code: z.string().optional(),
});
const NominatimSchema = z.object({
  display_name: z.string().optional(),
  name: z.string().optional(),
  address: NominatimAddressSchema.optional(),
  licence: z.string().optional(),
});

const nonEmpty = (value: string | undefined): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/**
 * One place label from a Nominatim body. The name is the settlement the person is in
 * (city/locality/town/village), falling back to the first one or two `display_name`
 * components, bounded — never a generated city name. `country_code` is upper-cased;
 * `state` becomes `admin`. The timezone cannot come from this response and is resolved by
 * the caller from Open-Meteo for the same coordinates.
 */
export function mapNominatimPlace(raw: unknown): ReverseLabel | null {
  const parsed = NominatimSchema.safeParse(raw);
  if (!parsed.success) return null;
  const data = parsed.data;
  const address = data.address ?? {};
  const settlement =
    nonEmpty(address.city) ??
    nonEmpty(address.locality) ??
    nonEmpty(address.town) ??
    nonEmpty(address.village);
  const fromDisplay = (data.display_name ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
  const name = (settlement ?? fromDisplay).trim().slice(0, MAX_PLACE_NAME);
  if (!name) return null;
  const countryCode = nonEmpty(address.country_code);
  const admin = nonEmpty(address.state);
  return {
    name,
    ...(countryCode && /^[A-Za-z]{2}$/.test(countryCode)
      ? { countryCode: countryCode.toUpperCase() }
      : {}),
    ...(admin ? { admin } : {}),
  };
}

export interface NominatimOptions {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  queue?: NominatimQueue;
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
}

/** Nominatim reverse adapter. Any failure/timeout resolves to null (honest empty place). */
export function createNominatimReverseGeocoder(options: NominatimOptions = {}): ReverseGeocoder {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const queue = options.queue ?? nominatimQueue;
  const timeoutMs = options.timeoutMs ?? PLACE_UPSTREAM_TIMEOUT_MS;
  return {
    id: "nominatim",
    async reverse(latitude, longitude, language, signal) {
      const params = new URLSearchParams({
        format: "jsonv2",
        lat: roundCoordinate(latitude).toFixed(2),
        lon: roundCoordinate(longitude).toFixed(2),
        "accept-language": language,
      });
      const url = `${NOMINATIM_REVERSE_URL}?${params.toString()}`;
      try {
        return await queue.schedule(async () => {
          const deadline = withDeadline(signal ?? options.signal, timeoutMs);
          try {
            const response = await fetchImpl(url, {
              headers: { Accept: "application/json", "User-Agent": NOMINATIM_USER_AGENT },
              signal: deadline.signal,
            });
            if (!response.ok) {
              void response.body?.cancel().catch(() => {});
              return null;
            }
            const text = await response.text();
            let raw: unknown;
            try {
              raw = JSON.parse(text) as unknown;
            } catch {
              return null;
            }
            return mapNominatimPlace(raw);
          } finally {
            deadline.dispose();
          }
        });
      } catch {
        return null;
      }
    },
  };
}

export const nominatimReverseGeocoder: ReverseGeocoder = createNominatimReverseGeocoder();

/* ---------------------------------------------------------- reverse label cache */

/**
 * Bounded, process-lifetime cache keyed by rounded coordinates + language: a consent
 * refresh or a re-render must not re-hit Nominatim (and its 1/s policy). Failed lookups
 * are not cached, so a transient outage can recover.
 */
const reverseCache = new Map<string, WeatherPlace>();

function reverseCacheKey(latitude: number, longitude: number, language: PlaceLanguage): string {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)},${language}`;
}

function readReverseCache(key: string): WeatherPlace | null {
  const found = reverseCache.get(key);
  if (!found) return null;
  // Recency order: a recently used label must survive the next eviction.
  reverseCache.delete(key);
  reverseCache.set(key, found);
  return found;
}

function writeReverseCache(key: string, place: WeatherPlace): void {
  if (reverseCache.size >= MAX_REVERSE_CACHE) {
    const oldest = reverseCache.keys().next();
    if (!oldest.done) reverseCache.delete(oldest.value);
  }
  reverseCache.set(key, place);
}

/** Test seam: the cache is module state, so the suite must be able to start empty. */
export function resetReversePlaceCacheForTests(): void {
  reverseCache.clear();
}

/* ------------------------------------------------------------------- handler */

export interface PlaceHandlerOptions {
  /** Swap the reverse service (distribution policy, or a deterministic test stub). */
  reverseGeocoder?: ReverseGeocoder;
  /** Resolve the IANA zone for rounded coordinates; defaults to a lightweight forecast call. */
  timeZoneFor?: (
    latitude: number,
    longitude: number,
    signal?: AbortSignal | undefined,
  ) => Promise<string | null>;
  /** Injected fetch for the forward call; defaults to the runtime fetch. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

function failureResponse(kind: WeatherErrorKind): Response {
  if (kind === "cancelled")
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const status = kind === "input" ? 400 : kind === "rate" ? 429 : kind === "timeout" ? 504 : 502;
  return weatherJson({ ok: false, kind }, status, kind === "rate" ? { "Retry-After": "60" } : {});
}

function logPlace(event: Record<string, string | number>): void {
  // No query text and no coordinate: a place search is personal.
  console.info(JSON.stringify({ event: "weather-place", ...event }));
}

/**
 * Forward lookup. The Open-Meteo geocoding API returns the localized name, country code,
 * admin1 and IANA timezone; failures are classified into the shared weather kinds.
 */
async function forwardPlaces(
  query: string,
  language: PlaceLanguage,
  signal: AbortSignal | undefined,
  options: PlaceHandlerOptions,
): Promise<WeatherPlace[]> {
  const params = new URLSearchParams({
    name: query,
    count: String(PLACE_MAX_RESULTS),
    language,
    format: "json",
  });
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const deadline = withDeadline(signal, options.timeoutMs ?? PLACE_UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${OPEN_METEO_GEOCODING_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: deadline.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new WeatherError(response.status === 429 ? "rate" : "provider");
    }
    const text = await response.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new WeatherError("provider");
    }
    return mapGeocodingResults(raw);
  } catch (error) {
    if (error instanceof WeatherError) throw error;
    throw classifyWeatherFailure(error, deadline, signal);
  } finally {
    deadline.dispose();
  }
}

/**
 * Reverse lookup. Returns [] on any reverse/timezone failure: a missing label must never
 * fail the weather itself (A05 has an honest coordinate fallback).
 */
async function reversePlaces(
  latitude: number,
  longitude: number,
  language: PlaceLanguage,
  signal: AbortSignal | undefined,
  options: PlaceHandlerOptions,
): Promise<WeatherPlace[]> {
  const key = reverseCacheKey(latitude, longitude, language);
  const cached = readReverseCache(key);
  if (cached) return [cached];
  const reverse = options.reverseGeocoder ?? nominatimReverseGeocoder;
  const label = await reverse.reverse(latitude, longitude, language, signal).catch(() => null);
  if (!label) return [];
  const timeZoneFor = options.timeZoneFor ?? fetchOpenMeteoTimeZone;
  const timeZone = await timeZoneFor(latitude, longitude, signal).catch(() => null);
  if (!timeZone || !isValidTimeZone(timeZone)) return [];
  const place: WeatherPlace = {
    id: weatherPlaceId(latitude, longitude),
    name: label.name,
    latitude,
    longitude,
    ...(label.countryCode ? { countryCode: label.countryCode } : {}),
    ...(label.admin ? { admin: label.admin } : {}),
    timeZone,
    source: "geolocation",
    placeCredit: NOMINATIM_PLACE_CREDIT,
  };
  writeReverseCache(key, place);
  return [place];
}

/**
 * One handler for the web and native place routes. The body is bounded before the schema
 * and the rate token is spent only after it validates; neither the query text nor a
 * coordinate is ever logged.
 */
export async function handleWeatherPlaceRequest(
  request: Request,
  options: PlaceHandlerOptions = {},
): Promise<Response> {
  const admitted = await parseAdmittedJson(request, PlaceRequestSchema, () =>
    takePlaceToken(clientAddress(request)),
  );
  if (!admitted.ok) return failureResponse(admitted.kind === "rate" ? "rate" : "input");
  const started = Date.now();
  const data = admitted.data;
  const mode = "q" in data ? "forward" : "reverse";
  try {
    if ("q" in data) {
      const places = await forwardPlaces(data.q, data.lang, request.signal, options);
      logPlace({
        mode,
        outcome: places.length ? "ok" : "empty",
        count: places.length,
        ms: Date.now() - started,
      });
      return weatherJson({ ok: true, places });
    }
    const latitude = roundCoordinate(data.latitude);
    const longitude = roundCoordinate(data.longitude);
    const places = await reversePlaces(latitude, longitude, data.lang, request.signal, options);
    logPlace({
      mode,
      outcome: places.length ? "ok" : "empty",
      count: places.length,
      ms: Date.now() - started,
    });
    return weatherJson({ ok: true, places });
  } catch (error) {
    const kind = weatherErrorKind(error);
    logPlace({ mode, outcome: kind, count: 0, ms: Date.now() - started });
    return failureResponse(kind);
  }
}
