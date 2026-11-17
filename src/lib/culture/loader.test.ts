import { beforeEach, describe, expect, it } from "vitest";
import {
  CULTURE_CHUNK_CACHE_LIMIT,
  CULTURE_CHUNK_SIZE,
  cultureChunkWindow,
  cultureIndexStatus,
  cultureLoaderCacheSize,
  loadCultureIndex,
  loadCultureItem,
  loadCultureItems,
  parseCultureArticle,
  parseCultureIndexEntry,
  peekCultureIndex,
  resetCultureLoader,
  setCultureDataSource,
} from "./loader";
import {
  chunkedCultureCatalog,
  fixtureCultureSource,
  makeCultureArticle,
  makeCultureEntry,
  makeFixtureCounters,
  syntheticCultureEntries,
} from "./testing";

function catalog(count: number, chunkSize: number) {
  const entries = Array.from({ length: count }, (_, index) =>
    makeCultureEntry("culture-" + String(index + 1)),
  );
  const { payload, chunks } = chunkedCultureCatalog(entries, chunkSize);
  return { entries, payload, chunks };
}

beforeEach(() => {
  setCultureDataSource(null);
  resetCultureLoader();
});

describe("culture loader: index", () => {
  it("imports nothing until a screen asks for the library", () => {
    const counters = makeFixtureCounters();
    const { payload, chunks } = catalog(5, 2);
    setCultureDataSource(fixtureCultureSource(payload, chunks, counters));
    expect(peekCultureIndex()).toBeNull();
    expect(cultureIndexStatus()).toBe("idle");
    expect(counters.indexLoads).toBe(0);
    expect(cultureLoaderCacheSize()).toBe(0);
  });

  it("loads the compact index once, even for concurrent callers", async () => {
    const counters = makeFixtureCounters();
    const { entries, payload, chunks } = catalog(5, 2);
    setCultureDataSource(fixtureCultureSource(payload, chunks, counters));
    const [first, second, third] = await Promise.all([
      loadCultureIndex(),
      loadCultureIndex(),
      loadCultureIndex(),
    ]);
    expect(counters.indexLoads).toBe(1);
    expect(first.status).toBe("ok");
    expect(first.version).toBe(2);
    expect(first.chunkSize).toBe(2);
    expect(first.dropped).toBe(0);
    expect(first.entries.map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id));
    expect(second.entries).toBe(first.entries);
    expect(third).toBe(first);
    expect(peekCultureIndex()).toBe(first.entries);
    expect(cultureIndexStatus()).toBe("ok");
    expect(cultureChunkWindow("culture-3")).toBe(1);
    expect(cultureChunkWindow("culture-999")).toBeNull();
  });

  it("validates rows, drops unusable ones and counts the drops", async () => {
    const counters = makeFixtureCounters();
    const good = makeCultureEntry("culture-1");
    const payload = {
      version: 2,
      chunkSize: 10,
      entries: [
        good,
        { ...good, id: "" },
        { ...good, id: "culture-2", title: { ar: "", de: "x", en: "x" } },
        { ...good, id: "culture-3", teaser: {} },
        { ...good, id: "culture-4", category: "not-a-category" },
        { ...good, id: "culture-5", contentType: "article" },
        { ...good, id: "culture-6", continent: "atlantis" },
        { ...good, id: "culture-7", countries: "DE" },
        { ...good, id: "culture-8", tags: "tag" },
        { ...good, id: "culture-9", readingMinutes: 0 },
        { ...good, id: "culture-10", weight: "heavy" },
        { ...good, id: "culture-11", hasExpression: "yes" },
        { ...good, id: "culture-1" },
        { ...good, id: "culture-12" },
      ],
    };
    setCultureDataSource(fixtureCultureSource(payload, new Map(), counters));
    const loaded = await loadCultureIndex();
    expect(loaded.status).toBe("ok");
    expect(loaded.entries.map((entry) => entry.id)).toEqual(["culture-1", "culture-12"]);
    expect(loaded.dropped).toBe(12);
  });

  it("accepts lowercase country codes but normalises them", async () => {
    const counters = makeFixtureCounters();
    const entry = makeCultureEntry("culture-1", { countries: ["de", "DE", "fr"] });
    setCultureDataSource(
      fixtureCultureSource({ version: 2, chunkSize: 10, entries: [entry] }, new Map(), counters),
    );
    const loaded = await loadCultureIndex();
    expect(loaded.entries[0]?.countries).toEqual(["DE", "FR"]);
  });

  it("refuses an index from another schema version without throwing", async () => {
    const counters = makeFixtureCounters();
    const { entries, payload, chunks } = catalog(4, 2);
    setCultureDataSource(
      fixtureCultureSource({ ...payload, version: 1, entries }, chunks, counters),
    );
    const loaded = await loadCultureIndex();
    expect(loaded.status).toBe("version-mismatch");
    expect(loaded.version).toBe(1);
    expect(loaded.entries).toEqual([]);
    expect(peekCultureIndex()).toBeNull();
    const detail = await loadCultureItems(["culture-1"]);
    expect(detail.status).toBe("version-mismatch");
    expect(detail.missing).toEqual(["culture-1"]);
    expect(counters.chunkLoads).toEqual([]);
  });

  it("turns a missing or throwing index into an unavailable status", async () => {
    const counters = makeFixtureCounters();
    setCultureDataSource(fixtureCultureSource(null, new Map(), counters, { indexThrows: true }));
    const loaded = await loadCultureIndex();
    expect(loaded.status).toBe("unavailable");
    expect(loaded.version).toBeNull();
    expect(loaded.entries).toEqual([]);
    expect(loaded.chunkSize).toBe(CULTURE_CHUNK_SIZE);
    expect(cultureIndexStatus()).toBe("unavailable");
    await loadCultureIndex();
    expect(counters.indexLoads).toBe(1);
  });

  it("turns malformed payloads into unavailable/empty statuses", async () => {
    const counters = makeFixtureCounters();
    const cases: { payload: unknown; status: string }[] = [
      { payload: null, status: "unavailable" },
      { payload: [], status: "unavailable" },
      { payload: { version: "2", entries: [] }, status: "unavailable" },
      { payload: { version: 2, entries: "nope" }, status: "unavailable" },
      { payload: { version: 2, entries: [] }, status: "empty" },
    ];
    for (const row of cases) {
      setCultureDataSource(fixtureCultureSource(row.payload, new Map(), counters));
      const loaded = await loadCultureIndex();
      expect(loaded.status).toBe(row.status);
    }
  });

  it("uses the declared chunk size and falls back to the default", async () => {
    const counters = makeFixtureCounters();
    const { entries, payload, chunks } = catalog(6, 3);
    setCultureDataSource(fixtureCultureSource(payload, chunks, counters));
    expect((await loadCultureIndex()).chunkSize).toBe(3);
    await loadCultureItem("culture-4");
    expect(counters.chunkLoads).toEqual([1]);

    resetCultureLoader();
    const barePayload = { version: 2, entries };
    setCultureDataSource(fixtureCultureSource(barePayload, chunks, counters));
    expect((await loadCultureIndex()).chunkSize).toBe(CULTURE_CHUNK_SIZE);
  });

  it("drops its caches when the source is replaced", async () => {
    const counters = makeFixtureCounters();
    const first = catalog(4, 2);
    setCultureDataSource(fixtureCultureSource(first.payload, first.chunks, counters));
    await loadCultureIndex();
    expect(peekCultureIndex()).not.toBeNull();
    const second = catalog(2, 2);
    setCultureDataSource(fixtureCultureSource(second.payload, second.chunks, counters));
    expect(peekCultureIndex()).toBeNull();
    const loaded = await loadCultureIndex();
    expect(loaded.entries.map((entry) => entry.id)).toEqual(["culture-1", "culture-2"]);
    expect(counters.indexLoads).toBe(2);
  });
});

describe("culture loader: article bodies", () => {
  it("loads a detail chunk only when an article in its window is requested", async () => {
    const counters = makeFixtureCounters();
    const { payload, chunks } = catalog(10, 2);
    setCultureDataSource(fixtureCultureSource(payload, chunks, counters));
    await loadCultureIndex();
    expect(counters.chunkLoads).toEqual([]);
    const first = await loadCultureItems(["culture-1", "culture-2"]);
    expect(first.status).toBe("ok");
    expect(first.items.map((item) => item.id)).toEqual(["culture-1", "culture-2"]);
    expect(counters.chunkLoads).toEqual([0]);
    await loadCultureItem("culture-2");
    expect(counters.chunkLoads).toEqual([0]);
    await loadCultureItem("culture-3");
    expect(counters.chunkLoads).toEqual([0, 1]);
  });

  it("shares one chunk request between concurrent article loads", async () => {
    const counters = makeFixtureCounters();
    const { payload, chunks } = catalog(10, 2);
    setCultureDataSource(fixtureCultureSource(payload, chunks, counters));
    const [first, second, third] = await Promise.all([
      loadCultureItem("culture-1"),
      loadCultureItem("culture-2"),
      loadCultureItem("culture-1"),
    ]);
    expect(counters.chunkLoads).toEqual([0]);
    expect(first?.id).toBe("culture-1");
    expect(second?.id).toBe("culture-2");
    expect(third?.id).toBe("culture-1");
  });

  it("keeps the detail-chunk cache bounded (LRU by use)", async () => {
    const counters = makeFixtureCounters();
    const { payload, chunks } = catalog(32, 2);
    setCultureDataSource(fixtureCultureSource(payload, chunks, counters));
    await loadCultureIndex();
    for (let window = 0; window < CULTURE_CHUNK_CACHE_LIMIT + 2; window += 1) {
      const id = "culture-" + String(window * 2 + 1);
      expect((await loadCultureItem(id))?.id).toBe(id);
    }
    expect(cultureLoaderCacheSize()).toBe(CULTURE_CHUNK_CACHE_LIMIT);
    expect(counters.chunkLoads).toHaveLength(CULTURE_CHUNK_CACHE_LIMIT + 2);
    const recent = (CULTURE_CHUNK_CACHE_LIMIT + 1) * 2 + 1;
    await loadCultureItem("culture-" + String(recent));
    expect(counters.chunkLoads).toHaveLength(CULTURE_CHUNK_CACHE_LIMIT + 2);
    await loadCultureItem("culture-1");
    expect(counters.chunkLoads).toHaveLength(CULTURE_CHUNK_CACHE_LIMIT + 3);
    expect(counters.chunkLoads.at(-1)).toBe(0);
  });

  it("returns what loaded and lists missing ids when one chunk fails", async () => {
    const counters = makeFixtureCounters();
    const { payload, chunks } = catalog(10, 2);
    setCultureDataSource(
      fixtureCultureSource(payload, chunks, counters, { chunkThrows: new Set([1]) }),
    );
    await loadCultureIndex();
    const result = await loadCultureItems(["culture-1", "culture-3", "culture-999", "culture-1"]);
    expect(result.status).toBe("partial");
    expect(result.items.map((item) => item.id)).toEqual(["culture-1"]);
    expect(result.missing).toEqual(["culture-3", "culture-999"]);
  });

  it("treats a chunk from another version as unavailable and never merges it", async () => {
    const counters = makeFixtureCounters();
    const { entries, payload, chunks } = catalog(4, 2);
    const fromOtherVersion = {
      version: 99,
      items: [makeCultureArticle(entries[0] as NonNullable<(typeof entries)[0]>)],
    };
    setCultureDataSource(fixtureCultureSource(payload, new Map([[0, fromOtherVersion]]), counters));
    await loadCultureIndex();
    const result = await loadCultureItems(["culture-1"]);
    expect(result.status).toBe("version-mismatch");
    expect(result.items).toEqual([]);
    expect(result.missing).toEqual(["culture-1"]);
  });

  it("filters invalid article bodies out of a chunk", async () => {
    const counters = makeFixtureCounters();
    const { entries, payload } = catalog(4, 2);
    const valid = makeCultureArticle(entries[0] as NonNullable<(typeof entries)[0]>);
    const invalidVersion = { ...valid, id: "culture-2", version: 7 };
    setCultureDataSource(
      fixtureCultureSource(
        payload,
        new Map([[0, { version: 2, items: [valid, invalidVersion] }]]),
        counters,
      ),
    );
    await loadCultureIndex();
    const result = await loadCultureItems(["culture-1", "culture-2"]);
    expect(result.status).toBe("partial");
    expect(result.items.map((item) => item.id)).toEqual(["culture-1"]);
    expect(result.missing).toEqual(["culture-2"]);
  });

  it("never serves an article from the wrong positional window", async () => {
    const counters = makeFixtureCounters();
    const { entries, payload } = catalog(6, 2);
    // The body for index position 4 (culture-5) is placed in window 0 by mistake.
    const misplaced = makeCultureArticle(entries[4] as NonNullable<(typeof entries)[0]>);
    setCultureDataSource(
      fixtureCultureSource(payload, new Map([[0, { version: 2, items: [misplaced] }]]), counters),
    );
    await loadCultureIndex();
    expect(await loadCultureItem("culture-1")).toBeNull();
    expect(await loadCultureItem("culture-5")).toBeNull();
  });

  it("reports ids that are not in the compact index without fetching a chunk", async () => {
    const counters = makeFixtureCounters();
    const { payload, chunks } = catalog(4, 2);
    setCultureDataSource(fixtureCultureSource(payload, chunks, counters));
    await loadCultureIndex();
    const result = await loadCultureItems(["nope-1", "nope-2"]);
    expect(result.status).toBe("not-found");
    expect(result.items).toEqual([]);
    expect(result.missing).toEqual(["nope-1", "nope-2"]);
    expect(counters.chunkLoads).toEqual([]);
  });

  it("keeps the caller order, deduplicates repeats and accepts an empty list", async () => {
    const counters = makeFixtureCounters();
    const { payload, chunks } = catalog(4, 2);
    setCultureDataSource(fixtureCultureSource(payload, chunks, counters));
    await loadCultureIndex();
    const result = await loadCultureItems(["culture-2", "culture-1", "culture-2"]);
    expect(result.items.map((item) => item.id)).toEqual(["culture-2", "culture-1"]);
    expect(await loadCultureItems([])).toEqual({ status: "ok", items: [], missing: [] });
  });

  it("returns an empty detail result when the index is unavailable", async () => {
    const counters = makeFixtureCounters();
    setCultureDataSource(fixtureCultureSource(null, new Map(), counters, { indexThrows: true }));
    const result = await loadCultureItems(["culture-1"]);
    expect(result.status).toBe("unavailable");
    expect(result.missing).toEqual(["culture-1"]);
  });

  it("returns not-found for an empty library", async () => {
    const counters = makeFixtureCounters();
    setCultureDataSource(
      fixtureCultureSource({ version: 2, chunkSize: 10, entries: [] }, new Map(), counters),
    );
    expect((await loadCultureIndex()).status).toBe("empty");
    const result = await loadCultureItems(["culture-1"]);
    expect(result.status).toBe("not-found");
    expect(result.missing).toEqual(["culture-1"]);
  });
});

describe("culture loader: published validators", () => {
  const entry = makeCultureEntry("culture-1", {
    countries: ["DE"],
    tags: ["coffee"],
    hasExpression: true,
  });

  it("accepts a valid compact row and rejects broken ones", () => {
    expect(parseCultureIndexEntry(entry)).toEqual(entry);
    expect(parseCultureIndexEntry(null)).toBeNull();
    expect(parseCultureIndexEntry({ ...entry, id: "has space" })).toBeNull();
    expect(parseCultureIndexEntry({ ...entry, title: { ar: "x", de: "y" } })).toBeNull();
    expect(parseCultureIndexEntry({ ...entry, weight: Number.NaN })).toBeNull();
    expect(parseCultureIndexEntry({ ...entry, readingMinutes: 1.5 })).toBeNull();
    expect(parseCultureIndexEntry({ ...entry, hasExpression: undefined })).toBeNull();
  });

  it("accepts a valid article body and preserves optional editorial blocks", () => {
    const article = makeCultureArticle(entry);
    expect(parseCultureArticle(article)).toEqual(article);
    const withExtras = {
      ...article,
      example: { ar: "مثال", de: "Beispiel", en: "Example" },
      misunderstanding: { ar: "خطأ", de: "Irrtum", en: "Misunderstanding" },
      comparison: { ar: "مقارنة", de: "Vergleich", en: "Comparison" },
    };
    const parsed = parseCultureArticle(withExtras);
    expect(parsed?.example?.en).toBe("Example");
    expect(parsed?.expression?.language).toBe("Arabic");
    expect(parsed?.misunderstanding?.de).toBe("Irrtum");
    expect(parsed?.comparison?.ar).toBe("مقارنة");
  });

  it("rejects article bodies that break the contract", () => {
    const article = makeCultureArticle(entry);
    expect(parseCultureArticle({ ...article, version: 1 })).toBeNull();
    expect(parseCultureArticle({ ...article, title: { ...article.title, de: "" } })).toBeNull();
    expect(parseCultureArticle({ ...article, sections: [] })).toBeNull();
    expect(
      parseCultureArticle({
        ...article,
        sections: [{ heading: article.sections.en[0]?.heading, paragraphs: [] }],
      }),
    ).toBeNull();
    expect(parseCultureArticle({ ...article, sources: [] })).toBeNull();
    expect(
      parseCultureArticle({
        ...article,
        sources: [{ ...article.sources[0], url: "http://example.org/a" }],
      }),
    ).toBeNull();
    expect(parseCultureArticle({ ...article, publishedAt: "not-a-date" })).toBeNull();
    expect(parseCultureArticle({ ...article, expression: { original: "x" } })).toBeNull();
    expect(
      parseCultureArticle({ ...article, status: { ...article.status, revision: -1 } }),
    ).toBeNull();
  });

  it("clamps the editorial weight into the documented range", () => {
    expect(parseCultureIndexEntry({ ...entry, weight: 4 })?.weight).toBe(1);
    expect(parseCultureIndexEntry({ ...entry, weight: -2 })?.weight).toBe(0);
  });

  it("is exercised by the default synthetic library", () => {
    const entries = syntheticCultureEntries(12);
    for (const row of entries) expect(parseCultureIndexEntry(row)).not.toBeNull();
    for (const row of entries) {
      expect(parseCultureArticle(makeCultureArticle(row))?.id).toBe(row.id);
    }
  });
});
