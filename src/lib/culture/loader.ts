/**
 * Culture library loader (schema v2, text-first).
 *
 * The written library is split so the app never pays for article bodies it is not reading:
 * - data/index.ts default-exports { version: 2, chunkSize, entries: CultureIndexEntry[] }
 *   -- one compact row per article, enough for search, filters, the feed and the daily feature;
 * - data/chunk-<n>.ts default-exports { version: 2, items: CultureArticle[] } -- the prose
 *   bodies. Chunk n covers the index positions n * chunkSize .. (n + 1) * chunkSize - 1 in
 *   the same order, so the compact index is the only map an id needs.
 *
 * Both module groups are resolved through import.meta.glob LAZILY: importing this module
 * runs no data import, so the translator's first paint never waits for the library. A
 * screen that wants culture calls loadCultureIndex() from an effect and renders its own
 * calm loading state.
 *
 * Every read is validated here, never trusted from the generated files: an index row or an
 * article that does not fit types.ts is dropped (index drops are counted), a declared
 * schema version other than CULTURE_SCHEMA_VERSION is a version-mismatch with no usable
 * data, and a missing/throwing module is unavailable. None of these ever throw -- the UI
 * decides how to say that the library is not here right now.
 */
import {
  CULTURE_CATEGORIES,
  CULTURE_SCHEMA_VERSION,
  type CultureArticle,
  type CultureCategory,
  type CultureContentType,
  type CultureContinent,
  type CultureContext,
  type CultureExpression,
  type CultureIndexEntry,
  type CultureLocale,
  type CultureReview,
  type CultureSection,
  type CultureSource,
  type CultureStatus,
  type CultureVerification,
  type LocalizedText,
} from "./types";

/** Detail-chunk size assumed when the generated index does not declare one. */
export const CULTURE_CHUNK_SIZE = 100;
/** At most this many detail chunks stay in memory (LRU by last use). */
export const CULTURE_CHUNK_CACHE_LIMIT = 6;

/** Canonical display order for content types (also used by the facet builder). */
export const CULTURE_CONTENT_TYPES: readonly CultureContentType[] = [
  "feature",
  "note",
  "language",
  "scene",
  "contrast",
  "detail",
];

const CONTINENTS: readonly CultureContinent[] = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];
const LOCALES: readonly CultureLocale[] = ["ar", "de", "en"];
const VERIFICATIONS: readonly CultureVerification[] = [
  "source-linked",
  "double-checked",
  "unverified",
];
const REVIEWS: readonly CultureReview[] = ["machine-drafted", "editor-reviewed", "not-reviewed"];
const PERIODS = ["contemporary", "historical", "both"] as const;

const CATEGORY_SET = new Set<string>(CULTURE_CATEGORIES);
const CONTINENT_SET = new Set<string>(CONTINENTS);
const CONTENT_TYPE_SET = new Set<string>(CULTURE_CONTENT_TYPES);
const VERIFICATION_SET = new Set<string>(VERIFICATIONS);
const REVIEW_SET = new Set<string>(REVIEWS);
const PERIOD_SET = new Set<string>(PERIODS);

/** Ids are cursors and storage keys: bounded, no whitespace and no control characters. */
const MAX_ID_LENGTH = 128;
const MAX_SLUG_LENGTH = 200;
const MAX_TITLE_LENGTH = 400;
const MAX_TEASER_LENGTH = 4_000;
const MAX_PARAGRAPH_LENGTH = 12_000;
const MAX_TAGS = 16;
const MAX_TAG_LENGTH = 80;
const MAX_COUNTRIES = 12;
const MAX_LANGUAGES = 12;
const MAX_LANGUAGE_LENGTH = 80;
const MAX_SECTIONS = 40;
const MAX_PARAGRAPHS = 40;
const MAX_SOURCES = 24;
const MAX_SOURCE_TEXT = 400;
const MAX_RELATED = 24;
const MAX_READING_MINUTES = 600;
const MAX_REVISION = 1_000_000;
const MAX_DATE_LENGTH = 40;
const MAX_CHUNK_SIZE_VALUE = 1_000;
const MAX_ORIGINAL_LENGTH = 400;

export type CultureLoadStatus = "ok" | "empty" | "unavailable" | "version-mismatch";

export interface CultureIndexLoad {
  status: CultureLoadStatus;
  /** Version declared by the loaded index; null when there was no usable payload. */
  version: number | null;
  /** Validated compact rows in corpus order (empty unless status is ok). */
  entries: readonly CultureIndexEntry[];
  /** Rows the generated index carried that did not validate (or repeated an id). */
  dropped: number;
  /** Detail-chunk size the index declared, or CULTURE_CHUNK_SIZE when absent/invalid. */
  chunkSize: number;
}

export interface CultureDetailLoad {
  /**
   * - ok: every requested id was loaded;
   * - partial: some were loaded, the rest are listed in missing;
   * - not-found: none of the requested ids exists in the compact index (nothing fetched);
   * - unavailable: the library/chunk could not be loaded at all;
   * - version-mismatch: the data does not match CULTURE_SCHEMA_VERSION.
   */
  status: "ok" | "partial" | "not-found" | "unavailable" | "version-mismatch";
  items: CultureArticle[];
  missing: string[];
}

/** A replaceable source of raw library modules; results are validated here, not by the source. */
export interface CultureDataSource {
  /** Resolve the compact index payload ({ version, chunkSize, entries }). */
  loadIndex(): Promise<unknown>;
  /** Resolve the detail payload for one chunk window ({ version, items }). May reject. */
  loadChunk(window: number): Promise<unknown>;
}

/* ------------------------------------------------------------------ validators */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A validated record is still untrusted input: every field is read by name, never dotted. */
const field = (record: Record<string, unknown>, key: string): unknown => record[key];

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

/**
 * A library id is an opaque key used in cursors and local stores: not blank, not longer
 * than the bound, and free of whitespace/control characters (so no rendering or cursor
 * ambiguity). A scan rather than a regex because control-character classes are easy to
 * get subtly wrong.
 */
function isId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** A localized field must carry all three display languages, none blank. */
function parseLocalizedText(value: unknown, maxLength: number): LocalizedText | null {
  if (!isRecord(value)) return null;
  const out = {} as LocalizedText;
  for (const locale of LOCALES) {
    const text = field(value, locale);
    if (!isBoundedString(text, maxLength)) return null;
    out[locale] = text;
  }
  return out;
}

/** ISO 3166-1 alpha-2 codes, upper-cased and deduplicated. Absent/invalid: null. */
function parseCountries(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string" || !/^[A-Za-z]{2}$/.test(raw)) continue;
    const code = raw.toUpperCase();
    if (!out.includes(code)) out.push(code);
    if (out.length >= MAX_COUNTRIES) break;
  }
  return out;
}

function parseStringList(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const text = raw.trim().slice(0, maxLength);
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function parseTags(value: unknown): string[] | null {
  return parseStringList(value, MAX_TAGS, MAX_TAG_LENGTH);
}

function parseLanguages(value: unknown): string[] | null {
  return parseStringList(value, MAX_LANGUAGES, MAX_LANGUAGE_LENGTH);
}

function clampWeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function parseIntegerInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
}

function parseDateString(value: unknown): string | null {
  if (!isBoundedString(value, MAX_DATE_LENGTH)) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function parseEnum<T extends string>(value: unknown, allowed: ReadonlySet<string>): T | null {
  return typeof value === "string" && allowed.has(value) ? (value as T) : null;
}

/** Sentinel for "the field was supplied but is not valid" (distinct from "absent"). */
const INVALID = Symbol("invalid");
type Parsed<T> = T | undefined | typeof INVALID;

function parseOptionalLocalized(value: unknown, maxLength: number): Parsed<LocalizedText> {
  if (value === undefined) return undefined;
  return parseLocalizedText(value, maxLength) ?? INVALID;
}

function parseOptionalString(value: unknown, maxLength: number): Parsed<string> {
  if (value === undefined) return undefined;
  return isBoundedString(value, maxLength) ? value : INVALID;
}

function parseOptionalDate(value: unknown): Parsed<string> {
  if (value === undefined) return undefined;
  return parseDateString(value) ?? INVALID;
}

/** Validate and normalise one compact index row. Returns null for unusable rows. */
export function parseCultureIndexEntry(value: unknown): CultureIndexEntry | null {
  if (!isRecord(value)) return null;
  const id = field(value, "id");
  if (!isId(id)) return null;
  const title = parseLocalizedText(field(value, "title"), MAX_TITLE_LENGTH);
  if (!title) return null;
  const teaser = parseLocalizedText(field(value, "teaser"), MAX_TEASER_LENGTH);
  if (!teaser) return null;
  const category = parseEnum<CultureCategory>(field(value, "category"), CATEGORY_SET);
  if (!category) return null;
  const contentType = parseEnum<CultureContentType>(field(value, "contentType"), CONTENT_TYPE_SET);
  if (!contentType) return null;
  const continent = parseEnum<CultureContinent>(field(value, "continent"), CONTINENT_SET);
  if (!continent) return null;
  const countries = parseCountries(field(value, "countries"));
  if (!countries) return null;
  const tags = parseTags(field(value, "tags"));
  if (!tags) return null;
  const readingMinutes = parseIntegerInRange(
    field(value, "readingMinutes"),
    1,
    MAX_READING_MINUTES,
  );
  if (readingMinutes === null) return null;
  const weight = clampWeight(field(value, "weight"));
  if (weight === null) return null;
  const hasExpression = field(value, "hasExpression");
  if (typeof hasExpression !== "boolean") return null;
  return {
    id,
    title,
    teaser,
    category,
    contentType,
    continent,
    countries,
    tags,
    readingMinutes,
    weight,
    hasExpression,
  };
}

function parseSectionList(value: unknown): CultureSection[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SECTIONS) return null;
  const sections: CultureSection[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const heading = field(raw, "heading");
    if (typeof heading !== "string" || !heading.trim() || heading.length > MAX_TITLE_LENGTH)
      return null;
    const rawParagraphs = field(raw, "paragraphs");
    if (
      !Array.isArray(rawParagraphs) ||
      rawParagraphs.length === 0 ||
      rawParagraphs.length > MAX_PARAGRAPHS
    ) {
      return null;
    }
    const paragraphs: string[] = [];
    for (const rawParagraph of rawParagraphs) {
      if (
        typeof rawParagraph !== "string" ||
        !rawParagraph.trim() ||
        rawParagraph.length > MAX_PARAGRAPH_LENGTH
      )
        return null;
      paragraphs.push(rawParagraph);
    }
    sections.push({ heading: heading.trim(), paragraphs });
  }
  return sections;
}

/** The article body is per interface language; every locale must be present. */
function parseSections(value: unknown): Record<CultureLocale, CultureSection[]> | null {
  if (!isRecord(value)) return null;
  const out: Partial<Record<CultureLocale, CultureSection[]>> = {};
  for (const locale of ["ar", "de", "en"] as const) {
    const sections = parseSectionList(field(value, locale));
    if (!sections) return null;
    out[locale] = sections;
  }
  return out as Record<CultureLocale, CultureSection[]>;
}

function parseContext(value: unknown): CultureContext | null {
  if (!isRecord(value)) return null;
  const continent = parseEnum<CultureContinent>(field(value, "continent"), CONTINENT_SET);
  if (!continent) return null;
  const countries = parseCountries(field(value, "countries"));
  if (!countries) return null;
  const languages = parseLanguages(field(value, "languages"));
  if (!languages) return null;
  const region = parseOptionalString(field(value, "region"), MAX_TITLE_LENGTH);
  if (region === INVALID) return null;
  const community = parseOptionalString(field(value, "community"), MAX_TITLE_LENGTH);
  if (community === INVALID) return null;
  const rawPeriod = field(value, "period");
  let period: (typeof PERIODS)[number] | undefined;
  if (rawPeriod !== undefined) {
    const parsedPeriod = parseEnum<(typeof PERIODS)[number]>(rawPeriod, PERIOD_SET);
    if (!parsedPeriod) return null;
    period = parsedPeriod;
  }
  return {
    countries,
    continent,
    languages,
    ...(region === undefined ? {} : { region }),
    ...(community === undefined ? {} : { community }),
    ...(period === undefined ? {} : { period }),
  };
}

function parseExpression(value: unknown): Parsed<CultureExpression> {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return INVALID;
  const original = field(value, "original");
  if (!isBoundedString(original, MAX_ORIGINAL_LENGTH)) return INVALID;
  const language = field(value, "language");
  if (!isBoundedString(language, MAX_LANGUAGE_LENGTH)) return INVALID;
  const transliteration = parseOptionalString(field(value, "transliteration"), MAX_ORIGINAL_LENGTH);
  if (transliteration === INVALID) return INVALID;
  const gloss = parseLocalizedText(field(value, "gloss"), MAX_TEASER_LENGTH);
  if (!gloss) return INVALID;
  const usage = parseLocalizedText(field(value, "usage"), MAX_TEASER_LENGTH);
  if (!usage) return INVALID;
  return {
    original,
    language,
    gloss,
    usage,
    ...(transliteration === undefined ? {} : { transliteration }),
  };
}

function parseSources(value: unknown): CultureSource[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SOURCES) return null;
  const sources: CultureSource[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const organization = field(raw, "organization");
    if (!isBoundedString(organization, MAX_SOURCE_TEXT)) return null;
    const title = parseLocalizedText(field(raw, "title"), MAX_TITLE_LENGTH);
    if (!title) return null;
    const url = field(raw, "url");
    if (!isBoundedString(url, 2_000) || !/^https:\/\//.test(url)) return null;
    const published = parseOptionalDate(field(raw, "published"));
    if (published === INVALID) return null;
    const accessed = parseDateString(field(raw, "accessed"));
    if (!accessed) return null;
    const supports = parseLocalizedText(field(raw, "supports"), MAX_TEASER_LENGTH);
    if (!supports) return null;
    sources.push({
      organization,
      title,
      url,
      accessed,
      supports,
      ...(published === undefined ? {} : { published }),
    });
  }
  return sources;
}

function parseStatus(value: unknown): CultureStatus | null {
  if (!isRecord(value)) return null;
  const verification = parseEnum<CultureVerification>(
    field(value, "verification"),
    VERIFICATION_SET,
  );
  if (!verification) return null;
  const editorial = parseEnum<CultureReview>(field(value, "editorial"), REVIEW_SET);
  if (!editorial) return null;
  const translation = parseEnum<CultureReview>(field(value, "translation"), REVIEW_SET);
  if (!translation) return null;
  const revision = parseIntegerInRange(field(value, "revision"), 0, MAX_REVISION);
  if (revision === null) return null;
  const published = field(value, "published");
  if (typeof published !== "boolean") return null;
  return { verification, editorial, translation, revision, published };
}

function parseRelated(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const raw of value) {
    if (!isId(raw) || out.includes(raw)) continue;
    out.push(raw);
    if (out.length >= MAX_RELATED) break;
  }
  return out;
}

/** Validate one full article body. Returns null for unusable articles. */
export function parseCultureArticle(value: unknown): CultureArticle | null {
  if (!isRecord(value)) return null;
  if (field(value, "version") !== CULTURE_SCHEMA_VERSION) return null;
  const id = field(value, "id");
  if (!isId(id)) return null;
  const slug = field(value, "slug");
  if (!isBoundedString(slug, MAX_SLUG_LENGTH)) return null;
  const contentType = parseEnum<CultureContentType>(field(value, "contentType"), CONTENT_TYPE_SET);
  if (!contentType) return null;
  const category = parseEnum<CultureCategory>(field(value, "category"), CATEGORY_SET);
  if (!category) return null;
  const title = parseLocalizedText(field(value, "title"), MAX_TITLE_LENGTH);
  if (!title) return null;
  const deck = parseLocalizedText(field(value, "deck"), MAX_TEASER_LENGTH);
  if (!deck) return null;
  const teaser = parseLocalizedText(field(value, "teaser"), MAX_TEASER_LENGTH);
  if (!teaser) return null;
  const readingMinutes = parseIntegerInRange(
    field(value, "readingMinutes"),
    1,
    MAX_READING_MINUTES,
  );
  if (readingMinutes === null) return null;
  const sections = parseSections(field(value, "sections"));
  if (!sections) return null;
  const context = parseContext(field(value, "context"));
  if (!context) return null;
  const tags = parseTags(field(value, "tags"));
  if (!tags) return null;
  const sources = parseSources(field(value, "sources"));
  if (!sources) return null;
  const status = parseStatus(field(value, "status"));
  if (!status) return null;
  const related = parseRelated(field(value, "related"));
  if (!related) return null;
  const publishedAt = parseDateString(field(value, "publishedAt"));
  if (!publishedAt) return null;
  const expression = parseExpression(field(value, "expression"));
  if (expression === INVALID) return null;
  const example = parseOptionalLocalized(field(value, "example"), MAX_TEASER_LENGTH);
  if (example === INVALID) return null;
  const misunderstanding = parseOptionalLocalized(
    field(value, "misunderstanding"),
    MAX_TEASER_LENGTH,
  );
  if (misunderstanding === INVALID) return null;
  const comparison = parseOptionalLocalized(field(value, "comparison"), MAX_TEASER_LENGTH);
  if (comparison === INVALID) return null;
  return {
    id,
    version: CULTURE_SCHEMA_VERSION,
    slug,
    contentType,
    category,
    title,
    deck,
    teaser,
    readingMinutes,
    sections,
    context,
    tags,
    sources,
    status,
    related,
    publishedAt,
    ...(expression === undefined ? {} : { expression }),
    ...(example === undefined ? {} : { example }),
    ...(misunderstanding === undefined ? {} : { misunderstanding }),
    ...(comparison === undefined ? {} : { comparison }),
  };
}

/* ----------------------------------------------------------------- parsing payloads */

function parseChunkSize(value: unknown, fallback: number): number {
  return parseIntegerInRange(value, 1, MAX_CHUNK_SIZE_VALUE) ?? fallback;
}

function parseIndexPayload(raw: unknown, fallbackChunkSize: number): CultureIndexLoad {
  const unavailable: CultureIndexLoad = {
    status: "unavailable",
    version: null,
    entries: [],
    dropped: 0,
    chunkSize: fallbackChunkSize,
  };
  if (!isRecord(raw)) return unavailable;
  const version = parseIntegerInRange(field(raw, "version"), 0, Number.MAX_SAFE_INTEGER);
  if (version === null) return unavailable;
  const chunkSize = parseChunkSize(field(raw, "chunkSize"), fallbackChunkSize);
  const rows = field(raw, "entries");
  if (!Array.isArray(rows)) return { ...unavailable, version, chunkSize };
  if (version !== CULTURE_SCHEMA_VERSION) {
    return { status: "version-mismatch", version, entries: [], dropped: 0, chunkSize };
  }
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
  return {
    status: entries.length > 0 ? "ok" : "empty",
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
  const items = field(raw, "items");
  if (!Array.isArray(items)) return null;
  const rawVersion = field(raw, "version");
  const version =
    typeof rawVersion === "number" && Number.isInteger(rawVersion) ? rawVersion : null;
  return { items, version };
}

/* ------------------------------------------------------------------- default source */

type ModuleImporter = () => Promise<unknown>;

// Lazy by construction: these objects only hold importers; no data module is evaluated
// until loadCultureIndex/loadCultureItem actually asks for it.
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
      if (!importer) {
        throw new Error("culture detail chunk " + String(window) + " is not part of this build");
      }
      return unwrapModule(await importer());
    },
  };
  return defaultSource;
}

/* --------------------------------------------------------------------- loader state */

let sourceOverride: CultureDataSource | null = null;
let indexPromise: Promise<CultureIndexLoad> | null = null;
let loadedIndex: CultureIndexLoad | null = null;
let idPositions: Map<string, number> | null = null;
let chunkSize = CULTURE_CHUNK_SIZE;
let detailVersionMismatch = false;

const chunkCache = new Map<number, readonly CultureArticle[]>();
const chunkPromises = new Map<number, Promise<readonly CultureArticle[] | null>>();

function activeSource(): CultureDataSource {
  return sourceOverride ?? getDefaultSource();
}

function clearCaches(): void {
  indexPromise = null;
  loadedIndex = null;
  idPositions = null;
  chunkSize = CULTURE_CHUNK_SIZE;
  detailVersionMismatch = false;
  chunkCache.clear();
  chunkPromises.clear();
}

/**
 * Replace module resolution with an adapter (integration for a different generated layout,
 * or a test fixture). Pass null to go back to the bundled data modules. The loader's
 * caches are dropped so the next read uses the new source.
 */
export function setCultureDataSource(source: CultureDataSource | null): void {
  sourceOverride = source;
  clearCaches();
}

/** Drop cached index/chunks; the next read re-imports from the active source. */
export function resetCultureLoader(): void {
  clearCaches();
}

/** Diagnostics/tests: how many detail chunks are currently retained (bounded by the limit). */
export function cultureLoaderCacheSize(): number {
  return chunkCache.size;
}

/** Synchronous peek: the validated index once loaded, otherwise null. Never triggers a load. */
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
    let result: CultureIndexLoad;
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

function trimChunkCache(): void {
  while (chunkCache.size > CULTURE_CHUNK_CACHE_LIMIT) {
    const oldest = chunkCache.keys().next();
    if (oldest.done) break;
    chunkCache.delete(oldest.value);
  }
}

function ensureChunk(window: number): Promise<readonly CultureArticle[] | null> {
  const cached = chunkCache.get(window);
  if (cached) {
    // Refresh LRU position: a just-read chunk must not be the next one evicted.
    chunkCache.delete(window);
    chunkCache.set(window, cached);
    return Promise.resolve(cached);
  }
  const pending = chunkPromises.get(window);
  if (pending) return pending;
  const promise = (async (): Promise<readonly CultureArticle[] | null> => {
    try {
      const parsed = parseChunkPayload(await activeSource().loadChunk(window));
      if (!parsed) return null;
      if (parsed.version !== null && parsed.version !== CULTURE_SCHEMA_VERSION) {
        detailVersionMismatch = true;
        return null;
      }
      const items: CultureArticle[] = [];
      for (const raw of parsed.items) {
        const item = parseCultureArticle(raw);
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
 * Load the article bodies for the requested ids, preserving the requested order and
 * deduplicating repeats. Ids that are not in the compact index are missing without any
 * chunk request. Chunk loads are cached (bounded) and concurrent loads of the same window
 * share one request. Never throws.
 */
export async function loadCultureItems(ids: readonly string[]): Promise<CultureDetailLoad> {
  const requested = [...new Set(ids)];
  if (requested.length === 0) return { status: "ok", items: [], missing: [] };
  const index = await loadCultureIndex();
  if (index.status === "version-mismatch") {
    return { status: "version-mismatch", items: [], missing: requested };
  }
  if (index.status === "empty") {
    return { status: "not-found", items: [], missing: requested };
  }
  if (index.status !== "ok" || !idPositions) {
    return { status: "unavailable", items: [], missing: requested };
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
  const byId = new Map<string, CultureArticle>();
  for (const chunk of loaded) {
    if (!chunk.items) continue;
    for (const item of chunk.items) {
      const position = positions.get(item.id);
      // A chunk may only serve ids that belong to its positional window; a misplaced body
      // is a corpus bug, not a reason to show the wrong article.
      if (position === undefined || Math.floor(position / chunkSize) !== chunk.window) continue;
      byId.set(item.id, item);
    }
  }
  const items: CultureArticle[] = [];
  const missing: string[] = [];
  for (const id of requested) {
    const item = byId.get(id);
    if (item) items.push(item);
    else missing.push(id);
  }
  const status: CultureDetailLoad["status"] = (() => {
    if (items.length === 0) {
      return detailVersionMismatch ? "version-mismatch" : "unavailable";
    }
    return missing.length > 0 ? "partial" : "ok";
  })();
  return { status, items, missing };
}

/** Load one article body by id. Returns null when it is absent from this library. */
export async function loadCultureItem(id: string): Promise<CultureArticle | null> {
  const result = await loadCultureItems([id]);
  return result.items.find((item) => item.id === id) ?? null;
}

/** Diagnostics and tests: the detail-chunk window an indexed id lives in, if known. */
export function cultureChunkWindow(id: string): number | null {
  const position = idPositions?.get(id);
  return position === undefined ? null : Math.floor(position / chunkSize);
}
