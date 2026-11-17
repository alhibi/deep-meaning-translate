import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CultureListPage } from "@/lib/culture/adapter";
import { CultureDiscovery } from "./CultureDiscovery";
import { COPY } from "./copy";
import { MAX_PAGES, MORE_COOLDOWN_MS } from "./useDiscovery";
import { createFakeAdapter, makeArticle, makeEntry, text } from "./testFixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const section = () => screen.getByRole("region", { hidden: true });

afterEach(() => {
  document.body.style.overflow = "";
});

describe("the library section", () => {
  it("shows a quiet loading state, then the mixed feed", async () => {
    const pending = deferred<CultureListPage>();
    const fake = createFakeAdapter({
      loadPage: () => pending.promise,
      loadFeatured: async () => null,
    });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    const root = document.querySelector<HTMLElement>("[data-culture-section]");
    expect(root?.dataset["state"]).toBe("loading");
    expect(screen.getByText(COPY.en.loading)).toBeInTheDocument();
    pending.resolve({
      items: [makeEntry({ id: "n1" })],
      total: 1,
    });
    const card = await screen.findByText("A quiet habit");
    expect(card).toBeInTheDocument();
    expect(document.querySelector<HTMLElement>("[data-culture-section]")?.dataset["state"]).toBe(
      "ready",
    );
  });

  it("shows empty, error, offline and catalogue-unavailable states with a way back", async () => {
    // empty
    const empty = createFakeAdapter({
      loadPage: async () => ({ items: [], total: 0 }),
      loadFeatured: async () => null,
    });
    const emptyView = render(<CultureDiscovery adapter={empty.adapter} locale="en" />);
    expect(await screen.findByText(COPY.en.empty)).toBeInTheDocument();
    emptyView.unmount();

    // error, with a retry that succeeds
    const retryPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ items: [makeEntry({ id: "n2" })], total: 1 });
    const failed = createFakeAdapter({ loadPage: retryPage, loadFeatured: async () => null });
    const errorView = render(<CultureDiscovery adapter={failed.adapter} locale="en" />);
    expect(await screen.findByText(COPY.en.errorTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: COPY.en.retry }));
    expect(await screen.findByText("A quiet habit")).toBeInTheDocument();
    errorView.unmount();

    // offline
    const offline = createFakeAdapter({
      loadPage: async () => {
        throw new Error("network");
      },
      online: false,
      loadFeatured: async () => null,
    });
    const offlineView = render(<CultureDiscovery adapter={offline.adapter} locale="en" />);
    expect(await screen.findByText(COPY.en.offlineTitle)).toBeInTheDocument();
    offlineView.unmount();

    // unavailable catalogue
    const catalog = createFakeAdapter({
      loadPage: async () => {
        throw new Error("culture-catalog-unavailable");
      },
      loadFeatured: async () => null,
    });
    render(<CultureDiscovery adapter={catalog.adapter} locale="en" />);
    expect(await screen.findByText(COPY.en.catalogTitle)).toBeInTheDocument();
  });

  it("features one daily reading and never renders a duplicate card", async () => {
    const feature = makeEntry({ id: "featured-1", contentType: "feature" });
    const note = makeEntry({ id: "note-1", contentType: "note", title: text("A second note") });
    const fake = createFakeAdapter({
      entries: [feature, note],
      loadFeatured: async () => feature,
    });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    await screen.findByText(COPY.en.featuredLabel);
    await screen.findByText("A second note");
    const ids = [...document.querySelectorAll<HTMLElement>("[data-entry-id]")].map(
      (card) => card.dataset["entryId"],
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "featured-1")).toHaveLength(1);
  });

  it("debounces search and sends one page request after the person stops typing", async () => {
    const fake = createFakeAdapter({ loadFeatured: async () => null });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    await screen.findByText("A note on greetings");
    expect(fake.loadPage).toHaveBeenCalledTimes(1);
    const search = screen.getByRole("searchbox", { name: COPY.en.searchLabel });
    fireEvent.change(search, { target: { value: "g" } });
    fireEvent.change(search, { target: { value: "gr" } });
    fireEvent.change(search, { target: { value: "greeting" } });
    expect(fake.loadPage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fake.loadPage).toHaveBeenCalledTimes(2), { timeout: 2000 });
    const lastQuery = fake.loadPage.mock.calls[1]?.[0] as { search?: string };
    expect(lastQuery.search).toBe("greeting");
  });

  it("applies the language filter through the same debounced request", async () => {
    const fake = createFakeAdapter({ loadFeatured: async () => null });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    await screen.findByText("A note on greetings");
    fireEvent.change(screen.getByRole("combobox", { name: COPY.en.filterLanguage }), {
      target: { value: "ar" },
    });
    await waitFor(() => expect(fake.loadPage).toHaveBeenCalledTimes(2), { timeout: 2000 });
    const lastQuery = fake.loadPage.mock.calls[1]?.[0] as { language?: string };
    expect(lastQuery.language).toBe("ar");
  });

  it("guards progressive loading: one page in flight, no duplicate pieces, cursor paging", async () => {
    const a = makeEntry({ id: "a", contentType: "note", title: text("Piece A") });
    const b = makeEntry({ id: "b", contentType: "note", title: text("Piece B") });
    const c = makeEntry({ id: "c", contentType: "note", title: text("Piece C") });
    const second = deferred<CultureListPage>();
    let calls = 0;
    const fake = createFakeAdapter({
      loadPage: async (query) => {
        calls += 1;
        if (!query.cursor) return { items: [a, b], total: 3, nextCursor: "c1" };
        return second.promise;
      },
      loadFeatured: async () => null,
    });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    await screen.findByText("Piece A");
    expect(calls).toBe(1);
    const more = screen.getByRole("button", { name: new RegExp(COPY.en.more, "i") });
    // The first page arms a short cooldown; it is not a request storm, it is a reading pause.
    await waitFor(() => expect(more).not.toBeDisabled(), { timeout: 2000 });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(calls).toBe(2);
    second.resolve({ items: [b, c], total: 3 });
    await screen.findByText("Piece C");
    const ids = [...document.querySelectorAll<HTMLElement>("[data-entry-id]")].map(
      (card) => card.dataset["entryId"],
    );
    expect(ids.filter((id) => id === "b")).toHaveLength(1);
    expect(ids).toEqual(["a", "b", "c"]);
    // The cursor is gone, so the feed states its end instead of looping.
    await screen.findByText(COPY.en.endOfFeed);
  });

  it("enforces the page cooldown before accepting another explicit load", async () => {
    const a = makeEntry({ id: "a", contentType: "note", title: text("Piece A") });
    const b = makeEntry({ id: "b", contentType: "note", title: text("Piece B") });
    const second = deferred<CultureListPage>();
    let calls = 0;
    const fake = createFakeAdapter({
      loadPage: async (query) => {
        calls += 1;
        if (!query.cursor) return { items: [a], total: 2, nextCursor: "c1" };
        return second.promise;
      },
      loadFeatured: async () => null,
    });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    await screen.findByText("Piece A");
    const firstMore = screen.getByRole("button", { name: new RegExp(COPY.en.more, "i") });
    await waitFor(() => expect(firstMore).not.toBeDisabled(), { timeout: 2000 });
    fireEvent.click(firstMore);
    expect(calls).toBe(2);
    second.resolve({ items: [b], total: 2, nextCursor: "c2" });
    await screen.findByText("Piece B");
    const moreButton = screen.getByRole("button", { name: new RegExp(COPY.en.more, "i") });
    expect(moreButton).toBeDisabled();
    await waitFor(() => expect(moreButton).not.toBeDisabled(), { timeout: 2000 });
    fireEvent.click(moreButton);
    await waitFor(() => expect(calls).toBe(3), { timeout: 2000 });
  });

  it("opens a saved shelf that is local, immediate and filterable", async () => {
    const a = makeEntry({ id: "saved-1", contentType: "note", title: text("Kept piece") });
    const b = makeEntry({ id: "other-1", contentType: "note", title: text("Other piece") });
    const fake = createFakeAdapter({
      entries: [a, b],
      loadFeatured: async () => null,
    });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    await screen.findByText("Kept piece");
    fireEvent.click(
      screen.getByRole("button", { name: COPY.en.saveAria.replace("{title}", "Kept piece") }),
    );
    expect(fake.savedToggle).toHaveBeenCalledWith("saved-1");
    expect(
      screen.getByRole("button", { name: COPY.en.savedAria.replace("{title}", "Kept piece") }),
    ).toBeInTheDocument();
    const savedTab = document.querySelector<HTMLButtonElement>('[data-culture-view="saved"]');
    expect(savedTab).toBeTruthy();
    fireEvent.click(savedTab as HTMLButtonElement);
    await waitFor(() =>
      expect(screen.getAllByText(COPY.en.savedOnDevice).length).toBeGreaterThan(0),
    );
    expect(screen.getByText("Kept piece")).toBeInTheDocument();
    expect(screen.queryByText("Other piece")).toBeNull();
    expect(fake.loadPage).toHaveBeenCalledTimes(1);
  });

  it("shows the saved shelf's own empty state", async () => {
    const fake = createFakeAdapter({ loadFeatured: async () => null });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    await screen.findByText("A note on greetings");
    fireEvent.click(screen.getByRole("button", { name: "Kept" }));
    expect(screen.getByText(COPY.en.savedEmpty)).toBeInTheDocument();
  });

  it("offers another discovery that opens a written piece", async () => {
    const feature = makeEntry({ id: "featured-1", contentType: "feature" });
    const note = makeEntry({ id: "note-1", contentType: "note", title: text("A second note") });
    const article = makeArticle({
      id: "note-1",
      contentType: "note",
      title: text("A second note"),
    });
    const fake = createFakeAdapter({
      entries: [feature, note],
      loadFeatured: async () => feature,
      loadItem: async () => article,
    });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    await screen.findByText("A second note");
    fireEvent.click(screen.getByRole("button", { name: COPY.en.anotherDiscovery }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("sets RTL for Arabic and keeps the copy in the interface language", async () => {
    const fake = createFakeAdapter({
      loadFeatured: async () => null,
      loadPage: async () => ({ items: [makeEntry({ id: "ar-1" })], total: 1 }),
    });
    const { container } = render(<CultureDiscovery adapter={fake.adapter} locale="ar" />);
    const root = container.querySelector<HTMLElement>("[data-culture-section]");
    expect(root?.getAttribute("dir")).toBe("rtl");
    expect(screen.getByRole("region", { hidden: true })).toBeInTheDocument();
    expect(screen.getByText(COPY.ar.sectionLabel)).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: COPY.ar.searchLabel })).toBeInTheDocument();
  });

  it("carries the reduced-motion class contract on its loading surface", () => {
    const pending = deferred<CultureListPage>();
    const fake = createFakeAdapter({
      loadPage: () => pending.promise,
      loadFeatured: async () => null,
    });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    const pulses = [...document.querySelectorAll<HTMLElement>(".animate-pulse")];
    expect(pulses.length).toBeGreaterThan(0);
    for (const pulse of pulses) expect(pulse.className).toContain("motion-reduce:animate-none");
    pending.resolve({ items: [], total: 0 });
  });

  it("never renders an image anywhere in the section", async () => {
    const fake = createFakeAdapter({ loadFeatured: async () => null });
    const { container } = render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    await screen.findByText("A note on greetings");
    expect(container.querySelectorAll("img, picture, video, iframe")).toHaveLength(0);
    expect(container.querySelector('[style*="url("]')).toBeNull();
  });
});

describe("the page cap", () => {
  it("stops at MAX_PAGES and says so instead of looping forever", async () => {
    vi.useFakeTimers();
    try {
      const entries = [makeEntry({ id: "cap-0", contentType: "note", title: text("Cap piece 0") })];
      let calls = 0;
      const fake = createFakeAdapter({
        loadPage: async (query) => {
          calls += 1;
          const page = calls;
          return {
            items: [
              ...(query.cursor ? [] : entries),
              ...(query.cursor
                ? [
                    makeEntry({
                      id: "cap-" + String(page),
                      contentType: "note",
                      title: text("Cap piece " + String(page)),
                    }),
                  ]
                : []),
            ],
            total: 200,
            // Always a cursor: only the UI's own cap can end this feed.
            nextCursor: "cursor-" + String(page),
          };
        },
        loadFeatured: async () => null,
      });
      render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      for (let page = 1; page < MAX_PAGES; page += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(MORE_COOLDOWN_MS + 20);
        });
        const more = screen.getByRole("button", { name: new RegExp(COPY.en.more, "i") });
        fireEvent.click(more);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10);
        });
      }
      expect(calls).toBe(MAX_PAGES);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MORE_COOLDOWN_MS + 20);
      });
      expect(screen.getByText(COPY.en.endOfFeed)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("section accessibility", () => {
  it("names the section with a real heading and labels the controls", async () => {
    const fake = createFakeAdapter({ loadFeatured: async () => null });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    await screen.findByText("A note on greetings");
    const region = screen.getByRole("region", { name: COPY.en.feedLabel });
    expect(within(region).getByRole("searchbox")).toBeInTheDocument();
  });
});
