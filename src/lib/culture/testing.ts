/**
 * Test support for the culture discovery domain.
 *
 * This module is imported only by `*.test.ts` files; no runtime module imports it, so it
 * never reaches the app bundle. It exists so the loader/search/discovery/saved/seen tests
 * share one deterministic synthetic catalog instead of five hand-written ones. Real data
 * comes from the generated `data/` modules (see loader.ts); nothing here is shipped or
 * presented as content.
 */
import {
  CULTURE_CATEGORIES,
  CULTURE_SCHEMA_VERSION,
  type CultureCategory,
  type CultureContinent,
  type CultureIndexEntry,
  type CultureItem,
  type CultureMedia,
  type LocalizedText,
} from "./types";

export const TEST_CONTINENTS: readonly CultureContinent[] = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];

export const TEST_CATEGORIES: readonly CultureCategory[] = CULTURE_CATEGORIES;

/** Stable two-letter ISO-like code for a number, so countries stay unique for a while. */
export function testCountry(index: number): string {
  const first = String.fromCharCode(65 + (index % 26));
  const second = String.fromCharCode(65 + (Math.floor(index / 26) % 26));
  return `${first}${second}`;
}

export interface EntryOverrides {
  title?: Partial<LocalizedText> | undefined;
  category?: CultureCategory | undefined;
  continent?: CultureContinent | undefined;
  countries?: string[] | undefined;
  tags?: string[] | undefined;
  weight?: number | undefined;
  hasMedia?: boolean | undefined;
  media?: CultureMedia | undefined;
}

/** One compact index row with deterministic defaults. */
export function makeEntry(id: string, overrides: EntryOverrides = {}): CultureIndexEntry {
  const title: LocalizedText = {
    ar: `عنصر ${id}`,
    de: `Eintrag ${id}`,
    en: `Item ${id}`,
    ...overrides.title,
  };
  return {
    id,
    title,
    category: overrides.category ?? TEST_CATEGORIES[0] ?? "traditions",
    continent: overrides.continent ?? TEST_CONTINENTS[0] ?? "africa",
    countries: overrides.countries ?? [testCountry(0)],
    tags: overrides.tags ?? [],
    weight: overrides.weight ?? 0.5,
    hasMedia: overrides.hasMedia ?? false,
    ...(overrides.media ? { media: overrides.media } : {}),
  };
}

/**
 * A catalog whose continents are deliberately unbalanced (Europe carries half the rows),
 * to prove the feed does not simply mirror the corpus. Categories and countries vary per
 * row so the adjacency rule is satisfiable.
 */
export function syntheticIndex(count = 60): CultureIndexEntry[] {
  const entries: CultureIndexEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    entries.push(
      makeEntry(`met-${String(i + 1)}`, {
        continent: TEST_CONTINENTS[i % TEST_CONTINENTS.length] ?? "africa",
        category: TEST_CATEGORIES[(i * 7 + 3) % TEST_CATEGORIES.length] ?? "traditions",
        countries: [testCountry(i)],
        tags: [`tag-${String(i % 9)}`, `topic-${String(i % 5)}`],
        weight: ((i * 37) % 100) / 100,
        hasMedia: i % 3 === 0,
      }),
    );
  }
  return entries;
}

/** A Europe-heavy catalog: 20 Europe, 8 Asia, 8 Africa, 6 North America, 6 South America, 6 Oceania. */
export function europeHeavyIndex(): CultureIndexEntry[] {
  const plan: { continent: CultureContinent; count: number }[] = [
    { continent: "europe", count: 20 },
    { continent: "asia", count: 8 },
    { continent: "africa", count: 8 },
    { continent: "north-america", count: 6 },
    { continent: "south-america", count: 6 },
    { continent: "oceania", count: 6 },
  ];
  const entries: CultureIndexEntry[] = [];
  let i = 0;
  for (const row of plan) {
    for (let n = 0; n < row.count; n += 1) {
      entries.push(
        makeEntry(`met-${String(i + 1)}`, {
          continent: row.continent,
          category: TEST_CATEGORIES[(i * 5 + 1) % TEST_CATEGORIES.length] ?? "traditions",
          countries: [testCountry(i)],
          tags: [`tag-${String(i % 7)}`],
          weight: ((i * 29) % 100) / 100,
          hasMedia: i % 2 === 0,
        }),
      );
      i += 1;
    }
  }
  return entries;
}

/** A full `CultureItem` body for an index row (valid against loader's validator). */
export function makeItem(
  index: CultureIndexEntry,
  overrides: Partial<CultureItem> = {},
): CultureItem {
  return {
    id: index.id,
    version: CULTURE_SCHEMA_VERSION,
    title: {
      ...index.title,
      original: index.title.en,
      originalLanguage: "en",
    },
    summary: {
      ar: `ملخص ${index.id}`,
      de: `Zusammenfassung ${index.id}`,
      en: `Summary ${index.id}`,
    },
    taxonomy: { category: index.category },
    place: { continent: index.continent, countries: [...index.countries] },
    tags: [...index.tags],
    source: {
      organization: "Test Museum",
      url: `https://example.org/culture/${index.id}`,
      license: "CC0-1.0",
      attribution: "Test Museum, CC0",
    },
    provenance: "machine-translated",
    ingestedAt: "2026-11-17",
    ...overrides,
  };
}

/** Compact index payload the loader accepts, and matching detail arrays per window. */
export function chunkedCatalog(
  entries: readonly CultureIndexEntry[],
  chunkSize: number,
  version = 1,
): {
  payload: { version: number; chunkSize: number; entries: CultureIndexEntry[] };
  chunks: Map<number, unknown>;
} {
  const items = entries.map((entry) => makeItem(entry));
  const chunks = new Map<number, unknown>();
  for (let position = 0; position < items.length; position += chunkSize) {
    const window = Math.floor(position / chunkSize);
    chunks.set(window, items.slice(position, position + chunkSize));
  }
  return {
    payload: { version, chunkSize, entries: [...entries] },
    chunks,
  };
}
