import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CultureDiscovery } from "./CultureDiscovery";
import { COPY } from "./copy";
import { makeAdapter, makeEntry, makeFacets, makeMedia, makePage } from "./testFixtures";

/**
 * Section-level behaviour: the first paint, every calm state, the controlled browsing loop,
 * debounced search, filters, the saved view and the Arabic/RTL shell.
 */

const a = makeEntry({ id: "alpha", category: "objects", countries: ["MA"] });
const b = makeEntry({ id: "beta", category: "music", countries: ["JP"] });
const c = makeEntry({ id: "gamma", category: "language", countries: ["EG"] });
const d = makeEntry({ id: "delta", category: "crafts", countries: ["TR"] });

function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("article")];
}

class FakeIntersectionObserver implements IntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin = "";
  readonly scrollMargin = "";
  readonly thresholds: readonly number[] = [];
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  trigger(): void {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeIntersectionObserver.instances = [];
});

describe("section identity", () => {
  it("opens with a quiet label, one sentence and the first small batch", async () => {
    const adapter = makeAdapter({ pages: [makePage([a, b], "c1")] });
    render(<CultureDiscovery adapter={adapter} locale="en" pageSize={2} />);
    expect(screen.getByText(COPY.en.sectionLabel)).toBeInTheDocument();
    expect(screen.getByText(COPY.en.introLine)).toBeInTheDocument();
    await waitFor(() => expect(cards()).toHaveLength(2));
    const more = screen.getByRole("button", { name: COPY.en.more });
    expect(more).toBeInTheDocument();
    expect(more.className).toContain("min-h-11");
    const search = screen.getByRole("searchbox", { name: COPY.en.searchLabel });
    expect(search.closest("label")?.className).toContain("h-11");
  });

  it("asks for the small default batch and never mounts the whole catalog", async () => {
    const adapter = makeAdapter({ pages: [makePage([a, b, c], "c1")] });
    render(<CultureDiscovery adapter={adapter} locale="en" />);
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(adapter.calls.pages[0]?.limit).toBe(8);
  });

  it("adds no continuous animation and no hard-coded colour", async () => {
    const adapter = makeAdapter({ pages: [makePage([a, b])] });
    const { container } = render(<CultureDiscovery adapter={adapter} locale="en" />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    const section = container.querySelector("section");
    if (!section) throw new Error("no section");
    // Reduced motion: the section has nothing to pause because nothing animates.
    expect(section.querySelectorAll('[class*="animate-"]')).toHaveLength(0);
    expect(section.querySelectorAll('[class*="transition-transform"]')).toHaveLength(0);
    // Three themes: component colour comes from semantic tokens only.
    expect(section.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(section.innerHTML).not.toMatch(/\b(?:rgb|hsl|oklch)\(/);
  });

  it("is RTL and Arabic-typographic in the Arabic interface", async () => {
    const adapter = makeAdapter({ pages: [makePage([a])] });
    render(<CultureDiscovery adapter={adapter} locale="ar" pageSize={2} />);
    const section = document.querySelector("section");
    expect(section).toHaveAttribute("dir", "rtl");
    expect(section).toHaveAttribute("lang", "ar");
    expect(screen.getByText(COPY.ar.sectionLabel)).toBeInTheDocument();
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.getAllByRole("button", { name: COPY.ar.saveLabel }).length).toBeGreaterThan(0);
  });

  it("features one discovery above the feed", async () => {
    const featured = makeEntry({
      id: "featured",
      category: "architecture",
      media: makeMedia(),
      hasMedia: true,
    });
    const adapter = makeAdapter({ pages: [makePage([a])], featured });
    render(<CultureDiscovery adapter={adapter} locale="en" pageSize={2} />);
    await waitFor(() => expect(cards().length).toBe(2));
    expect(screen.getByText(COPY.en.featuredLabel)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("loading", "lazy");
  });
});

describe("states", () => {
  it("shows a calm loading surface before anything arrives", () => {
    const adapter = makeAdapter();
    adapter.loadPage = () => new Promise(() => undefined);
    render(<CultureDiscovery adapter={adapter} locale="en" />);
    expect(screen.getByRole("status")).toHaveTextContent(COPY.en.loading);
    expect(cards()).toHaveLength(0);
  });

  it("shows the empty sentence when nothing matches", async () => {
    const adapter = makeAdapter({ pages: [makePage([])] });
    render(<CultureDiscovery adapter={adapter} locale="en" />);
    await waitFor(() => expect(screen.getByText(COPY.en.empty)).toBeInTheDocument());
  });

  it("explains a failure calmly and retries into the feed", async () => {
    const adapter = makeAdapter({ pages: [makePage([a, b])], pageError: "failed" });
    render(<CultureDiscovery adapter={adapter} locale="en" />);
    await waitFor(() => expect(screen.getByText(COPY.en.errorTitle)).toBeInTheDocument());
    expect(screen.getByText(COPY.en.errorBody)).toBeInTheDocument();
    adapter.setPageError(null);
    fireEvent.click(screen.getByRole("button", { name: COPY.en.retry }));
    await waitFor(() => expect(cards()).toHaveLength(2));
  });

  it("offers the offline wording and keeps saved records available without a network", async () => {
    const adapter = makeAdapter({
      pages: [makePage([a, b])],
      pageError: "offline",
      online: false,
      saved: { ids: [a.id], entries: [a] },
    });
    render(<CultureDiscovery adapter={adapter} locale="en" />);
    await waitFor(() => expect(screen.getByText(COPY.en.offlineTitle)).toBeInTheDocument());
    const pageCalls = adapter.calls.pages.length;

    fireEvent.click(screen.getByRole("button", { name: new RegExp("^" + COPY.en.savedView) }));
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.getByText(COPY.en.savedOnDevice)).toBeInTheDocument();
    // Opening the saved view never touches the network.
    expect(adapter.calls.pages.length).toBe(pageCalls);
  });
});

describe("controlled browsing", () => {
  it("loads one more page on request and never renders a duplicate card", async () => {
    const adapter = makeAdapter({
      pages: [makePage([a, b], "c1"), makePage([b, c])],
    });
    render(<CultureDiscovery adapter={adapter} locale="en" pageSize={2} />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: COPY.en.more }));
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(screen.queryByRole("button", { name: COPY.en.more })).not.toBeInTheDocument();
  });

  it("nudges the next page from the observer, once, within its guards", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const adapter = makeAdapter({
      pages: [makePage([a, b], "c1"), makePage([c, d])],
    });
    render(<CultureDiscovery adapter={adapter} locale="en" pageSize={2} />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    await waitFor(() => expect(FakeIntersectionObserver.instances.length).toBe(1));
    const observer = FakeIntersectionObserver.instances[0];
    if (!observer) throw new Error("no observer");
    act(() => observer.trigger());
    await waitFor(() => expect(cards()).toHaveLength(4));
    // A second intersection inside the cooldown must not start another read.
    act(() => observer.trigger());
    expect(adapter.calls.pages).toHaveLength(2);
  });
});

describe("search and filters", () => {
  it("debounces search instead of requesting per keystroke", async () => {
    const adapter = makeAdapter({
      pages: [makePage([a], "c1"), makePage([b]), makePage([c])],
    });
    render(<CultureDiscovery adapter={adapter} locale="en" />);
    await waitFor(() => expect(cards()).toHaveLength(1));
    const input = screen.getByRole("searchbox", { name: COPY.en.searchLabel });
    fireEvent.change(input, { target: { value: "m" } });
    fireEvent.change(input, { target: { value: "mu" } });
    fireEvent.change(input, { target: { value: "mus" } });
    expect(adapter.calls.pages).toHaveLength(1);
    await waitFor(() => expect(adapter.calls.pages).toHaveLength(2), { timeout: 1500 });
    expect(adapter.calls.pages[1]?.search).toBe("mus");
  });

  it("restarts the feed from the first page when a filter is chosen and can clear it", async () => {
    const adapter = makeAdapter({
      pages: [makePage([a], "c1"), makePage([b]), makePage([c])],
    });
    render(<CultureDiscovery adapter={adapter} locale="en" />);
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.change(screen.getByLabelText(COPY.en.filterCategory), {
      target: { value: "music" },
    });
    await waitFor(() => expect(adapter.calls.pages).toHaveLength(2));
    expect(adapter.calls.pages[1]?.category).toBe("music");
    expect(adapter.calls.pages[1]?.cursor).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: COPY.en.clearFilters }));
    await waitFor(() => expect(adapter.calls.pages).toHaveLength(3));
    expect(adapter.calls.pages[2]?.category).toBeUndefined();
  });

  it("offers filter options from the facets, and still works when the facet read fails", async () => {
    const adapter = makeAdapter({
      pages: [makePage([a])],
      facets: makeFacets(["objects"], ["africa"]),
    });
    const first = render(<CultureDiscovery adapter={adapter} locale="en" />);
    await waitFor(() => expect(adapter.calls.facets).toBe(1));
    const category = screen.getByLabelText(COPY.en.filterCategory);
    await waitFor(() => expect(category.querySelectorAll("option").length).toBeGreaterThan(1));
    expect(screen.getByRole("option", { name: /Objects/ })).toBeInTheDocument();
    first.unmount();

    const failing = makeAdapter({ pages: [makePage([b])], facets: null });
    render(<CultureDiscovery adapter={failing} locale="en" />);
    await waitFor(() => expect(failing.calls.facets).toBe(1));
    const fallback = screen.getByLabelText(COPY.en.filterCategory);
    expect(fallback.querySelectorAll("option").length).toBeGreaterThan(20);
  });
});

describe("saved view", () => {
  it("toggles a discovery and lists it without any further page request", async () => {
    const adapter = makeAdapter({
      pages: [makePage([a, b])],
      // The port resolves saved ids against locally cached entries; both records are cached here.
      saved: { ids: [], entries: [a, b] },
    });
    render(<CultureDiscovery adapter={adapter} locale="en" />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    const pageCalls = adapter.calls.pages.length;

    fireEvent.click(screen.getAllByRole("button", { name: COPY.en.saveLabel })[0]!);
    await waitFor(() => expect(adapter.calls.savedToggles).toEqual([a.id]));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: COPY.en.unsaveLabel }).length).toBe(1),
    );

    fireEvent.click(screen.getByRole("button", { name: new RegExp("^" + COPY.en.savedView) }));
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(adapter.calls.pages.length).toBe(pageCalls);
  });

  it("explains an empty saved view honestly", async () => {
    const adapter = makeAdapter({ pages: [makePage([a])], saved: { ids: [], entries: [] } });
    render(<CultureDiscovery adapter={adapter} locale="en" />);
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: new RegExp("^" + COPY.en.savedView) }));
    await waitFor(() => expect(screen.getByText(COPY.en.savedEmpty)).toBeInTheDocument());
  });
});
