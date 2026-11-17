/**
 * Test support for the culture library domain.
 *
 * This module is imported only by *.test.ts files; no runtime module imports it, so it never
 * reaches the app bundle. It exists so the loader/search/discovery/adapter/saved/seen tests
 * share one deterministic synthetic library instead of six hand-written ones. Real data
 * comes from the generated data/ modules (see loader.ts); nothing here is shipped content.
 */
import { CULTURE_CATEGORIES, CULTURE_SCHEMA_VERSION } from "./types";
import type {
  CultureArticle,
  CultureCategory,
  CultureContentType,
  CultureContinent,
  CultureIndexEntry,
  CultureLocale,
  CultureSection,
  CultureSource,
  LocalizedText,
} from "./types";
import type { CultureDataSource } from "./loader";

export const TEST_CONTINENTS: readonly CultureContinent[] = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];

export const TEST_CATEGORIES: readonly CultureCategory[] = CULTURE_CATEGORIES;

export const TEST_CONTENT_TYPES: readonly CultureContentType[] = [
  "feature",
  "note",
  "language",
  "scene",
  "contrast",
  "detail",
];

/** Stable two-letter ISO-like code for a number, so countries stay unique for a while. */
export function testCountry(index: number): string {
  const first = String.fromCharCode(65 + (index % 26));
  const second = String.fromCharCode(65 + (Math.floor(index / 26) % 26));
  return first + second;
}

export function localized(prefix: string): LocalizedText {
  return { ar: "عربي " + prefix, de: "Deutsch " + prefix, en: "English " + prefix };
}

export interface EntryOverrides {
  title?: LocalizedText | undefined;
  teaser?: LocalizedText | undefined;
  category?: CultureCategory | undefined;
  contentType?: CultureContentType | undefined;
  continent?: CultureContinent | undefined;
  countries?: string[] | undefined;
  tags?: string[] | undefined;
  readingMinutes?: number | undefined;
  weight?: number | undefined;
  hasExpression?: boolean | undefined;
}

/** One compact index row with deterministic defaults. */
export function makeCultureEntry(id: string, overrides: EntryOverrides = {}): CultureIndexEntry {
  return {
    id,
    title: overrides.title ?? localized(id),
    teaser: overrides.teaser ?? {
      ar: "لمحة عن " + id,
      de: "Einblick in " + id,
      en: "A glimpse of " + id,
    },
    category: overrides.category ?? TEST_CATEGORIES[0] ?? "everyday-life",
    contentType: overrides.contentType ?? TEST_CONTENT_TYPES[0] ?? "feature",
    continent: overrides.continent ?? TEST_CONTINENTS[0] ?? "africa",
    countries: overrides.countries ?? [testCountry(0)],
    tags: overrides.tags ?? [],
    readingMinutes: overrides.readingMinutes ?? 4,
    weight: overrides.weight ?? 0.5,
    hasExpression: overrides.hasExpression ?? false,
  };
}

function localizedSections(id: string): Record<CultureLocale, CultureSection[]> {
  const one = (locale: "ar" | "de" | "en"): CultureSection[] => [
    {
      heading: "section " + id + " (" + locale + ")",
      paragraphs: ["paragraph one " + id + " (" + locale + ")", "paragraph two " + id],
    },
  ];
  return { ar: one("ar"), de: one("de"), en: one("en") };
}

/**
 * A full CultureArticle body for an index row. The defaults are valid against the loader's
 * validator, so a test that wants an invalid row overrides one field deliberately.
 */
export function makeCultureArticle(
  entry: CultureIndexEntry,
  overrides: Partial<CultureArticle> = {},
): CultureArticle {
  const source: CultureSource = {
    organization: "Test Archive",
    title: localized("source " + entry.id),
    url: "https://example.org/culture/" + entry.id,
    accessed: "2026-11-17",
    supports: localized("supports " + entry.id),
  };
  const base: CultureArticle = {
    id: entry.id,
    version: CULTURE_SCHEMA_VERSION,
    slug: entry.id,
    contentType: entry.contentType,
    category: entry.category,
    title: entry.title,
    deck: localized("deck " + entry.id),
    teaser: entry.teaser,
    readingMinutes: entry.readingMinutes,
    sections: localizedSections(entry.id),
    context: {
      countries: [...entry.countries],
      continent: entry.continent,
      languages: ["ar", "de"],
    },
    tags: [...entry.tags],
    sources: [source],
    status: {
      verification: "source-linked",
      editorial: "editor-reviewed",
      translation: "machine-drafted",
      revision: 1,
      published: true,
    },
    related: [],
    publishedAt: "2026-11-17",
    ...(entry.hasExpression
      ? {
          expression: {
            original: "say " + entry.id,
            transliteration: "say " + entry.id,
            language: "Arabic",
            gloss: localized("gloss " + entry.id),
            usage: localized("usage " + entry.id),
          },
        }
      : {}),
  };
  return { ...base, ...overrides } as CultureArticle;
}

/**
 * A library whose continents are deliberately unbalanced (Europe carries a third of the
 * rows) and whose categories/countries vary per row, so the feed's rotation and adjacency
 * rules are satisfiable and worth asserting.
 */
export function syntheticCultureEntries(count = 60): CultureIndexEntry[] {
  const entries: CultureIndexEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = "culture-" + String(index + 1);
    entries.push(
      makeCultureEntry(id, {
        continent: TEST_CONTINENTS[index % TEST_CONTINENTS.length] ?? "africa",
        category: TEST_CATEGORIES[(index * 7 + 3) % TEST_CATEGORIES.length] ?? "everyday-life",
        contentType: TEST_CONTENT_TYPES[index % TEST_CONTENT_TYPES.length] ?? "feature",
        countries: [testCountry(index)],
        tags: ["tag-" + String(index % 9), "topic-" + String(index % 5)],
        weight: ((index * 37) % 100) / 100,
        readingMinutes: 3 + (index % 9),
        hasExpression: index % 4 === 0,
      }),
    );
  }
  return entries;
}

/** A Europe-heavy catalog: 20 Europe, then 8/8/6/6/6 for the other continents. */
export function europeHeavyCultureEntries(): CultureIndexEntry[] {
  const plan: { continent: CultureContinent; count: number }[] = [
    { continent: "europe", count: 20 },
    { continent: "asia", count: 8 },
    { continent: "africa", count: 8 },
    { continent: "north-america", count: 6 },
    { continent: "south-america", count: 6 },
    { continent: "oceania", count: 6 },
  ];
  const entries: CultureIndexEntry[] = [];
  let index = 0;
  for (const row of plan) {
    for (let n = 0; n < row.count; n += 1) {
      entries.push(
        makeCultureEntry("culture-" + String(index + 1), {
          continent: row.continent,
          category: TEST_CATEGORIES[(index * 5 + 1) % TEST_CATEGORIES.length] ?? "everyday-life",
          contentType: TEST_CONTENT_TYPES[(index * 3) % TEST_CONTENT_TYPES.length] ?? "feature",
          countries: [testCountry(index)],
          tags: ["tag-" + String(index % 7)],
          weight: ((index * 29) % 100) / 100,
          hasExpression: index % 2 === 0,
        }),
      );
      index += 1;
    }
  }
  return entries;
}

/** Compact index payload the loader accepts, and matching detail payloads per window. */
export function chunkedCultureCatalog(
  entries: readonly CultureIndexEntry[],
  chunkSize: number,
  version = CULTURE_SCHEMA_VERSION,
): {
  payload: { version: number; chunkSize: number; entries: CultureIndexEntry[] };
  chunks: Map<number, unknown>;
} {
  const items = entries.map((entry) => makeCultureArticle(entry));
  const chunks = new Map<number, unknown>();
  for (let position = 0; position < items.length; position += chunkSize) {
    const window = Math.floor(position / chunkSize);
    chunks.set(window, { version, items: items.slice(position, position + chunkSize) });
  }
  return {
    payload: { version, chunkSize, entries: [...entries] },
    chunks,
  };
}

export interface FixtureCounters {
  indexLoads: number;
  chunkLoads: number[];
}

export interface FixtureSourceOptions {
  indexThrows?: boolean | undefined;
  /** Chunk windows whose loader call rejects (simulates a missing module). */
  chunkThrows?: ReadonlySet<number> | undefined;
}

export function makeFixtureCounters(): FixtureCounters {
  return { indexLoads: 0, chunkLoads: [] };
}

/** An in-memory CultureDataSource that records how often the loader asked it for data. */
export function fixtureCultureSource(
  payload: unknown,
  chunks: ReadonlyMap<number, unknown>,
  counters: FixtureCounters = makeFixtureCounters(),
  options: FixtureSourceOptions = {},
): CultureDataSource {
  return {
    async loadIndex() {
      counters.indexLoads += 1;
      if (options.indexThrows === true) throw new Error("index missing");
      return payload;
    },
    async loadChunk(window: number) {
      counters.chunkLoads.push(window);
      if (options.chunkThrows?.has(window) === true) {
        throw new Error("chunk " + String(window) + " missing");
      }
      return chunks.get(window) ?? { version: CULTURE_SCHEMA_VERSION, items: [] };
    },
  };
}
