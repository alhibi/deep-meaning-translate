import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useCultureFeed,
  useCultureRecord,
  useDebouncedValue,
  useFacets,
  useFeatured,
  useIsOnline,
  useSavedCulture,
  AUTO_PAGE_LIMIT,
  MORE_COOLDOWN_MS,
  SEARCH_DEBOUNCE_MS,
} from "./useDiscovery";
import type { CultureListPage } from "./contract";
import {
  makeAdapter,
  makeEntry,
  makeFacets,
  makeItem,
  makePage,
  richItem,
  type FakeAdapter,
} from "./testFixtures";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const a = makeEntry({ id: "a", category: "objects" });
const b = makeEntry({ id: "b", category: "music" });
const c = makeEntry({ id: "c", category: "language" });
const d = makeEntry({ id: "d", category: "crafts" });
const e = makeEntry({ id: "e", category: "food-culture" });

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useCultureFeed", () => {
  it("starts with one small page and reports ready", async () => {
    const adapter = makeAdapter({ pages: [makePage([a, b], "next", 5)] });
    const { result } = renderHook(() => useCultureFeed(adapter, 2));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(adapter.calls.pages).toHaveLength(1);
    expect(adapter.calls.pages[0]?.limit).toBe(2);
    expect(result.current.total).toBe(5);
    expect(result.current.canLoadMore).toBe(true);
  });

  it("never lets two page reads run at once", async () => {
    let calls = 0;
    const adapter: FakeAdapter = makeAdapter({ pages: [makePage([a], "c1")] });
    const pending: CultureListPage = makePage([b], "c2");
    adapter.loadPage = () => {
      calls += 1;
      if (calls === 1) return Promise.resolve(makePage([a], "c1"));
      return new Promise<CultureListPage>(() => {
        // Intentionally never resolves inside this test: the guard is the assertion.
        void pending;
      });
    };
    const { result } = renderHook(() => useCultureFeed(adapter, 2));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => {
      result.current.loadMore(false);
      result.current.loadMore(false);
      result.current.loadMore(true);
    });
    expect(calls).toBe(2);
  });

  it("cooldown and the automatic-page cap stop an endless scroll, the button still works", async () => {
    vi.useFakeTimers();
    const adapter = makeAdapter({
      pages: [makePage([a], "c1"), makePage([b], "c2"), makePage([c], "c3"), makePage([d])],
    });
    const { result } = renderHook(() => useCultureFeed(adapter, 1));
    await flush();
    expect(adapter.calls.pages).toHaveLength(1);

    act(() => result.current.loadMore(true));
    await flush();
    expect(adapter.calls.pages).toHaveLength(2);

    // Immediately after a page settles, an automatic nudge must not fire.
    act(() => result.current.loadMore(true));
    await flush();
    expect(adapter.calls.pages).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MORE_COOLDOWN_MS + 1);
    });
    act(() => result.current.loadMore(true));
    await flush();
    expect(adapter.calls.pages).toHaveLength(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MORE_COOLDOWN_MS + 1);
    });
    act(() => result.current.loadMore(true));
    await flush();
    // The automatic cap is reached; scrolling alone cannot go further.
    expect(adapter.calls.pages).toHaveLength(3);
    expect(AUTO_PAGE_LIMIT).toBe(2);

    // The explicit control is always allowed.
    act(() => result.current.loadMore(false));
    await flush();
    expect(adapter.calls.pages).toHaveLength(4);
    expect(result.current.entries).toHaveLength(4);
    expect(result.current.canLoadMore).toBe(false);
  });

  it("stops instead of looping when the adapter repeats a cursor", async () => {
    const adapter = makeAdapter({
      pages: [makePage([a], "same"), makePage([b], "same")],
    });
    const { result } = renderHook(() => useCultureFeed(adapter, 1));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.loadMore(false));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.canLoadMore).toBe(false);
    act(() => result.current.loadMore(false));
    expect(adapter.calls.pages).toHaveLength(2);
  });

  it("de-duplicates entries when pages overlap", async () => {
    const adapter = makeAdapter({
      pages: [makePage([a, b], "c1"), makePage([b, c])],
    });
    const { result } = renderHook(() => useCultureFeed(adapter, 2));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.loadMore(false));
    await waitFor(() => expect(result.current.entries).toHaveLength(3));
    expect(result.current.entries.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("debounces search before it becomes a page query", async () => {
    vi.useFakeTimers();
    const adapter = makeAdapter({ pages: [makePage([a], "c1"), makePage([b])] });
    const { result } = renderHook(() => useCultureFeed(adapter, 1));
    await flush();
    expect(adapter.calls.pages).toHaveLength(1);

    act(() => result.current.setSearch("m"));
    act(() => result.current.setSearch("mu"));
    act(() => result.current.setSearch("mus"));
    expect(result.current.searchPending).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(adapter.calls.pages).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await flush();
    expect(adapter.calls.pages).toHaveLength(2);
    expect(adapter.calls.pages[1]?.search).toBe("mus");
    expect(result.current.searchPending).toBe(false);
  });

  it("restarts from the first cursor when a filter changes", async () => {
    const adapter = makeAdapter({
      pages: [makePage([a], "c1"), makePage([b], "c2"), makePage([c])],
    });
    const { result } = renderHook(() => useCultureFeed(adapter, 1));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.loadMore(false));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.setCategory("music"));
    await waitFor(() => expect(adapter.calls.pages).toHaveLength(3));
    expect(adapter.calls.pages[2]?.category).toBe("music");
    expect(adapter.calls.pages[2]?.cursor).toBeUndefined();
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
  });

  it("clears filters and search together", async () => {
    const adapter = makeAdapter({ pages: [makePage([a])] });
    const { result } = renderHook(() => useCultureFeed(adapter, 1));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => {
      result.current.setCategory("music");
      result.current.setContinent("asia");
      result.current.setCountry("JP");
      result.current.setSearch("x");
    });
    expect(result.current.activeFilters).toBe(true);
    act(() => result.current.clearFilters());
    expect(result.current.category).toBeUndefined();
    expect(result.current.continent).toBeUndefined();
    expect(result.current.country).toBeUndefined();
    expect(result.current.search).toBe("");
    expect(result.current.activeFilters).toBe(false);
  });

  it("reports an offline failure differently from a generic one", async () => {
    const adapter = makeAdapter({ pageError: "offline", online: false });
    const { result } = renderHook(() => useCultureFeed(adapter, 1));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("offline");

    adapter.setPageError("failed");
    adapter.setOnline(true);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBe("failed"));
  });

  it("retries the failed page without dropping the loaded cards", async () => {
    const adapter = makeAdapter({ pages: [makePage([a], "c1"), makePage([b])] });
    const { result } = renderHook(() => useCultureFeed(adapter, 1));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    adapter.setPageError("failed");
    act(() => result.current.loadMore(false));
    await waitFor(() => expect(result.current.moreError).toBe("failed"));
    expect(result.current.entries).toHaveLength(1);

    adapter.setPageError(null);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.moreError).toBeNull();
  });
});

describe("useDebouncedValue", () => {
  it("only changes after the quiet window", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 100),
      { initialProps: { value: "a" } },
    );
    expect(result.current).toBe("a");
    rerender({ value: "ab" });
    expect(result.current).toBe("a");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(101);
    });
    expect(result.current).toBe("ab");
  });
});

describe("useIsOnline", () => {
  it("follows the adapter probe and the browser events", async () => {
    const adapter = makeAdapter({ online: false });
    const { result } = renderHook(() => useIsOnline(adapter));
    await waitFor(() => expect(result.current).toBe(false));
    adapter.setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(result.current).toBe(true));
    adapter.setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await waitFor(() => expect(result.current).toBe(false));
  });
});

describe("useSavedCulture", () => {
  it("reads the device saved set, keeps a stable snapshot and toggles", async () => {
    const adapter = makeAdapter({ saved: { ids: [a.id], entries: [a] } });
    const { result } = renderHook(() => useSavedCulture(adapter.saved));
    expect([...result.current.ids]).toEqual([a.id]);
    expect(result.current.entries.map((entry) => entry.id)).toEqual([a.id]);
    expect(result.current.isSaved(a.id)).toBe(true);
    expect(result.current.isSaved(b.id)).toBe(false);

    act(() => result.current.toggle(b.id));
    await waitFor(() => expect(result.current.isSaved(b.id)).toBe(true));
    expect(adapter.calls.savedToggles).toEqual([b.id]);
    act(() => result.current.toggle(a.id));
    await waitFor(() => expect(result.current.isSaved(a.id)).toBe(false));
    // The fixture port only lists records it had cached, and b was never in its cache.
    expect(result.current.entries).toHaveLength(0);
  });

  it("keeps a stable array identity while the saved content is unchanged", () => {
    const adapter = makeAdapter({ saved: { ids: [a.id], entries: [a] } });
    const { result, rerender } = renderHook(() => useSavedCulture(adapter.saved));
    const first = result.current.ids;
    rerender();
    expect(result.current.ids).toBe(first);
  });
});

describe("useFacets", () => {
  it("returns filter options, and degrades to null when the read fails", async () => {
    const facets = makeFacets(["music"], ["asia"], ["JP"]);
    const adapter = makeAdapter({ facets });
    const { result } = renderHook(() => useFacets(adapter));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.categories[0]?.value).toBe("music");

    const failing = makeAdapter({ facets: null });
    const failingRender = renderHook(() => useFacets(failing));
    await waitFor(() => expect(failing.calls.facets).toBe(1));
    expect(failingRender.result.current).toBeNull();
  });
});

describe("useFeatured", () => {
  it("loads one feature, and stays quiet when there is none", async () => {
    const featured = makeEntry({ id: "featured", category: "architecture" });
    const adapter = makeAdapter({ featured });
    const { result } = renderHook(() => useFeatured(adapter));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.item?.id).toBe("featured");

    const empty = renderHook(() => useFeatured(makeAdapter({ featured: null })));
    await waitFor(() => expect(empty.result.current.status).toBe("ready"));
    expect(empty.result.current.item).toBeNull();
  });

  it("does not throw when the feature read fails", async () => {
    const adapter = makeAdapter();
    adapter.loadFeatured = () => Promise.reject(new Error("nope"));
    const { result } = renderHook(() => useFeatured(adapter));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.item).toBeNull();
  });
});

describe("useCultureRecord", () => {
  it("loads one record and its genuine related records", async () => {
    const item = richItem();
    const related = makeEntry({ id: "related-1", category: "crafts" });
    const adapter = makeAdapter({
      items: { [item.id]: item },
      related: [related],
    });
    const { result } = renderHook(() => useCultureRecord(adapter, item.id, true));
    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    if (result.current.state.status !== "ready") throw new Error("unreachable");
    expect(result.current.state.item.id).toBe(item.id);
    await waitFor(() => {
      expect(
        result.current.state.status === "ready" ? result.current.state.related.length : 0,
      ).toBe(1);
    });
    expect(adapter.calls.related[0]).toEqual({ itemId: item.id, declared: ["related-1"] });
  });

  it("keeps the record readable when related items fail", async () => {
    const item = richItem();
    const adapter = makeAdapter({ items: { [item.id]: item } });
    adapter.loadRelated = () => Promise.reject(new Error("no related"));
    const { result } = renderHook(() => useCultureRecord(adapter, item.id, true));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    if (result.current.state.status !== "ready") throw new Error("unreachable");
    expect(result.current.state.related).toEqual([]);
  });

  it("reports a missing record as an error and retries into a fresh read", async () => {
    const adapter = makeAdapter({ items: { other: makeItem({ id: "other" }) } });
    const { result } = renderHook(() => useCultureRecord(adapter, "missing", false));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status !== "error") throw new Error("unreachable");
    // A record that is not in the catalog is not a connectivity problem.
    expect(result.current.state.offline).toBe(false);

    adapter.setItemError(false);
    act(() => result.current.retry());
    await waitFor(() => expect(adapter.calls.items).toHaveLength(2));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });

  it("marks a network failure with the current connectivity", async () => {
    const adapter = makeAdapter({ itemError: true });
    const { result } = renderHook(() => useCultureRecord(adapter, "a", true));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status !== "error") throw new Error("unreachable");
    expect(result.current.state.offline).toBe(false);
  });
});
