/**
 * Culture catalog loader (Phase II).
 *
 * The catalog is an order of magnitude larger than the app's own screens, so it is split:
 * a compact `data/index.ts` module carries one row per record for search/filter/feed, and
 * numbered `data/chunk-<n>.ts` modules carry the full detail bodies. Both are loaded with
 * dynamic imports only — nothing here runs at module-evaluation time, so the first paint of
 * the app never waits for culture data. A screen that wants the catalog calls
 * `loadCultureIndex()` from an effect and renders its own loading state.
 *
 * Contract assumptions for the generated modules (A09 owns them):
 * - `data/index.ts` default-exports `{ version, entries, chunkSize? }`.
 * - `data/chunk-<n>.ts` default-exports `CultureItem[]` (or `{ version?, items }`).
 * - A detail chunk covers `chunkSize` consecutive index positions: the entry at index
 *   position `p` lives in chunk `floor(p / chunkSize)`. The chunks therefore do not need
 *   to repeat ids: the compact index is the map. `chunkSize` defaults to
 *   `CULTURE_CHUNK_SIZE` and may be declared by the index payload.
 * If the generated layout differs, `setCultureDataSource()` replaces the module
 * resolution with an adapter without touching the rest of the discovery domain.
 *
 * Every read is validated: index rows and item bodies are checked against `types.ts` and
 * anything that does not fit is dropped (and counted) instead of reaching the UI. A data
 * version other than `CULTURE_SCHEMA_VERSION` is reported as `version-mismatch` with an
 * empty catalog; the caller can render a calm "unavailable" state, never a crash.
 */
import { isAllowedCultureImageUrl } from "./media";
import {
  CULTURE_CATEGORIES,
  CULTURE_SCHEMA_VERSION,
  type CultureCategory,
  type CultureContinent,
  type CultureIndexEntry,
  type CultureItem,
  type CultureLocale,
  type CultureMedia,
} from "./types";

/** Detail-chunk size assumed when the generated index does not declare one. */
export const CULTURE_CHUNK_SIZE = 100;
/** At most this many detail chunks stay in memory (LRU by last use). */
export const CULTURE_CHUNK_CACHE_LIMIT = 6;

const CONTINENTS: readonly CultureContinent[] = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];
const LOCALES: readonly CultureLocale[] = ["ar", "de", "en"];
const PROVENANCE: readonly string[] = ["institution", "machine-translated", "editorial-reviewed"];
const CATEGORY_SET = new Set<string>(CULTURE_CATEGORIES);
const CONTINENT_SET = new Set<string>(CONTINENTS);

/** Max accepted id length; ids are used as cursors and in local saved/seen stores. */
const MAX_ID_LENGTH = 128;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 64;
const MAX_RELATED = 24;
const MAX_CHUNK_SIZE = 1000;

export type CultureLoadStatus = "ok" | "empty" | "unavailable" | "version-mismatch";

export interface CultureIndexLoad {
  status: CultureLoadStatus;
  /** Version declared by the loaded index; `null` when nothing usable was loaded. */
  version: number | null;
  entries: readonly CultureIndexEntry[];
  /** Rows the generated index carried that did not validate and were dropped. */
  dropped: number;
  /** Detail-chunk size the index declared (or `CULTURE_CHUNK_SIZE`). */
  chunkSize: number;
}

export interface CultureDetailLoad {
  /**
   * - `ok`: every requested id was loaded;
   * - `partial`: some were loaded, the rest are listed in `missing`;
   * - `not-found`: none of the requested ids exists in the compact index (nothing fetched);
   * - `unavailable`: the catalog/chunk could not be loaded at all;
   * - `version-mismatch`: the data does not match `CULTURE_SCHEMA_VERSION`.
   */
  status: "ok" | "partial" | "unavailable" | "version-mismatch" | "not-found";
  items: CultureItem[];
  missing: string[];
}

/** A replaceable source of raw catalog modules. Results are validated here, not by the source. */
export interface CultureDataSource {
  /** Resolve the compact index payload (version + entries). */
  loadIndex(): Promise<unknown>;
  /** Resolve the detail payload for one chunk window. May reject when absent. */
  loadChunk(window: number): Promise<unknown>;
}

/* ------------------------------------------------------------------ validators */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A catalog id is an opaque key used in cursors and local stores: not blank, not longer
 * than the bound, and free of whitespace/control characters (so no rendering or cursor
 * ambiguity). Written as a scan rather than a regex because a control-character pattern
 * is easy to get subtly wrong.
 */
const isId = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
};

const isCountry = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z]{2}$/.test(value);

function isLocalizedText(value: unknown): value is Record<CultureLocale, string> {
  if (!isRecord(value)) return false;
  return LOCALES.every(
    (locale) => typeof value[locale] === "string" && (value[locale] as string).trim().length > 0,
  );
}

function toCountries(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const country of value) {
    if (!isCountry(country)) continue;
    const upper = country.toUpperCase();
    if (!out.includes(upper)) out.push(upper);
  }
  return out;
}

function toTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const tag of value) {
    if (typeof tag !== "string") continue;
    const trimmed = tag.trim().slice(0, MAX_TAG_LENGTH);
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function clampWeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/**
 * The small feed media block is optional: an entry whose media does not carry an https
 * url, a licence and a credit is kept without media (the card falls back to a typographic
 * composition) rather than dropped. Rights metadata is never assumed or invented.
 */
export function parseCultureMedia(value: unknown): CultureMedia | undefined {
  if (!isRecord(value)) return undefined;
  const url = field(value, "url");
  const license = field(value, "license");
  const credit = field(value, "credit");
  // Defence in depth: the corpus is validated at ingestion, but the rendered media URL is
  // still untrusted. Only an exact allow-listed https host may be painted (the registry is
  // the same one the CSPs and the security test read).
  if (!isAllowedCultureImageUrl(url)) return undefined;
  if (typeof license !== "string" || !license.trim()) return undefined;
  if (typeof credit !== "string" || !credit.trim()) return undefined;
  const thumbnailUrl = field(value, "thumbnailUrl");
  const width = field(value, "width");
  const height = field(value, "height");
  return {
    url,
    license,
    credit,
    ...(isAllowedCultureImageUrl(thumbnailUrl) ? { thumbnailUrl } : {}),
    ...(typeof width === "number" && Number.isFinite(width) && width > 0 ? { width } : {}),
    ...(typeof height === "number" && Number.isFinite(height) && height > 0 ? { height } : {}),
  };
}

/** A validated record is still untrusted input: every field is read by name, never dotted. */
const field = (record: Record<string, unknown>, key: string): unknown => record[key];

/** Validate and normalise one compact index row. Returns `null` for unusable rows. */
export function parseCultureIndexEntry(value: unknown): CultureIndexEntry | null {
  if (!isRecord(value)) return null;
  const id = field(value, "id");
  if (!isId(id)) return null;
  const title = field(value, "title");
  if (!isLocalizedText(title)) return null;
  const category = field(value, "category");
  if (typeof category !== "string" || !CATEGORY_SET.has(category)) return null;
  const continent = field(value, "continent");
  if (typeof continent !== "string" || !CONTINENT_SET.has(continent)) return null;
  const countries = toCountries(field(value, "countries"));
  if (!countries) return null;
  const weight = clampWeight(field(value, "weight"));
  if (weight === null) return null;
  const media = parseCultureMedia(field(value, "media"));
  return {
    id,
    title: { ar: title.ar, de: title.de, en: title.en },
    category: category as CultureCategory,
    continent: continent as CultureContinent,
    countries,
    tags: toTags(field(value, "tags")),
    weight,
    hasMedia: field(value, "hasMedia") === true,
    ...(media ? { media } : {}),
  };
}

/** Validate one full item body. Returns `null` for unusable items. */
export function parseCultureItem(value: unknown): CultureItem | null {
  if (!isRecord(value)) return null;
  const id = field(value, "id");
  if (!isId(id)) return null;
  if (field(value, "version") !== CULTURE_SCHEMA_VERSION) return null;
  const title = field(value, "title");
  const summary = field(value, "summary");
  if (!isLocalizedText(title) || !isLocalizedText(summary)) return null;
  const taxonomy = field(value, "taxonomy");
  if (!isRecord(taxonomy)) return null;
  const category = field(taxonomy, "category");
  if (typeof category !== "string" || !CATEGORY_SET.has(category)) return null;
  const place = field(value, "place");
  if (!isRecord(place)) return null;
  const continent = field(place, "continent");
  if (typeof continent !== "string" || !CONTINENT_SET.has(continent)) return null;
  const countries = toCountries(field(place, "countries"));
  if (!countries) return null;
  const source = field(value, "source");
  if (!isRecord(source)) return null;
  for (const key of ["organization", "url", "license", "attribution"] as const) {
    const required = field(source, key);
    if (typeof required !== "string" || !required.trim()) return null;
  }
  const provenance = field(value, "provenance");
  if (typeof provenance !== "string" || !PROVENANCE.includes(provenance)) return null;
  const ingestedAt = field(value, "ingestedAt");
  if (typeof ingestedAt !== "string" || !ingestedAt.trim()) return null;
  const rawTags = field(value, "tags");
  if (!Array.isArray(rawTags)) return null;
  const rawRelated = field(value, "related");
  const related = Array.isArray(rawRelated)
    ? rawRelated.filter((relatedId): relatedId is string => isId(relatedId)).slice(0, MAX_RELATED)
    : undefined;
  const titleExtras = title as Record<string, unknown>;
  const original = titleExtras["original"];
  const originalLanguage = titleExtras["originalLanguage"];
  const subcategory = field(taxonomy, "subcategory");
  const region = field(place, "region");
  const community = field(place, "community");
  const description = field(value, "description");
  const period = field(value, "period");
  const subject = field(value, "subject");
  const media = parseCultureMedia(field(value, "media"));
  const item: CultureItem = {
    id,
    version: CULTURE_SCHEMA_VERSION,
    title: {
      ar: title.ar,
      de: title.de,
      en: title.en,
      ...(typeof original === "string" ? { original } : {}),
      ...(typeof originalLanguage === "string" ? { originalLanguage } : {}),
    },
    summary,
    taxonomy: {
      category: category as CultureCategory,
      ...(typeof subcategory === "string" ? { subcategory } : {}),
    },
    place: {
      continent: continent as CultureContinent,
      countries,
      ...(typeof region === "string" ? { region } : {}),
      ...(typeof community === "string" ? { community } : {}),
    },
    ...(isLocalizedText(description) ? { description } : {}),
    ...(typeof period === "string" ? { period } : {}),
    ...(typeof subject === "string" ? { subject } : {}),
    tags: toTags(rawTags),
    ...(media ? { media } : {}),
    source: {
      organization: field(source, "organization") as string,
      url: field(source, "url") as string,
      license: field(source, "license") as string,
      attribution: field(source, "attribution") as string,
      ...(typeof field(source, "licenseUrl") === "string"
        ? { licenseUrl: field(source, "licenseUrl") as string }
        : {}),
      ...(typeof field(source, "modified") === "string"
        ? { modified: field(source, "modified") as string }
        : {}),
    },
    provenance: provenance as CultureItem["provenance"],
    ...(related && related.length ? { related } : {}),
    ingestedAt,
  };
  // Optional editorial block the reading surface can show when the corpus states it. It is
  // validated as localized text and preserved verbatim; absence stays absence (the source
  // stated no reason, and the UI never invents one).
  const whyDistinctive = field(value, "whyDistinctive");
  if (isLocalizedText(whyDistinctive)) item.whyDistinctive = whyDistinctive;
  return item;
}

/* ----------------------------------------------------------------- parsing payloads */

interface ParsedIndex {
  status: CultureLoadStatus;
  version: number | null;
  entries: CultureIndexEntry[];
  dropped: number;
  chunkSize: number;
}

function parseIndexPayload(raw: unknown, fallbackChunkSize: number): ParsedIndex {
  const unavailable: ParsedIndex = {
    status: "unavailable",
    version: null,
    entries: [],
    dropped: 0,
    chunkSize: fallbackChunkSize,
  };
  if (!isRecord(raw)) return unavailable;
  const version =
    typeof raw["version"] === "number" && Number.isInteger(raw["version"]) ? raw["version"] : null;
  if (version === null) return unavailable;
  const declaredChunkSize = raw["chunkSize"];
  const chunkSize =
    typeof declaredChunkSize === "number" &&
    Number.isInteger(declaredChunkSize) &&
    declaredChunkSize > 0 &&
    declaredChunkSize <= MAX_CHUNK_SIZE
      ? declaredChunkSize
      : fallbackChunkSize;
  const rows = raw["entries"];
  if (!Array.isArray(rows)) return { ...unavailable, version, chunkSize };
  let dropped = 0;
  const seen = new Set<string>();
  const entries: CultureIndexEntry[] = [];
  for (const row of rows) {
    const entry = parseCultureIndexEntry(row);
    if (!entry || seen.has(entry.id)) {
      dropped += 1;
      continue;
    }
    seen.add(entry.id);
    entries.push(entry);
  }
  if (version !== CULTURE_SCHEMA_VERSION) {
    return { status: "version-mismatch", version, entries: [], dropped, chunkSize };
  }
  return {
    status: entries.length ? "ok" : "empty",
    version,
    entries,
    dropped,
    chunkSize,
  };
}

interface ParsedChunk {
  items: unknown[];
  version: number | null;
}

function parseChunkPayload(raw: unknown): ParsedChunk | null {
  if (Array.isArray(raw)) return { items: raw, version: null };
  if (!isRecord(raw)) return null;
  const items = raw["items"];
  if (!Array.isArray(items)) return null;
  const version = typeof raw["version"] === "number" ? raw["version"] : null;
  return { items, version };
}

/* ------------------------------------------------------------------- default source */

type ModuleImporter = () => Promise<unknown>;

const indexModules: Record<string, ModuleImporter> = import.meta.glob("./data/index.ts");
const chunkModules: Record<string, ModuleImporter> = import.meta.glob("./data/chunk-*.ts");

function unwrapModule(module: unknown): unknown {
  if (isRecord(module) && "default" in module) return module["default"];
  return module;
}

let defaultSource: CultureDataSource | null = null;

function getDefaultSource(): CultureDataSource {
  if (defaultSource) return defaultSource;
  const indexImporter = Object.values(indexModules)[0];
  const chunks = new Map<number, ModuleImporter>();
  for (const [path, importer] of Object.entries(chunkModules)) {
    const match = /chunk-(\d+)\.ts$/.exec(path);
    if (!match || match[1] === undefined) continue;
    chunks.set(Number(match[1]), importer);
  }
  defaultSource = {
    async loadIndex() {
      if (!indexImporter) throw new Error("culture index is not part of this build");
      return unwrapModule(await indexImporter());
    },
    async loadChunk(window: number) {
      const importer = chunks.get(window);
      if (!importer)
        throw new Error(`culture detail chunk ${String(window)} is not part of this build`);
      return unwrapModule(await importer());
    },
  };
  return defaultSource;
}

/* ------------------------------------------------------------------ loader state */

let sourceOverride: CultureDataSource | null = null;
let indexPromise: Promise<CultureIndexLoad> | null = null;
let loadedIndex: CultureIndexLoad | null = null;
let idPositions: Map<string, number> | null = null;
let chunkSize = CULTURE_CHUNK_SIZE;
let detailVersionMismatch = false;

const chunkCache = new Map<number, readonly CultureItem[]>();
const chunkPromises = new Map<number, Promise<readonly CultureItem[] | null>>();

function activeSource(): CultureDataSource {
  return sourceOverride ?? getDefaultSource();
}

function clearCaches() {
  indexPromise = null;
  loadedIndex = null;
  idPositions = null;
  chunkSize = CULTURE_CHUNK_SIZE;
  detailVersionMismatch = false;
  chunkCache.clear();
  chunkPromises.clear();
}

/**
 * Replace module resolution with an adapter (integration for a different generated
 * layout, or a test fixture). Pass `null` to go back to the bundled data modules.
 * The loader's caches are dropped so the next read uses the new source.
 */
export function setCultureDataSource(source: CultureDataSource | null): void {
  sourceOverride = source;
  clearCaches();
}

/** Drop cached index/chunks; the next read re-imports from the active source. */
export function resetCultureLoader(): void {
  clearCaches();
}

/** Synchronous peek: the validated index once loaded, otherwise `null`. Never triggers a load. */
export function peekCultureIndex(): readonly CultureIndexEntry[] | null {
  return loadedIndex && loadedIndex.status === "ok" ? loadedIndex.entries : null;
}

/** Compact view of the last index load, for a UI status line. */
export function cultureIndexStatus(): CultureLoadStatus | "idle" {
  return loadedIndex ? loadedIndex.status : "idle";
}

/**
 * Load and validate the compact index at most once (concurrent callers share the same
 * promise). Never throws: a missing/broken/mismatched index resolves to a status.
 */
export function loadCultureIndex(): Promise<CultureIndexLoad> {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    let result: ParsedIndex;
    try {
      result = parseIndexPayload(await activeSource().loadIndex(), CULTURE_CHUNK_SIZE);
    } catch {
      result = {
        status: "unavailable",
        version: null,
        entries: [],
        dropped: 0,
        chunkSize: CULTURE_CHUNK_SIZE,
      };
    }
    loadedIndex = result;
    chunkSize = result.chunkSize;
    if (result.status === "ok") {
      const positions = new Map<string, number>();
      result.entries.forEach((entry, position) => positions.set(entry.id, position));
      idPositions = positions;
    }
    return result;
  })();
  return indexPromise;
}

function trimChunkCache() {
  while (chunkCache.size > CULTURE_CHUNK_CACHE_LIMIT) {
    const oldest = chunkCache.keys().next();
    if (oldest.done) break;
    chunkCache.delete(oldest.value);
  }
}

function ensureChunk(window: number): Promise<readonly CultureItem[] | null> {
  const cached = chunkCache.get(window);
  if (cached) {
    // Refresh LRU position: a just-read chunk must not be the next one evicted.
    chunkCache.delete(window);
    chunkCache.set(window, cached);
    return Promise.resolve(cached);
  }
  const pending = chunkPromises.get(window);
  if (pending) return pending;
  const promise = (async (): Promise<readonly CultureItem[] | null> => {
    try {
      const parsed = parseChunkPayload(await activeSource().loadChunk(window));
      if (!parsed) return null;
      if (parsed.version !== null && parsed.version !== CULTURE_SCHEMA_VERSION) {
        detailVersionMismatch = true;
        return null;
      }
      const items: CultureItem[] = [];
      for (const raw of parsed.items) {
        const item = parseCultureItem(raw);
        if (item) items.push(item);
      }
      chunkCache.set(window, items);
      trimChunkCache();
      return items;
    } catch {
      return null;
    }
  })();
  chunkPromises.set(window, promise);
  void promise.finally(() => {
    chunkPromises.delete(window);
  });
  return promise;
}

/**
 * Load the full bodies for the requested ids, preserving the requested order and
 * deduplicating repeats. Ids that are not in the compact index are `missing` without
 * any chunk request. Chunk loads are cached (bounded) and concurrent loads of the same
 * window share one request. Never throws.
 */
export async function loadCultureItems(ids: readonly string[]): Promise<CultureDetailLoad> {
  const requested = [...new Set(ids)];
  if (requested.length === 0) return { status: "ok", items: [], missing: [] };
  const index = await loadCultureIndex();
  if (index.status !== "ok" || !idPositions) {
    return {
      status: index.status === "version-mismatch" ? "version-mismatch" : "unavailable",
      items: [],
      missing: requested,
    };
  }
  const positions = idPositions;
  const windows = new Set<number>();
  for (const id of requested) {
    const position = positions.get(id);
    if (position === undefined) continue; // not in the index: nothing to fetch
    windows.add(Math.floor(position / chunkSize));
  }
  if (windows.size === 0) {
    return { status: "not-found", items: [], missing: requested };
  }
  const loaded = await Promise.all(
    [...windows].map(async (window) => ({ window, items: await ensureChunk(window) })),
  );
  const byId = new Map<string, CultureItem>();
  for (const chunk of loaded) {
    if (!chunk.items) continue;
    for (const item of chunk.items) {
      const position = positions.get(item.id);
      if (position === undefined || Math.floor(position / chunkSize) !== chunk.window) continue;
      byId.set(item.id, item);
    }
  }
  const items: CultureItem[] = [];
  const missing: string[] = [];
  for (const id of requested) {
    const item = byId.get(id);
    if (item) items.push(item);
    else missing.push(id);
  }
  const status =
    items.length === 0
      ? detailVersionMismatch
        ? "version-mismatch"
        : "unavailable"
      : missing.length
        ? "partial"
        : "ok";
  return { status, items, missing };
}

/** Load one item body by id. */
export async function loadCultureItem(id: string): Promise<CultureItem | null> {
  const result = await loadCultureItems([id]);
  return result.items.find((item) => item.id === id) ?? null;
}

/** Exposed for diagnostics and tests: current detail-chunk window for an id, if indexed. */
export function cultureChunkWindow(id: string): number | null {
  const position = idPositions?.get(id);
  return position === undefined ? null : Math.floor(position / chunkSize);
}
