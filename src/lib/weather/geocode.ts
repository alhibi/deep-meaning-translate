/**
 * Place lookup through our own server route.
 *
 * The client never talks to a weather or geocoding provider. A06 owns two identical
 * endpoints — `POST /api/weather/place` for the browser (same-origin) and
 * `POST /api/native/v1/weather/place` for the installed app — and the wire contract is
 * pinned here:
 *
 *   forward search: { q: string(1..80), lang: "ar" | "de" | "en" }
 *   reverse fix:    { latitude: number, longitude: number, lang }
 *
 * There is no `mode` field and the server rejects a body that mixes the shapes.
 * Success: { ok: true, places: WeatherPlace[] } (at most 8, already rounded to two
 * decimals by the server as well). Failure: { ok: false, kind } with
 * kind = "input" | "rate" | "timeout" | "provider" | "network" and no coordinate or
 * query text in the body.
 *
 * This module owns the client half of that contract and the coordinate quantization:
 * every coordinate that leaves the device is rounded to two decimals (~1 km) first, and
 * every candidate read back is validated and re-rounded before it can become a cache
 * identity. A malformed reply is a typed failure, never a partial place.
 */

import { isNativeApp } from "@/lib/native/config";
import type { WeatherPlace } from "./types";

export const PLACE_LANGUAGES = ["ar", "de", "en"] as const;
export type PlaceLanguage = (typeof PLACE_LANGUAGES)[number];
export const DEFAULT_PLACE_LANGUAGE: PlaceLanguage = "en";

/** Same-origin web route owned by A06. */
export const WEB_PLACE_ROUTE = "/api/weather/place";
/** Versioned native route owned by A06 (installed app, absolute origin). */
export const NATIVE_PLACE_ROUTE = "/api/native/v1/weather/place";

/** Search queries are bounded before they leave the device. */
export const PLACE_QUERY_MAX = 80;
/** The server returns at most eight candidates; a hostile or broken reply cannot grow it. */
export const PLACE_RESULTS_MAX = 8;
/** Two decimals is ~1.1 km at the equator: enough for weather, deliberately coarse. */
export const COORDINATE_DECIMALS = 2;
/** One bounded wait for a lookup; the route has its own provider timeout as well. */
export const PLACE_TIMEOUT_MS = 15_000;

const PLACE_NAME_MAX = 120;
const PLACE_ID_MAX = 120;
const TIME_ZONE_MAX = 64;
const ADMIN_MAX = 120;
const PLACE_CREDIT_MAX = 200;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

/** The server's candidate is the shared display/cache shape (types.ts). */
export type WeatherPlaceCandidate = WeatherPlace;

/* --------------------------------------------------------------- quantization */

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Rounds a coordinate to two decimals; -0.00 is normalized to 0. */
export function roundCoordinate(value: number): number {
  const rounded = Number(value.toFixed(COORDINATE_DECIMALS));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function isCoordinate(value: unknown, limit: number): value is number {
  return isFiniteNumber(value) && value >= -limit && value <= limit;
}

/**
 * Quantizes a latitude/longitude pair, or returns null when the values are not usable.
 * This is the only conversion allowed before a coordinate is sent or stored.
 */
export function coarseCoordinates(
  latitude: unknown,
  longitude: unknown,
): { latitude: number; longitude: number } | null {
  if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) return null;
  return { latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) };
}

/** A06's weather-cache identity function: the same rounded coordinates make the same id. */
export function placeIdentity(latitude: number, longitude: number): string {
  return `open-meteo:${roundCoordinate(latitude).toFixed(COORDINATE_DECIMALS)}:${roundCoordinate(longitude).toFixed(COORDINATE_DECIMALS)}`;
}

/* ------------------------------------------------------------- query helpers */

export function isPlaceLanguage(value: unknown): value is PlaceLanguage {
  return typeof value === "string" && (PLACE_LANGUAGES as readonly string[]).includes(value);
}

export function normalizePlaceLanguage(value: unknown): PlaceLanguage {
  return isPlaceLanguage(value) ? value : DEFAULT_PLACE_LANGUAGE;
}

/** Trims and collapses internal whitespace; returns null when empty or over 80 code points. */
export function normalizePlaceQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value.trim().replace(/\s+/gu, " ");
  if (!query || [...query].length > PLACE_QUERY_MAX) return null;
  return query;
}

/* -------------------------------------------------------------- place parsing */

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || [...text].length > max) return null;
  return text;
}

/** Ids are opaque cache keys; reject control characters and overlong values. */
function isValidPlaceId(value: string): boolean {
  if (!value || [...value].length > PLACE_ID_MAX) return false;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * Validates one candidate read from the network and re-quantizes its coordinates.
 * A candidate that cannot be trusted is dropped; nothing is repaired into a place.
 */
export function sanitizePlace(raw: unknown): WeatherPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const coordinates = coarseCoordinates(record["latitude"], record["longitude"]);
  if (!coordinates) return null;
  const name = readText(record["name"], PLACE_NAME_MAX);
  if (!name) return null;
  const timeZone = readText(record["timeZone"], TIME_ZONE_MAX);
  if (!timeZone) return null;
  const id = readText(record["id"], PLACE_ID_MAX);
  if (!id || !isValidPlaceId(id)) return null;
  const place: WeatherPlace = {
    id,
    name,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    timeZone,
  };
  const countryCode = readText(record["countryCode"], 2);
  if (countryCode && COUNTRY_PATTERN.test(countryCode)) place.countryCode = countryCode;
  const admin = readText(record["admin"], ADMIN_MAX);
  if (admin) place.admin = admin;
  const source = record["source"];
  if (source === "search" || source === "geolocation" || source === "default") {
    place.source = source;
  }
  // Attribution is required when a third party resolved the name (reverse geocoding);
  // the layer that creates the place decides it, so a missing credit is never invented.
  const placeCredit = readText(record["placeCredit"], PLACE_CREDIT_MAX);
  if (placeCredit) place.placeCredit = placeCredit;
  return place;
}

/** Reads the success envelope; null when the payload is not one. Empty places is valid. */
export function parsePlacesEnvelope(raw: unknown): WeatherPlace[] | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record["ok"] !== true) return null;
  return sanitizePlaceList(record["places"]);
}

function sanitizePlaceList(raw: unknown): WeatherPlace[] | null {
  if (!Array.isArray(raw)) return null;
  const places: WeatherPlace[] = [];
  for (const item of raw) {
    const place = sanitizePlace(item);
    if (place) places.push(place);
    if (places.length >= PLACE_RESULTS_MAX) break;
  }
  return places;
}

/* ------------------------------------------------------------------- errors */

export type PlaceErrorKind = "input" | "rate" | "timeout" | "provider" | "network" | "aborted";

/** Typed, value-free failure: the message is the kind, never a query or a coordinate. */
export class PlaceError extends Error {
  constructor(readonly kind: PlaceErrorKind) {
    super(kind);
    this.name = "PlaceError";
  }
}

/** Maps an HTTP status (and the server's own kind when present) to a client kind. */
export function httpStatusKind(status: number, serverKind: unknown): PlaceErrorKind {
  if (
    serverKind === "input" ||
    serverKind === "rate" ||
    serverKind === "timeout" ||
    serverKind === "provider" ||
    serverKind === "network"
  ) {
    return serverKind;
  }
  if (status === 400 || status === 401 || status === 403 || status === 422) return "input";
  if (status === 429) return "rate";
  if (status === 408 || status === 504) return "timeout";
  return "provider";
}

function asPlaceError(error: unknown, signal?: AbortSignal): PlaceError {
  if (error instanceof PlaceError) return error;
  if (signal?.aborted) return new PlaceError("aborted");
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "AbortError") return new PlaceError("aborted");
  if (name === "TimeoutError") return new PlaceError("timeout");
  const kind = (error as { kind?: unknown } | null)?.kind;
  if (
    kind === "input" ||
    kind === "rate" ||
    kind === "timeout" ||
    kind === "provider" ||
    kind === "network" ||
    kind === "aborted"
  ) {
    return new PlaceError(kind);
  }
  if (kind === "offline") return new PlaceError("network");
  if (error instanceof TypeError) return new PlaceError("network");
  return new PlaceError("provider");
}

/* --------------------------------------------------------------- client seam */

export interface PlaceSearchRequest {
  readonly q: string;
  readonly lang: PlaceLanguage;
}

export interface PlaceReverseRequest {
  readonly latitude: number;
  readonly longitude: number;
  readonly lang: PlaceLanguage;
}

export type PlaceRequest = PlaceSearchRequest | PlaceReverseRequest;
/** Injected for tests and alternate shells; resolves to the raw JSON payload. */
export type PlaceFetch = (request: PlaceRequest, signal?: AbortSignal) => Promise<unknown>;

export interface PlaceClient {
  /** Localized forward search; throws PlaceError. */
  search(query: string, language?: PlaceLanguage, signal?: AbortSignal): Promise<WeatherPlace[]>;
  /** Reverse lookup from an already-coarse fix; empty means "no locality known". */
  reverse(
    latitude: number,
    longitude: number,
    language?: PlaceLanguage,
    signal?: AbortSignal,
  ): Promise<WeatherPlace[]>;
}

/**
 * Builds the place client. The default transport posts to A06's routes; tests inject a
 * plain function and never touch the network.
 */
export function createPlaceClient(fetchImpl: PlaceFetch = fetchPlaceCandidates): PlaceClient {
  const lookup = async (request: PlaceRequest, signal?: AbortSignal): Promise<WeatherPlace[]> => {
    if (signal?.aborted) throw new PlaceError("aborted");
    let raw: unknown;
    try {
      raw = await fetchImpl(request, signal);
    } catch (error) {
      throw asPlaceError(error, signal);
    }
    if (signal?.aborted) throw new PlaceError("aborted");
    const places = parsePlacesEnvelope(raw);
    if (!places) throw new PlaceError("provider");
    return places;
  };

  return {
    async search(query, language = DEFAULT_PLACE_LANGUAGE, signal) {
      const normalized = normalizePlaceQuery(query);
      if (!normalized) throw new PlaceError("input");
      return lookup({ q: normalized, lang: normalizePlaceLanguage(language) }, signal);
    },
    async reverse(latitude, longitude, language = DEFAULT_PLACE_LANGUAGE, signal) {
      const coordinates = coarseCoordinates(latitude, longitude);
      if (!coordinates) throw new PlaceError("input");
      return lookup(
        {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          lang: normalizePlaceLanguage(language),
        },
        signal,
      );
    },
  };
}

/* ------------------------------------------------------------ default transport */

async function readServerErrorKind(response: Response): Promise<unknown> {
  try {
    const body = (await response.json()) as unknown;
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    return record && record["ok"] === false ? record["kind"] : null;
  } catch {
    return null;
  }
}

/**
 * The real transport. Browser: same-origin `POST /api/weather/place` with a bounded
 * wait. Installed app: the existing native JSON transport (absolute origin, the app's
 * origin gate). No provider URL and no key exists on this path.
 */
export async function fetchPlaceCandidates(
  request: PlaceRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  if (isNativeApp()) {
    const { nativeJson } = await import("@/lib/native/transport");
    return nativeJson<unknown>(NATIVE_PLACE_ROUTE, request, PLACE_TIMEOUT_MS, signal);
  }
  if (typeof fetch !== "function") throw new PlaceError("network");
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const forwardAbort = (): void => {
    controller?.abort();
  };
  if (controller) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PLACE_TIMEOUT_MS);
    signal?.addEventListener("abort", forwardAbort, { once: true });
  }
  try {
    const response = await fetch(WEB_PLACE_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      credentials: "same-origin",
      cache: "no-store",
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) {
      throw new PlaceError(httpStatusKind(response.status, await readServerErrorKind(response)));
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof PlaceError) throw error;
    if (signal?.aborted) throw new PlaceError("aborted");
    if (timedOut) throw new PlaceError("timeout");
    if (controller?.signal.aborted) throw new PlaceError("timeout");
    if (error instanceof TypeError) throw new PlaceError("network");
    throw new PlaceError("provider");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
