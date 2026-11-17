/**
 * Contract test for the generated culture corpus (A09) against the A10 loader.
 *
 * The generated modules are checked in, so this suite proves the two owners' contract on
 * every run: the compact index validates without drops, every chunk window maps back to
 * the index by position, every body validates, and the discovery surface works on real
 * records (no network: everything is bundled). Assertions use the corpus manifest's own
 * counts, not hard-coded numbers, so a regenerated corpus is checked against its manifest
 * rather than silently drifting.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  browseCulture,
  featuredForDay,
  mixedFeedOrder,
  relatedCultureEntries,
  randomCultureEntry,
} from "./discovery";
import { searchCulture } from "./search";
import {
  cultureChunkWindow,
  loadCultureIndex,
  loadCultureItem,
  loadCultureItems,
  resetCultureLoader,
  setCultureDataSource,
  type CultureIndexLoad,
} from "./loader";
import { CHUNK_SIZE, TOTAL_ITEMS } from "./data/manifest";

let loaded: CultureIndexLoad;

beforeAll(async () => {
  setCultureDataSource(null);
  resetCultureLoader();
  loaded = await loadCultureIndex();
});

describe("generated corpus contract", () => {
  it("validates every compact index row without dropping any", () => {
    expect(loaded.status).toBe("ok");
    expect(loaded.version).toBe(1);
    expect(loaded.chunkSize).toBe(CHUNK_SIZE);
    expect(loaded.dropped).toBe(0);
    expect(loaded.entries).toHaveLength(TOTAL_ITEMS);
    expect(new Set(loaded.entries.map((entry) => entry.id)).size).toBe(TOTAL_ITEMS);
    for (const entry of loaded.entries) {
      expect(entry.title.ar.trim().length).toBeGreaterThan(0);
      expect(entry.title.de.trim().length).toBeGreaterThan(0);
      expect(entry.title.en.trim().length).toBeGreaterThan(0);
      expect(entry.weight).toBeGreaterThanOrEqual(0);
      expect(entry.weight).toBeLessThanOrEqual(1);
      // Countries may be empty for a culture the source does not tie to a state; every
      // stated country must still be an upper-case ISO 3166-1 alpha-2 code.
      for (const country of entry.countries) expect(country).toMatch(/^[A-Z]{2}$/);
      if (entry.hasMedia) {
        expect(entry.media?.url.startsWith("https://")).toBe(true);
        expect(entry.media?.license.trim().length).toBeGreaterThan(0);
        expect(entry.media?.credit.trim().length).toBeGreaterThan(0);
      }
    }
    // A card flag and a card image must agree: hasMedia may never promise media the
    // validator rejected (that would render a wrong credit or an empty picture).
    const flagged = loaded.entries.filter((entry) => entry.hasMedia);
    expect(flagged.length).toBeGreaterThan(0);
    for (const entry of flagged) expect(entry.media).toBeTruthy();
  });

  it("loads and validates every body through its positional chunk window", async () => {
    const ids = loaded.entries.map((entry) => entry.id);
    const result = await loadCultureItems(ids);
    expect(result.status).toBe("ok");
    expect(result.missing).toEqual([]);
    expect(result.items).toHaveLength(TOTAL_ITEMS);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(TOTAL_ITEMS);
    expect(new Set(result.items.map((item) => item.id))).toEqual(new Set(ids));
    for (const item of result.items) {
      expect(item.version).toBe(1);
      expect(item.source.organization).toBe("The Metropolitan Museum of Art");
      expect(item.source.url.startsWith("https://")).toBe(true);
      expect(item.source.license).toBe("CC0-1.0");
      expect(item.source.attribution.trim().length).toBeGreaterThan(0);
      expect(item.provenance).toBe("machine-translated");
      expect(Number.isNaN(Date.parse(item.ingestedAt))).toBe(false);
    }
  });

  it("resolves the first, middle and last record through the public detail path", async () => {
    const first = loaded.entries[0];
    const middle = loaded.entries[Math.floor(loaded.entries.length / 2)];
    const last = loaded.entries[loaded.entries.length - 1];
    expect(first && middle && last).toBeTruthy();
    for (const entry of [first, middle, last]) {
      if (!entry) continue;
      const item = await loadCultureItem(entry.id);
      expect(item?.id).toBe(entry.id);
      expect(item?.title.ar.trim().length).toBeGreaterThan(0);
      expect(item?.place.continent).toBe(entry.continent);
      expect(cultureChunkWindow(entry.id)).toBe(
        Math.floor(loaded.entries.findIndex((row) => row.id === entry.id) / CHUNK_SIZE),
      );
    }
    expect(cultureChunkWindow("met-does-not-exist")).toBeNull();
  });

  it("spaces every card: no adjacent repeated title, category or shared country", () => {
    const order = mixedFeedOrder(loaded.entries);
    const titleKey = (title: string): string =>
      title
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    expect(order).toHaveLength(TOTAL_ITEMS);
    expect(new Set(order.map((entry) => entry.id)).size).toBe(TOTAL_ITEMS);
    let titleRepeats = 0;
    let adjacencyBreaks = 0;
    for (let i = 1; i < order.length; i += 1) {
      const previous = order[i - 1];
      const current = order[i];
      if (!previous || !current) continue;
      if (titleKey(previous.title.en) === titleKey(current.title.en)) titleRepeats += 1;
      const sharedCountry =
        previous.countries.length > 0 &&
        current.countries.length > 0 &&
        current.countries.some((country) => previous.countries.includes(country));
      if (previous.category === current.category || sharedCountry) adjacencyBreaks += 1;
    }
    // A museum catalog repeats generic object names; the feed must spread them (nearby gaps
    // are tolerated in the exhausted tail) but the hard diversity rule must hold everywhere.
    expect(titleRepeats).toBe(0);
    expect(adjacencyBreaks).toBe(0);
  });

  it("pages the real feed without duplicates and the same total as the index", () => {
    const firstPage = browseCulture(loaded.entries, { limit: 24 });
    expect(firstPage.total).toBe(TOTAL_ITEMS);
    expect(firstPage.items).toHaveLength(24);
    expect(firstPage.nextCursor).toBe(firstPage.items.at(-1)?.id);
    const secondPage = browseCulture(loaded.entries, {
      limit: 24,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.items).toHaveLength(24);
    const firstIds = new Set(firstPage.items.map((entry) => entry.id));
    expect(secondPage.items.some((entry) => firstIds.has(entry.id))).toBe(false);
    const europe = firstPage.items.filter((entry) => entry.continent === "europe").length;
    // The corpus is Europe-light in the manifest (116/595) and the feed must not concentrate it.
    expect(europe).toBeLessThanOrEqual(12);
  });

  it("features one real record deterministically for the local day", () => {
    const dayKey = "2026-11-17";
    const featured = featuredForDay(loaded.entries, dayKey);
    expect(featured).not.toBeNull();
    expect(loaded.entries.some((entry) => entry.id === featured?.id)).toBe(true);
    expect(featuredForDay(loaded.entries, dayKey)?.id).toBe(featured?.id);
  });

  it("searches real Arabic, German and English titles diacritic-insensitively", () => {
    const first = loaded.entries[0];
    expect(first).toBeTruthy();
    if (!first) return;
    for (const title of [first.title.ar, first.title.de, first.title.en]) {
      const hits = searchCulture(loaded.entries, title, { limit: 10 });
      expect(hits.some((hit) => hit.entry.id === first.id)).toBe(true);
    }
    // A German title with an umlaut must be findable without typing the umlaut.
    const umlaut = loaded.entries.find((entry) => /[äöüÄÖÜ]/.test(entry.title.de));
    expect(umlaut).toBeTruthy();
    if (umlaut) {
      const folded = umlaut.title.de
        .normalize("NFKD")
        .replace(/\p{M}+/gu, "")
        .replace(/ß/g, "ss")
        .toLowerCase();
      expect(
        searchCulture(loaded.entries, folded, { limit: 20 }).some(
          (hit) => hit.entry.id === umlaut.id,
        ),
      ).toBe(true);
    }
  });

  it("relates real records from declared and shared metadata only", async () => {
    const all = await loadCultureItems(loaded.entries.map((entry) => entry.id));
    const withRelated = all.items.find((item) => (item.related?.length ?? 0) > 0);
    expect(withRelated).toBeTruthy();
    if (!withRelated) return;
    const related = relatedCultureEntries(loaded.entries, withRelated.id, {
      declared: withRelated.related,
    });
    expect(related.length).toBeGreaterThan(0);
    expect(related.some((entry) => entry.id === withRelated.id)).toBe(false);
    expect(withRelated.related?.includes(related[0]?.id ?? "")).toBe(true);
  });

  it("picks a novel real record that avoids the recent history", () => {
    const seen = loaded.entries.slice(0, 80).map((entry) => entry.id);
    const exclude = loaded.entries.slice(80, 90).map((entry) => entry.id);
    const picked = randomCultureEntry(loaded.entries, { seen, exclude, random: () => 0.42 });
    expect(picked).not.toBeNull();
    expect(seen).not.toContain(picked?.id);
    expect(exclude).not.toContain(picked?.id);
  });
});
