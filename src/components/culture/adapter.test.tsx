import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setCultureDataSource,
  resetCultureLoader,
  peekCultureIndex,
  type CultureDataSource,
} from "@/lib/culture/loader";
import {
  resetCultureSavedCache,
  saveCultureItem,
  subscribeCultureSaved,
} from "@/lib/culture/saved";
import { chunkedCatalog, makeEntry as engineEntry, syntheticIndex } from "@/lib/culture/testing";
import { createCultureDiscoveryAdapter } from "@/lib/culture/adapter";
import { CultureDiscovery } from "./CultureDiscovery";

/**
 * The production adapter is exercised against the engine's own test seam: a validated
 * synthetic catalog through the real loader/ranking/saved modules, then the same calls the
 * section makes. Nothing here is fabricated content: the catalog is explicitly synthetic
 * test data, and the UI assertions are about wiring and states.
 */

interface Fixture {
  source: CultureDataSource;
  entries: ReturnType<typeof syntheticIndex>;
}

function fixture(): Fixture {
  const entries = syntheticIndex(30);
  const { payload, chunks } = chunkedCatalog(entries, 5);
  const source: CultureDataSource = {
    loadIndex: async () => payload,
    loadChunk: async (window: number) => chunks.get(window) ?? [],
  };
  return { source, entries };
}

beforeEach(() => {
  localStorage.clear();
  resetCultureSavedCache();
  resetCultureLoader();
});

afterEach(() => {
  setCultureDataSource(null);
  resetCultureLoader();
  localStorage.clear();
  resetCultureSavedCache();
});

describe("production culture adapter", () => {
  it("pages the compact index with a stable cursor and no duplicates", async () => {
    const { source, entries } = fixture();
    setCultureDataSource(source);
    const adapter = createCultureDiscoveryAdapter({ dayKey: () => "2026-11-17" });

    const first = await adapter.loadPage({ limit: 6 });
    expect(first.items).toHaveLength(6);
    expect(first.total).toBe(entries.length);
    expect(first.nextCursor).toBe(first.items[5]?.id);

    const second = await adapter.loadPage({ limit: 6, cursor: first.nextCursor });
    expect(second.items).toHaveLength(6);
    const ids = new Set(first.items.map((entry) => entry.id));
    for (const item of second.items) {
      expect(ids.has(item.id)).toBe(false);
    }
  });

  it("filters by category and searches titles without leaving the cursor contract", async () => {
    const { source, entries } = fixture();
    setCultureDataSource(source);
    const adapter = createCultureDiscoveryAdapter({ dayKey: () => "2026-11-17" });
    const category = entries[3]?.category ?? "objects";

    const filtered = await adapter.loadPage({ limit: 50, category });
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.every((entry) => entry.category === category)).toBe(true);

    const searchTerm = entries[0]?.title.en ?? "Item";
    const searched = await adapter.loadPage({ limit: 50, search: searchTerm });
    expect(searched.items.length).toBeGreaterThan(0);
    expect(searched.items[0]?.title.en).toContain("Item");
  });

  it("derives facet counts from the loaded index", async () => {
    const { source, entries } = fixture();
    setCultureDataSource(source);
    const adapter = createCultureDiscoveryAdapter();
    const facets = await adapter.loadFacets();
    const totalCategories = facets.categories.reduce((sum, row) => sum + row.count, 0);
    expect(totalCategories).toBe(entries.length);
    expect(facets.continents.length).toBeGreaterThan(0);
    expect(facets.countries[0]?.count).toBeGreaterThanOrEqual(facets.countries.at(-1)?.count ?? 0);
  });

  it("features one record for the day and enriches it with its own original title", async () => {
    const { source } = fixture();
    setCultureDataSource(source);
    const adapter = createCultureDiscoveryAdapter({ dayKey: () => "2026-11-17" });
    const featured = await adapter.loadFeatured();
    expect(featured).not.toBeNull();
    expect(featured?.titleOriginal).toBe(featured?.title.en);

    const again = await createCultureDiscoveryAdapter({
      dayKey: () => "2026-11-17",
    }).loadFeatured();
    expect(again?.id).toBe(featured?.id);
  });

  it("loads a record body and returns null for an unknown id", async () => {
    const { source, entries } = fixture();
    setCultureDataSource(source);
    const adapter = createCultureDiscoveryAdapter();
    const body = await adapter.loadItem(entries[0]?.id ?? "");
    expect(body?.id).toBe(entries[0]?.id);
    expect(body?.summary.en.length).toBeGreaterThan(0);
    expect(await adapter.loadItem("missing-record")).toBeNull();
  });

  it("returns related records from genuine metadata, declared first and without self", async () => {
    const { source, entries } = fixture();
    setCultureDataSource(source);
    const adapter = createCultureDiscoveryAdapter();
    const target = entries[0];
    if (!target) throw new Error("fixture has no entries");
    const declared = [entries[1]?.id ?? ""];
    const related = await adapter.loadRelated(target.id, declared);
    expect(related.length).toBeGreaterThan(0);
    expect(related.length).toBeLessThanOrEqual(6);
    expect(related[0]?.id).toBe(declared[0]);
    expect(related.every((entry) => entry.id !== target.id)).toBe(true);

    const noDeclared = await adapter.loadRelated(target.id, []);
    expect(noDeclared.every((entry) => entry.id !== target.id)).toBe(true);
  });

  it("serves saved ids and cached entries from the device, and notifies subscribers", async () => {
    const { source, entries } = fixture();
    setCultureDataSource(source);
    const adapter = createCultureDiscoveryAdapter();
    await adapter.loadPage({ limit: 4 }); // the index must be loaded before entries can resolve

    expect(adapter.saved.ids()).toEqual([]);
    expect(adapter.saved.entries()).toEqual([]);

    const notifications: string[] = [];
    const unsubscribe = adapter.saved.subscribe(() => {
      notifications.push("changed");
    });
    const savedId = entries[0]?.id ?? "";
    await act(async () => {
      adapter.saved.toggle(savedId);
    });
    await waitFor(() => expect(notifications.length).toBeGreaterThan(0));
    expect(adapter.saved.ids()).toEqual([savedId]);
    expect(adapter.saved.entries().map((entry) => entry.id)).toEqual([savedId]);

    unsubscribe();
    await act(async () => {
      adapter.saved.toggle(savedId);
    });
    await waitFor(() => expect(adapter.saved.ids()).toEqual([]));
  });

  it("lets another part of the app notify the same subscriber", async () => {
    const { source, entries } = fixture();
    setCultureDataSource(source);
    const adapter = createCultureDiscoveryAdapter();
    await adapter.loadPage({ limit: 2 });
    let seen = 0;
    const unsubscribe = adapter.saved.subscribe(() => {
      seen += 1;
    });
    await act(async () => {
      await saveCultureItem(entries[1]?.id ?? "");
    });
    await waitFor(() => expect(seen).toBe(1));
    expect(adapter.saved.ids()).toEqual([entries[1]?.id]);
    unsubscribe();
  });

  it("rejects instead of pretending when the catalog is missing or incompatible", async () => {
    setCultureDataSource({
      loadIndex: async () => {
        throw new Error("missing");
      },
      loadChunk: async () => {
        throw new Error("missing");
      },
    });
    const adapter = createCultureDiscoveryAdapter();
    await expect(adapter.loadPage({ limit: 4 })).rejects.toThrow("culture-catalog-unavailable");

    resetCultureLoader();
    setCultureDataSource({
      loadIndex: async () => ({ version: 99, chunkSize: 5, entries: [] }),
      loadChunk: async () => [],
    });
    await expect(adapter.loadPage({ limit: 4 })).rejects.toThrow(
      "culture-catalog-version-mismatch",
    );
  });

  it("treats an empty catalog as an empty page, not an error", async () => {
    setCultureDataSource({
      loadIndex: async () => ({ version: 1, chunkSize: 5, entries: [] }),
      loadChunk: async () => [],
    });
    const adapter = createCultureDiscoveryAdapter();
    expect(await adapter.loadPage({ limit: 4 })).toEqual({ items: [], total: 0 });
    await expect(adapter.loadFeatured()).resolves.toBeNull();
  });

  it("honours an abort that arrived while the index was loading", async () => {
    const { source } = fixture();
    setCultureDataSource(source);
    const adapter = createCultureDiscoveryAdapter();
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.loadPage({ limit: 4 }, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("runs the section end to end on the engine: feed, feature and reading surface", async () => {
    const { source } = fixture();
    setCultureDataSource(source);
    const adapter = createCultureDiscoveryAdapter({ dayKey: () => "2026-11-17" });
    render(<CultureDiscovery adapter={adapter} locale="en" pageSize={6} />);

    await waitFor(() => {
      expect(document.querySelectorAll("article").length).toBeGreaterThanOrEqual(6);
    });
    // The feature is part of the page, labelled as such.
    expect(screen.getByText("Featured")).toBeInTheDocument();

    const openButtons = document.querySelectorAll<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    const first = openButtons[0];
    if (!first) throw new Error("no card to open");
    await act(async () => {
      first.click();
    });
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).getAllByText(/^Summary met-\d+$/).length).toBeGreaterThan(0);
    });
  });
});
