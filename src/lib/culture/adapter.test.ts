import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCultureDiscoveryAdapter, CULTURE_RELATED_DEFAULT_LIMIT } from "./adapter";
import { featuredForDay, RELATED_DEFAULT_LIMIT } from "./discovery";
import { loadCultureIndex, resetCultureLoader, setCultureDataSource } from "./loader";
import {
  clearCultureSaved,
  listSavedCultureIds,
  resetCultureSavedCache,
  saveCultureItem,
} from "./saved";
import {
  chunkedCultureCatalog,
  fixtureCultureSource,
  makeFixtureCounters,
  makeCultureEntry,
  syntheticCultureEntries,
} from "./testing";
import { CULTURE_CATEGORIES, type CultureIndexEntry } from "./types";

const entries = syntheticCultureEntries(60);

function installLibrary(
  catalog: {
    payload: unknown;
    chunks: ReadonlyMap<number, unknown>;
  } = chunkedCultureCatalog(entries, 10),
) {
  setCultureDataSource(fixtureCultureSource(catalog.payload, catalog.chunks));
}

function installEmptyLibrary() {
  setCultureDataSource(fixtureCultureSource({ version: 2, chunkSize: 10, entries: [] }, new Map()));
}

function installUnavailableLibrary() {
  setCultureDataSource(
    fixtureCultureSource(null, new Map(), makeFixtureCounters(), { indexThrows: true }),
  );
}

beforeEach(() => {
  localStorage.clear();
  resetCultureSavedCache();
  setCultureDataSource(null);
  resetCultureLoader();
  installLibrary();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetCultureSavedCache();
  setCultureDataSource(null);
  resetCultureLoader();
});

describe("culture discovery adapter: pages", () => {
  it("pages the compact index with a stable cursor and no duplicates", async () => {
    const adapter = createCultureDiscoveryAdapter();
    const first = await adapter.loadPage({ limit: 10 });
    expect(first.total).toBe(60);
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).toBe(first.items[first.items.length - 1]?.id);
    const second = await adapter.loadPage({ limit: 10, cursor: first.nextCursor });
    expect(second.items).toHaveLength(10);
    const firstIds = new Set(first.items.map((entry) => entry.id));
    expect(second.items.some((entry) => firstIds.has(entry.id))).toBe(false);
    await expect(adapter.loadPage({ limit: 10, cursor: "culture-gone" })).resolves.toMatchObject({
      total: 60,
    });
  });

  it("defaults the page size and ignores the language filter the index cannot answer", async () => {
    const adapter = createCultureDiscoveryAdapter();
    const page = await adapter.loadPage({ language: "de" });
    expect(page.items).toHaveLength(24);
    expect(page.total).toBe(60);
  });

  it("applies category, continent, country, content type and search filters", async () => {
    const adapter = createCultureDiscoveryAdapter();
    const target = entries[3] as CultureIndexEntry;
    const byCategory = await adapter.loadPage({ category: target.category, limit: 60 });
    expect(byCategory.items.every((entry) => entry.category === target.category)).toBe(true);
    expect(byCategory.total).toBe(
      entries.filter((entry) => entry.category === target.category).length,
    );
    const byContinent = await adapter.loadPage({ continent: target.continent, limit: 60 });
    expect(byContinent.items.every((entry) => entry.continent === target.continent)).toBe(true);
    const byType = await adapter.loadPage({ contentType: target.contentType, limit: 60 });
    expect(byType.items.every((entry) => entry.contentType === target.contentType)).toBe(true);
    const searchable = [
      makeCultureEntry("culture-kaffee", {
        title: { ar: "القهوة", de: "Kaffee", en: "Coffee" },
        teaser: { ar: "مشروب", de: "Getrank", en: "Drink" },
        tags: [],
      }),
      makeCultureEntry("culture-other", {
        title: { ar: "سوق", de: "Markt", en: "Market" },
        teaser: { ar: "سوق", de: "Markt", en: "Market" },
        tags: [],
      }),
    ];
    installLibrary(chunkedCultureCatalog(searchable, 10));
    const searchPage = await createCultureDiscoveryAdapter().loadPage({ search: "kaffee" });
    expect(searchPage.items.map((entry) => entry.id)).toEqual(["culture-kaffee"]);
  });

  it("uses the saved store for the saved-only page", async () => {
    const adapter = createCultureDiscoveryAdapter();
    await saveCultureItem("culture-2");
    await saveCultureItem("culture-9");
    await saveCultureItem("culture-does-not-exist");
    const page = await adapter.loadPage({ savedOnly: true, limit: 10 });
    expect(page.total).toBe(2);
    // The saved view is still a feed page, so its order is the diversity order, not the
    // saved list order (the store's entries() keeps saved order).
    expect(page.items.map((entry) => entry.id).sort()).toEqual(["culture-2", "culture-9"]);
    await expect(adapter.loadPage({ savedOnly: true })).resolves.toMatchObject({ total: 2 });
  });
});

describe("culture discovery adapter: facets", () => {
  it("derives counts that match the compact index", async () => {
    const adapter = createCultureDiscoveryAdapter();
    const facets = await adapter.loadFacets();
    expect(facets.categories.reduce((sum, option) => sum + option.count, 0)).toBe(60);
    expect(facets.continents.reduce((sum, option) => sum + option.count, 0)).toBe(60);
    expect(facets.types.reduce((sum, option) => sum + option.count, 0)).toBe(60);
    expect(facets.continents).toHaveLength(6);
    for (const option of facets.continents) expect(option.count).toBe(10);
    const expectedCategories = CULTURE_CATEGORIES.flatMap((category) => {
      const count = entries.filter((entry) => entry.category === category).length;
      return count > 0 ? [category] : [];
    });
    expect(facets.categories.map((option) => option.value)).toEqual(expectedCategories);
    for (const option of facets.categories) {
      expect(option.count).toBe(entries.filter((entry) => entry.category === option.value).length);
    }
    for (const option of facets.types) {
      expect(option.count).toBe(
        entries.filter((entry) => entry.contentType === option.value).length,
      );
    }
    expect(facets.countries).toHaveLength(60);
    expect(facets.countries.every((option) => option.count === 1)).toBe(true);
    const sortedValues = facets.countries.map((option) => option.value);
    expect([...sortedValues].sort()).toEqual(sortedValues);
  });

  it("returns empty facets for an empty library", async () => {
    installEmptyLibrary();
    const facets = await createCultureDiscoveryAdapter().loadFacets();
    expect(facets).toEqual({ categories: [], continents: [], countries: [], types: [] });
  });
});

describe("culture discovery adapter: feature and articles", () => {
  it("features the deterministic article of the injected day", async () => {
    const loaded = await loadCultureIndex();
    expect(loaded.status).toBe("ok");
    const adapter = createCultureDiscoveryAdapter({ dayKey: () => "2026-11-17" });
    const featured = await adapter.loadFeatured();
    expect(featured).not.toBeNull();
    expect(featured?.id).toBe(featuredForDay(loaded.entries, "2026-11-17")?.id);
    expect((await adapter.loadFeatured())?.id).toBe(featured?.id);
    const noDay = createCultureDiscoveryAdapter();
    expect(await noDay.loadFeatured()).not.toBeNull();
  });

  it("loads a full article by id and resolves null for unknown ids", async () => {
    const loaded = await loadCultureIndex();
    const first = loaded.entries[0] as CultureIndexEntry;
    const adapter = createCultureDiscoveryAdapter();
    const article = await adapter.loadItem(first.id);
    expect(article?.id).toBe(first.id);
    expect(article?.sections.en.length).toBeGreaterThan(0);
    expect(article?.title.ar.trim().length).toBeGreaterThan(0);
    expect(await adapter.loadItem("culture-missing")).toBeNull();
  });

  it("resolves declared related ids in order and drops unknown ids", async () => {
    const loaded = await loadCultureIndex();
    const ids = [
      loaded.entries[5]?.id ?? "",
      loaded.entries[2]?.id ?? "",
      "culture-missing",
      loaded.entries[5]?.id ?? "",
    ];
    const related = await createCultureDiscoveryAdapter().loadRelated(ids);
    expect(related.map((entry) => entry.id)).toEqual([
      loaded.entries[5]?.id,
      loaded.entries[2]?.id,
    ]);
    expect(await createCultureDiscoveryAdapter().loadRelated([])).toEqual([]);
  });

  it("exposes the saved port over the device store", async () => {
    await loadCultureIndex();
    const adapter = createCultureDiscoveryAdapter();
    const listener = vi.fn();
    const unsubscribe = adapter.saved.subscribe(listener);
    expect(adapter.saved.ids()).toEqual([]);
    await saveCultureItem("culture-1");
    await saveCultureItem("culture-2");
    expect(adapter.saved.ids()).toEqual(["culture-2", "culture-1"]);
    expect(adapter.saved.entries().map((entry) => entry.id)).toEqual(["culture-2", "culture-1"]);
    adapter.saved.toggle("culture-3");
    await vi.waitFor(() => expect(listSavedCultureIds()).toContain("culture-3"));
    expect(adapter.saved.ids()[0]).toBe("culture-3");
    unsubscribe();
    await clearCultureSaved();
    expect(adapter.saved.entries()).toEqual([]);
  });
});

describe("culture discovery adapter: failure contract", () => {
  it("rejects page/facets/feature calls when the library is unavailable", async () => {
    installUnavailableLibrary();
    const adapter = createCultureDiscoveryAdapter();
    await expect(adapter.loadPage({})).rejects.toThrow("culture-catalog-unavailable");
    await expect(adapter.loadFacets()).rejects.toThrow("culture-catalog-unavailable");
    await expect(adapter.loadFeatured()).rejects.toThrow("culture-catalog-unavailable");
    expect(await adapter.loadRelated(["culture-1"])).toEqual([]);
    expect(await adapter.loadItem("culture-1")).toBeNull();
  });

  it("rejects when the index declares another schema version", async () => {
    const catalog = chunkedCultureCatalog(entries, 10);
    setCultureDataSource(fixtureCultureSource({ ...catalog.payload, version: 1 }, catalog.chunks));
    const adapter = createCultureDiscoveryAdapter();
    await expect(adapter.loadPage({})).rejects.toThrow("culture-catalog-version-mismatch");
    await expect(adapter.loadFacets()).rejects.toThrow("culture-catalog-version-mismatch");
  });

  it("resolves an empty page and no feature for an empty library", async () => {
    installEmptyLibrary();
    const adapter = createCultureDiscoveryAdapter();
    expect(await adapter.loadPage({})).toEqual({ items: [], total: 0 });
    expect(await adapter.loadFeatured()).toBeNull();
    expect(await adapter.loadItem("culture-1")).toBeNull();
  });

  it("honours an abort signal", async () => {
    const adapter = createCultureDiscoveryAdapter();
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.loadPage({}, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    const fine = new AbortController();
    expect((await adapter.loadPage({ limit: 2 }, fine.signal)).items).toHaveLength(2);
  });

  it("reports connectivity and keeps one stable adapter identity", () => {
    const adapter = createCultureDiscoveryAdapter();
    expect(typeof adapter.online?.()).toBe("boolean");
    expect(adapter.saved).toBe(adapter.saved);
    expect(createCultureDiscoveryAdapter()).not.toBe(adapter);
  });

  it("keeps the default related limit aligned with the discovery engine", () => {
    // The adapter re-exports the engine's default so the UI and the engine cannot drift.
    expect(CULTURE_RELATED_DEFAULT_LIMIT).toBe(RELATED_DEFAULT_LIMIT);
  });
});
