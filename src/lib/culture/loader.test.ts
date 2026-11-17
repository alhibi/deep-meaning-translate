import { beforeEach, describe, expect, it } from "vitest";
import {
  CULTURE_CHUNK_CACHE_LIMIT,
  CULTURE_CHUNK_SIZE,
  cultureChunkWindow,
  loadCultureIndex,
  loadCultureItem,
  loadCultureItems,
  peekCultureIndex,
  resetCultureLoader,
  setCultureDataSource,
  type CultureDataSource,
} from "./loader";
import { chunkedCatalog, makeEntry, makeItem } from "./testing";

interface Counters {
  indexLoads: number;
  chunkLoads: number[];
}

function fixtureSource(
  payload: unknown,
  chunks: Map<number, unknown>,
  counters: Counters,
  options: { indexThrows?: boolean; chunkThrows?: Set<number> } = {},
): CultureDataSource {
  return {
    async loadIndex() {
      counters.indexLoads += 1;
      if (options.indexThrows) throw new Error("index missing");
      return payload;
    },
    async loadChunk(window: number) {
      counters.chunkLoads.push(window);
      if (options.chunkThrows?.has(window)) throw new Error(`chunk ${String(window)} missing`);
      return chunks.get(window) ?? [];
    },
  };
}

function catalog(count: number, chunkSize: number) {
  const entries = Array.from({ length: count }, (_, i) => makeEntry(`met-${String(i + 1)}`));
  const { payload, chunks } = chunkedCatalog(entries, chunkSize);
  return { entries, payload, chunks };
}

beforeEach(() => {
  setCultureDataSource(null);
  resetCultureLoader();
});

describe("culture loader", () => {
  it("imports nothing until a screen asks for the catalog", () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { payload, chunks } = catalog(5, 2);
    setCultureDataSource(fixtureSource(payload, chunks, counters));
    expect(peekCultureIndex()).toBeNull();
    expect(counters.indexLoads).toBe(0);
  });

  it("loads the compact index once, even for concurrent callers", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { entries, payload, chunks } = catalog(5, 2);
    setCultureDataSource(fixtureSource(payload, chunks, counters));
    const [a, b, c] = await Promise.all([
      loadCultureIndex(),
      loadCultureIndex(),
      loadCultureIndex(),
    ]);
    expect(counters.indexLoads).toBe(1);
    expect(a.status).toBe("ok");
    expect(a.entries).toHaveLength(5);
    expect(b.entries.map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id));
    expect(c).toBe(a);
    expect(peekCultureIndex()).toBe(a.entries);
    expect(cultureChunkWindow("met-3")).toBe(1);
    expect(cultureChunkWindow("met-999")).toBeNull();
  });

  it("validates rows, drops unusable ones and reports the count", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const good = makeEntry("met-1");
    const payload = {
      version: 1,
      chunkSize: 10,
      entries: [
        good,
        { ...good, id: "" },
        { ...good, id: "met-2", title: { ar: "", de: "x", en: "x" } },
        { ...good, id: "met-3", category: "not-a-category" },
        { ...good, id: "met-1" },
        { ...good, id: "met-4" },
      ],
    };
    setCultureDataSource(fixtureSource(payload, new Map(), counters));
    const loaded = await loadCultureIndex();
    expect(loaded.status).toBe("ok");
    expect(loaded.entries.map((entry) => entry.id)).toEqual(["met-1", "met-4"]);
    expect(loaded.dropped).toBe(4);
  });

  it("refuses an index from another schema version without throwing", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { entries, payload, chunks } = catalog(4, 2);
    setCultureDataSource(fixtureSource({ ...payload, version: 2, entries }, chunks, counters));
    const loaded = await loadCultureIndex();
    expect(loaded.status).toBe("version-mismatch");
    expect(loaded.version).toBe(2);
    expect(loaded.entries).toEqual([]);
    const detail = await loadCultureItems(["met-1"]);
    expect(detail.status).toBe("version-mismatch");
    expect(detail.missing).toEqual(["met-1"]);
    expect(counters.chunkLoads).toEqual([]);
  });

  it("turns a missing or throwing index into an unavailable status", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    setCultureDataSource(fixtureSource(null, new Map(), counters, { indexThrows: true }));
    const loaded = await loadCultureIndex();
    expect(loaded.status).toBe("unavailable");
    expect(loaded.entries).toEqual([]);
    await loadCultureIndex();
    expect(counters.indexLoads).toBe(1);
  });

  it("preserves the optional feed media block and refuses media without rights", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const media = {
      url: "https://images.metmuseum.org/a.jpg",
      thumbnailUrl: "https://images.metmuseum.org/a-thumb.jpg",
      license: "CC0-1.0",
      credit: "Test Museum",
      width: 1200,
      height: 800,
    };
    const withMedia = makeEntry("met-1", { media });
    const withoutRights = {
      ...makeEntry("met-2"),
      media: { url: "https://not-allowed.example/a.jpg", license: "CC0-1.0", credit: "Test" },
    };
    setCultureDataSource(
      fixtureSource(
        { version: 1, chunkSize: 10, entries: [withMedia, withoutRights] },
        new Map(),
        counters,
      ),
    );
    const loaded = await loadCultureIndex();
    expect(loaded.entries[0]?.media).toEqual(media);
    expect(loaded.entries[1]?.media).toBeUndefined();
    expect(loaded.entries[1]?.id).toBe("met-2");
  });

  it("turns an empty index into an explicit empty status", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    setCultureDataSource(
      fixtureSource({ version: 1, chunkSize: 10, entries: [] }, new Map(), counters),
    );
    expect((await loadCultureIndex()).status).toBe("empty");
  });

  it("loads a detail chunk only when an item in its window is requested", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { payload, chunks } = catalog(10, 2);
    setCultureDataSource(fixtureSource(payload, chunks, counters));
    await loadCultureIndex();
    expect(counters.chunkLoads).toEqual([]);
    const first = await loadCultureItems(["met-1", "met-2"]);
    expect(first.status).toBe("ok");
    expect(first.items.map((item) => item.id)).toEqual(["met-1", "met-2"]);
    expect(counters.chunkLoads).toEqual([0]);
    await loadCultureItem("met-2");
    expect(counters.chunkLoads).toEqual([0]);
    await loadCultureItem("met-3");
    expect(counters.chunkLoads).toEqual([0, 1]);
  });

  it("shares one chunk request between concurrent item loads", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { payload, chunks } = catalog(10, 2);
    setCultureDataSource(fixtureSource(payload, chunks, counters));
    const [a, b, c] = await Promise.all([
      loadCultureItem("met-1"),
      loadCultureItem("met-2"),
      loadCultureItem("met-1"),
    ]);
    expect(counters.chunkLoads).toEqual([0]);
    expect(a?.id).toBe("met-1");
    expect(b?.id).toBe("met-2");
    expect(c?.id).toBe("met-1");
  });

  it("keeps the detail-chunk cache bounded (LRU by use)", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { payload, chunks } = catalog(24, 2); // 12 windows
    setCultureDataSource(fixtureSource(payload, chunks, counters));
    await loadCultureIndex();
    for (let window = 0; window < CULTURE_CHUNK_CACHE_LIMIT + 2; window += 1) {
      const id = `met-${String(window * 2 + 1)}`;
      expect((await loadCultureItem(id))?.id).toBe(id);
    }
    const loadsBefore = counters.chunkLoads.length;
    expect(loadsBefore).toBe(CULTURE_CHUNK_CACHE_LIMIT + 2);
    // The most recent windows are still cached.
    await loadCultureItem(`met-${String((CULTURE_CHUNK_CACHE_LIMIT + 1) * 2 + 1)}`);
    expect(counters.chunkLoads.length).toBe(loadsBefore);
    // The first window was evicted, so it is fetched again.
    await loadCultureItem("met-1");
    expect(counters.chunkLoads.length).toBe(loadsBefore + 1);
    expect(counters.chunkLoads.at(-1)).toBe(0);
  });

  it("returns what loaded and lists the missing ids when one chunk fails", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { payload, chunks } = catalog(10, 2);
    setCultureDataSource(fixtureSource(payload, chunks, counters, { chunkThrows: new Set([1]) }));
    await loadCultureIndex();
    const result = await loadCultureItems(["met-1", "met-3", "met-999", "met-1"]);
    expect(result.status).toBe("partial");
    expect(result.items.map((item) => item.id)).toEqual(["met-1"]);
    expect(result.missing).toEqual(["met-3", "met-999"]);
  });

  it("treats a chunk from another version as unavailable and never merges it", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { payload, chunks } = catalog(4, 2);
    const fromOtherVersion = { version: 99, items: chunks.get(0) };
    setCultureDataSource(fixtureSource(payload, new Map([[0, fromOtherVersion]]), counters));
    await loadCultureIndex();
    const result = await loadCultureItems(["met-1"]);
    expect(result.status).toBe("version-mismatch");
    expect(result.items).toEqual([]);
    expect(result.missing).toEqual(["met-1"]);
  });

  it("filters invalid item bodies out of a chunk", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { payload, chunks } = catalog(4, 2);
    const valid = (chunks.get(0) as unknown[])[0];
    const invalid = { ...(valid as object), version: 7 };
    setCultureDataSource(fixtureSource(payload, new Map([[0, [valid, invalid]]]), counters));
    await loadCultureIndex();
    const result = await loadCultureItems(["met-1", "met-2"]);
    expect(result.status).toBe("partial");
    expect(result.items.map((item) => item.id)).toEqual(["met-1"]);
    expect(result.missing).toEqual(["met-2"]);
  });

  it("reports ids that are not in the compact index without fetching a chunk", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { payload, chunks } = catalog(4, 2);
    setCultureDataSource(fixtureSource(payload, chunks, counters));
    await loadCultureIndex();
    const result = await loadCultureItems(["met-999", "met-1000"]);
    expect(result.status).toBe("not-found");
    expect(result.items).toEqual([]);
    expect(result.missing).toEqual(["met-999", "met-1000"]);
    expect(counters.chunkLoads).toEqual([]);
  });

  it("preserves the optional editorial whyDistinctive block when the corpus states it", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { entries, payload } = catalog(2, 2);
    const bodies = entries.map((entry) => makeItem(entry));
    const stated = {
      ...bodies[0],
      whyDistinctive: { ar: "لماذا", de: "Warum", en: "Why it matters" },
    };
    const malformed = { ...bodies[1], whyDistinctive: { ar: "x", de: 1, en: "y" } };
    setCultureDataSource(
      fixtureSource(payload, new Map([[0, { version: 1, items: [stated, malformed] }]]), counters),
    );
    await loadCultureIndex();
    const loaded = await loadCultureItems([entries[0]?.id ?? "", entries[1]?.id ?? ""]);
    expect((loaded.items[0] as unknown as { whyDistinctive?: unknown }).whyDistinctive).toEqual({
      ar: "لماذا",
      de: "Warum",
      en: "Why it matters",
    });
    expect(
      (loaded.items[1] as unknown as { whyDistinctive?: unknown }).whyDistinctive,
    ).toBeUndefined();
  });

  it("keeps the caller's order and deduplicates repeated ids", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { payload, chunks } = catalog(4, 2);
    setCultureDataSource(fixtureSource(payload, chunks, counters));
    await loadCultureIndex();
    const result = await loadCultureItems(["met-2", "met-1", "met-2"]);
    expect(result.items.map((item) => item.id)).toEqual(["met-2", "met-1"]);
    expect((await loadCultureItems([])).status).toBe("ok");
  });

  it("returns an empty detail result before any index exists", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { payload, chunks } = catalog(4, 2);
    setCultureDataSource(fixtureSource(payload, chunks, counters, { indexThrows: true }));
    const result = await loadCultureItems(["met-1"]);
    expect(result.status).toBe("unavailable");
    expect(result.missing).toEqual(["met-1"]);
  });

  it("uses the declared chunk size and falls back to the default", async () => {
    expect(CULTURE_CHUNK_SIZE).toBe(100);
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const { entries, payload, chunks } = catalog(6, 3);
    setCultureDataSource(fixtureSource(payload, chunks, counters));
    const loaded = await loadCultureIndex();
    expect(loaded.chunkSize).toBe(3);
    await loadCultureItem("met-4");
    expect(counters.chunkLoads).toEqual([1]);
    resetCultureLoader();
    // A payload without a declared size keeps the default (and stays index-ordered).
    const { payload: bare, chunks: bareChunks } = chunkedCatalog(entries, 100);
    setCultureDataSource(
      fixtureSource({ version: 1, entries: bare.entries }, bareChunks, counters),
    );
    expect((await loadCultureIndex()).chunkSize).toBe(CULTURE_CHUNK_SIZE);
  });

  it("drops its caches when the source is replaced", async () => {
    const counters: Counters = { indexLoads: 0, chunkLoads: [] };
    const first = catalog(4, 2);
    setCultureDataSource(fixtureSource(first.payload, first.chunks, counters));
    await loadCultureIndex();
    expect(peekCultureIndex()).not.toBeNull();
    const second = catalog(2, 2);
    setCultureDataSource(fixtureSource(second.payload, second.chunks, counters));
    expect(peekCultureIndex()).toBeNull();
    const loaded = await loadCultureIndex();
    expect(loaded.entries.map((entry) => entry.id)).toEqual(["met-1", "met-2"]);
    expect(counters.indexLoads).toBe(2);
  });
});
