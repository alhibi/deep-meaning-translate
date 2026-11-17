/**
 * On-device weather cache: last valid snapshot per place + unit family, plus the units
 * preference. Device-only, bounded, versioned, validated on read.
 *
 * Storage is the existing settings API (`persistence/settings.ts`): localStorage on the web
 * and the hydrated Preferences DataStore snapshot on Android. The key is deliberately NOT
 * in `BACKUP_SETTING_KEYS` — a forecast is disposable device data, not something to carry
 * into a backup (a 3-hour-old forecast restored onto another device would be misleading).
 * "Forget everything" still removes it: web `forgetSettingsCache()` deletes every
 * `lingua.*` key and Android `clearAll()` empties DataStore.
 *
 * The Kotlin side hydrates arbitrary `lingua.*` keys: `SettingsStore.all()` is returned by
 * `boot()` minus the prefs blob and `settingsPut` accepts any `lingua.*` key (<=128 bytes
 * key, <=200_000 bytes value). No native patch is needed for this cache to survive a cold
 * start; the value is kept well under the Kotlin bound.
 */
import { WEATHER_SCHEMA_VERSION, type WeatherSnapshot, type WeatherUnits } from "./types";
import { isWeatherUnits, parseWeatherSnapshot, weatherCacheKey } from "./provider";
import { readDeviceValue, removeDeviceValue, writeDeviceValue } from "../persistence/settings";

/** One key for the whole weather feature; version lives inside the document. */
export const WEATHER_CACHE_KEY = "lingua.weather.v1";
/** Bounded so a long session with many searched places cannot grow device storage. */
export const WEATHER_CACHE_MAX_ENTRIES = 8;
/**
 * Bound on the stored document. The Kotlin bridge caps one setting value at 200,000
 * characters (LinguaRepository.settingsPut), so the ceiling is kept well below it: a
 * valid maximum document must always persist on Android instead of failing silently.
 */
export const WEATHER_CACHE_MAX_BYTES = 190_000;

export interface WeatherCacheDocument {
  version: typeof WEATHER_SCHEMA_VERSION;
  /** The person's unit preference; part of the document so there is one device key. */
  units: WeatherUnits;
  /** Most recently written first; each snapshot validates on its own. */
  entries: WeatherSnapshot[];
}

function emptyDocument(): WeatherCacheDocument {
  return { version: WEATHER_SCHEMA_VERSION, units: "metric", entries: [] };
}

const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).length;

/**
 * Parse one stored document. A document from another schema version is discarded whole (its
 * snapshots cannot be trusted by a newer UI); inside the current version a malformed entry
 * is dropped while the healthy ones survive, and the list is re-bounded.
 */
export function parseWeatherCacheDocument(raw: string | null): WeatherCacheDocument | null {
  if (!raw || byteLength(raw) > WEATHER_CACHE_MAX_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as { version?: unknown; units?: unknown; entries?: unknown };
  if (record.version !== WEATHER_SCHEMA_VERSION) return null;
  const units = isWeatherUnits(record.units) ? record.units : "metric";
  const entries: WeatherSnapshot[] = [];
  if (Array.isArray(record.entries)) {
    for (const entry of record.entries) {
      const snapshot = parseWeatherSnapshot(entry);
      if (snapshot) entries.push(snapshot);
      if (entries.length >= WEATHER_CACHE_MAX_ENTRIES) break;
    }
  }
  return { version: WEATHER_SCHEMA_VERSION, units, entries };
}

/** The validated document, or null when absent/damaged/from another version. */
export function readWeatherCacheDocument(): WeatherCacheDocument | null {
  return parseWeatherCacheDocument(readDeviceValue(WEATHER_CACHE_KEY));
}

/** The stored units preference; metric until the person chooses otherwise. */
export function readUnitsPreference(): WeatherUnits {
  return readWeatherCacheDocument()?.units ?? "metric";
}

/** The cached snapshot for exactly this rounded place and unit family, or null. */
export function readCachedSnapshot(
  latitude: number,
  longitude: number,
  units: WeatherUnits,
): WeatherSnapshot | null {
  const document = readWeatherCacheDocument();
  if (!document) return null;
  const key = weatherCacheKey(latitude, longitude, units);
  for (const snapshot of document.entries) {
    if (weatherCacheKey(snapshot.place.latitude, snapshot.place.longitude, snapshot.units) === key)
      return snapshot;
  }
  return null;
}

function serialize(document: WeatherCacheDocument): string {
  return JSON.stringify({
    version: document.version,
    units: document.units,
    entries: document.entries,
  });
}

/**
 * Store one valid snapshot (write path always goes through the validator first) and keep
 * the document bounded: newest first, at most four places, at most the byte cap. Returns
 * whether the device actually kept it; a private-mode browser or a not-yet-hydrated
 * Android build reports false and the forecast simply is not cached.
 */
export async function writeCachedSnapshot(snapshot: WeatherSnapshot): Promise<boolean> {
  const valid = parseWeatherSnapshot(snapshot);
  if (!valid) return false;
  const document = readWeatherCacheDocument() ?? emptyDocument();
  const key = weatherCacheKey(valid.place.latitude, valid.place.longitude, valid.units);
  const entries = [
    valid,
    ...document.entries.filter(
      (entry) => weatherCacheKey(entry.place.latitude, entry.place.longitude, entry.units) !== key,
    ),
  ].slice(0, WEATHER_CACHE_MAX_ENTRIES);
  while (
    entries.length > 1 &&
    byteLength(serialize({ ...document, entries })) > WEATHER_CACHE_MAX_BYTES
  ) {
    entries.pop();
  }
  const payload = serialize({ ...document, entries });
  if (byteLength(payload) > WEATHER_CACHE_MAX_BYTES) return false;
  return writeDeviceValue(WEATHER_CACHE_KEY, payload);
}

/** Persist the units preference without waiting for a forecast. */
export async function writeUnitsPreference(units: WeatherUnits): Promise<boolean> {
  if (!isWeatherUnits(units)) return false;
  const document = readWeatherCacheDocument() ?? emptyDocument();
  return writeDeviceValue(WEATHER_CACHE_KEY, serialize({ ...document, units }));
}

/**
 * Drop every cached snapshot but keep the unit preference. Used by `useWeather.clear()`
 * (for example after location consent is withdrawn); device storage is not a place to
 * keep a location-derived forecast the person can no longer see.
 */
export async function clearCachedSnapshots(): Promise<void> {
  const document = readWeatherCacheDocument();
  if (!document) {
    await removeDeviceValue(WEATHER_CACHE_KEY).catch(() => false);
    return;
  }
  await writeDeviceValue(WEATHER_CACHE_KEY, serialize({ ...document, entries: [] })).catch(
    () => false,
  );
}
