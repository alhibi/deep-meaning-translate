import { afterEach, describe, expect, it } from "vitest";
import {
  browseCulture,
  countCultureEntries,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  featuredForDay,
  mixedFeedOrder,
  randomCultureEntry,
  relatedCultureEntries,
  RELATED_DEFAULT_LIMIT,
  RELATED_MAX_LIMIT,
} from "./discovery";
import {
  europeHeavyCultureEntries,
  fixtureCultureSource,
  makeCultureEntry,
  makeFixtureCounters,
  syntheticCultureEntries,
  testCountry,
  chunkedCultureCatalog,
} from "./testing";
import { loadCultureIndex, resetCultureLoader, setCultureDataSource } from "./loader";
import type { CultureIndexEntry } from "./types";

interface AdjacencyIssue {
  rule: "continent" | "category" | "country";
  previous: string;
  current: string;
}

function adjacencyIssues(order: readonly CultureIndexEntry[]): AdjacencyIssue[] {
  const issues: AdjacencyIssue[] = [];
  for (let index = 1; index < order.length; index += 1) {
    const previous = order[index - 1];
    const current = order[index];
    if (!previous || !current) continue;
    if (previous.continent === current.continent) {
      issues.push({ rule: "continent", previous: previous.id, current: current.id });
    }
    if (previous.category === current.category) {
      issues.push({ rule: "category", previous: previous.id, current: current.id });
    }
    const sharedCountry =
      previous.countries.length > 0 &&
      current.countries.length > 0 &&
      current.countries.some((country) => previous.countries.includes(country));
    if (sharedCountry) {
      issues.push({ rule: "country", previous: previous.id, current: current.id });
    }
  }
  return issues;
}

function dayKeyAt(dayNumber: number): string {
  const date = new Date(Date.UTC(2026, 0, 1) + dayNumber * 86_400_000);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

afterEach(() => {
  setCultureDataSource(null);
  resetCultureLoader();
});

describe("featured article of the day", () => {
  it("returns null for an empty library and a stable pick for one article", () => {
    expect(featuredForDay([], "2026-11-17")).toBeNull();
    const single = [makeCultureEntry("culture-only")];
    expect(featuredForDay(single, "2026-11-17")?.id).toBe("culture-only");
    expect(featuredForDay(single, "2026-11-18")?.id).toBe("culture-only");
  });

  it("is deterministic for the same day key and never repeats yesterday's article", () => {
    const entries = syntheticCultureEntries(60);
    const first = featuredForDay(entries, "2026-11-17");
    expect(first).not.toBeNull();
    expect(featuredForDay(entries, "2026-11-17")?.id).toBe(first?.id);
    const ids: string[] = [];
    for (let day = 0; day < 40; day += 1) {
      const key = dayKeyAt(day);
      const featured = featuredForDay(entries, key);
      expect(featured).not.toBeNull();
      if (!featured) continue;
      ids.push(featured.id);
      expect(featuredForDay(entries, key)?.id).toBe(featured.id);
    }
    for (let index = 1; index < ids.length; index += 1) {
      expect(ids[index]).not.toBe(ids[index - 1]);
    }
  });

  it("rotates through the continents present in the library", () => {
    const entries = europeHeavyCultureEntries();
    const continents: string[] = [];
    for (let day = 0; day < 24; day += 1) {
      const featured = featuredForDay(entries, dayKeyAt(day));
      if (featured) continents.push(featured.continent);
    }
    expect(new Set(continents).size).toBe(6);
    for (let index = 1; index < continents.length; index += 1) {
      expect(continents[index]).not.toBe(continents[index - 1]);
    }
  });

  it("rotates a one-continent library without repeating yesterday's article", () => {
    const entries = [
      makeCultureEntry("culture-a", { continent: "europe" }),
      makeCultureEntry("culture-b", { continent: "europe" }),
      makeCultureEntry("culture-c", { continent: "europe" }),
    ];
    const ids: string[] = [];
    for (let day = 0; day < 18; day += 1) {
      const featured = featuredForDay(entries, dayKeyAt(day));
      expect(featured).not.toBeNull();
      if (featured) ids.push(featured.id);
    }
    for (let index = 1; index < ids.length; index += 1) {
      expect(ids[index]).not.toBe(ids[index - 1]);
    }
    expect(new Set(ids)).toEqual(new Set(["culture-a", "culture-b", "culture-c"]));
    const two = entries.slice(0, 2);
    const twoIds = Array.from({ length: 10 }, (_, day) => featuredForDay(two, dayKeyAt(day))?.id);
    for (let index = 1; index < twoIds.length; index += 1) {
      expect(twoIds[index]).not.toBe(twoIds[index - 1]);
    }
  });

  it("stays stable for a malformed day key", () => {
    const entries = syntheticCultureEntries(20);
    const featured = featuredForDay(entries, "");
    expect(featured).not.toBeNull();
    expect(featuredForDay(entries, "")?.id).toBe(featured?.id);
    expect(featuredForDay(entries, "not-a-date")?.id).toBe(
      featuredForDay(entries, "not-a-date")?.id,
    );
  });
});

describe("mixed feed order", () => {
  it("contains every article exactly once", () => {
    const entries = syntheticCultureEntries(60);
    const order = mixedFeedOrder(entries);
    expect(order).toHaveLength(entries.length);
    expect(new Set(order.map((entry) => entry.id))).toEqual(
      new Set(entries.map((entry) => entry.id)),
    );
  });

  it("never places two articles of the same continent, category or country together", () => {
    expect(adjacencyIssues(mixedFeedOrder(syntheticCultureEntries(60)))).toEqual([]);
    expect(adjacencyIssues(mixedFeedOrder(syntheticCultureEntries(120)))).toEqual([]);
  });

  it("does not let a Europe-heavy library dominate the first page", () => {
    const entries = europeHeavyCultureEntries();
    const page = browseCulture(entries, { limit: 24 });
    expect(page.items.filter((entry) => entry.continent === "europe").length).toBeLessThanOrEqual(
      12,
    );
  });

  it("is stable for the same library array", () => {
    const entries = syntheticCultureEntries(36);
    expect(mixedFeedOrder(entries).map((entry) => entry.id)).toEqual(
      mixedFeedOrder(entries).map((entry) => entry.id),
    );
  });

  it("keeps every id when the whole library is one continent constant too", () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      makeCultureEntry("culture-" + String(index), {
        continent: "europe",
        category: "everyday-life",
        countries: ["DE"],
      }),
    );
    const order = mixedFeedOrder(entries);
    expect(order).toHaveLength(12);
    expect(new Set(order.map((entry) => entry.id)).size).toBe(12);
  });
});

describe("browse pages", () => {
  const entries = syntheticCultureEntries(60);

  it("pages with the last id as cursor without duplicates or gaps", () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = browseCulture(
        entries,
        cursor === undefined ? { limit: 7 } : { limit: 7, cursor },
      );
      expect(page.total).toBe(60);
      expect(page.items.length).toBeLessThanOrEqual(7);
      for (const item of page.items) expect(seen).not.toContain(item.id);
      seen.push(...page.items.map((item) => item.id));
      pages += 1;
      expect(pages).toBeLessThanOrEqual(20);
      if (page.nextCursor === undefined) break;
      expect(page.nextCursor).toBe(page.items[page.items.length - 1]?.id);
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(60);
    expect(new Set(seen)).toEqual(new Set(entries.map((entry) => entry.id)));
  });

  it("restarts from the first page when the cursor is no longer in the selection", () => {
    const first = browseCulture(entries, { limit: 10 });
    const restarted = browseCulture(entries, { limit: 10, cursor: "culture-gone" });
    expect(restarted.items.map((entry) => entry.id)).toEqual(first.items.map((entry) => entry.id));
  });

  it("uses the documented limit bounds", () => {
    expect(browseCulture(entries).items).toHaveLength(FEED_DEFAULT_LIMIT);
    expect(browseCulture(entries, { limit: 999 }).items).toHaveLength(FEED_MAX_LIMIT);
    expect(browseCulture(entries, { limit: 0 }).items).toHaveLength(1);
  });

  it("filters by category, continent, country and content type", () => {
    const target = entries[3];
    expect(target).toBeTruthy();
    if (!target) return;
    const byCategory = browseCulture(entries, { category: target.category, limit: 60 });
    expect(byCategory.total).toBe(
      entries.filter((entry) => entry.category === target.category).length,
    );
    expect(byCategory.items.every((entry) => entry.category === target.category)).toBe(true);
    const byContinent = browseCulture(entries, { continent: target.continent, limit: 60 });
    expect(byContinent.items.every((entry) => entry.continent === target.continent)).toBe(true);
    const country = testCountry(3);
    const byCountry = browseCulture(entries, { country: country, limit: 60 });
    expect(byCountry.total).toBe(1);
    expect(byCountry.items[0]?.id).toBe(target.id);
    const byType = browseCulture(entries, { contentType: target.contentType, limit: 60 });
    expect(byType.items.every((entry) => entry.contentType === target.contentType)).toBe(true);
  });

  it("pages the saved view through the caller's saved ids", () => {
    const savedIds = new Set([entries[0]?.id ?? "", entries[5]?.id ?? "", entries[9]?.id ?? ""]);
    const page = browseCulture(entries, { savedOnly: true, limit: 10 }, { savedIds });
    expect(page.total).toBe(3);
    expect(page.items.map((entry) => entry.id).sort()).toEqual([...savedIds].sort());
    expect(browseCulture(entries, { savedOnly: true, limit: 10 }).total).toBe(0);
  });

  it("searches titles, teasers and tags through the same page contract", () => {
    const searchable = [
      makeCultureEntry("culture-a", {
        title: { ar: "القهوة", de: "Kaffee", en: "Coffee" },
        teaser: { ar: "مشروب", de: "Getrank", en: "Drink" },
        tags: [],
      }),
      makeCultureEntry("culture-b", {
        title: { ar: "سوق", de: "Markt", en: "Market" },
        teaser: { ar: "قهوة الصباح", de: "Kaffee am Morgen", en: "Morning coffee" },
        tags: [],
      }),
      makeCultureEntry("culture-c", {
        title: { ar: "سوق", de: "Markt", en: "Market" },
        teaser: { ar: "سوق", de: "Markt", en: "Market" },
        tags: ["kaffee"],
      }),
    ];
    const page = browseCulture(searchable, { search: "kaffee", limit: 10 });
    expect(page.total).toBe(3);
    expect(page.items.map((entry) => entry.id)).toEqual(["culture-a", "culture-c", "culture-b"]);
    expect(browseCulture(searchable, { search: "zzz", limit: 10 }).total).toBe(0);
  });

  it("counts the same selection the page iterates", () => {
    const target = entries[0] as CultureIndexEntry;
    const filters = { category: target.category, limit: 5 };
    expect(countCultureEntries(entries, filters)).toBe(browseCulture(entries, filters).total);
    expect(countCultureEntries(entries)).toBe(entries.length);
  });
});

describe("related articles", () => {
  const entries: CultureIndexEntry[] = [
    makeCultureEntry("culture-target", {
      category: "traditions",
      continent: "europe",
      countries: ["DE"],
      tags: ["bread"],
    }),
    makeCultureEntry("culture-declared", {
      category: "music-and-dance",
      continent: "asia",
      countries: ["JP"],
      tags: [],
    }),
    makeCultureEntry("culture-category", {
      category: "traditions",
      continent: "africa",
      countries: ["MA"],
      tags: [],
    }),
    makeCultureEntry("culture-country", {
      category: "music-and-dance",
      continent: "europe",
      countries: ["DE"],
      tags: [],
    }),
    makeCultureEntry("culture-tag", {
      category: "music-and-dance",
      continent: "asia",
      countries: ["JP"],
      tags: ["bread"],
    }),
    makeCultureEntry("culture-unrelated", {
      category: "music-and-dance",
      continent: "asia",
      countries: ["JP"],
      tags: [],
    }),
  ];

  it("puts declared relationships first, then shared countries, category and tags", () => {
    const related = relatedCultureEntries(entries, "culture-target", {
      declared: ["culture-declared"],
    });
    expect(related.map((entry) => entry.id)).toEqual([
      "culture-declared",
      "culture-category",
      "culture-country",
      "culture-tag",
    ]);
    expect(related.some((entry) => entry.id === "culture-target")).toBe(false);
    expect(related.some((entry) => entry.id === "culture-unrelated")).toBe(false);
  });

  it("bounds the result and never returns the article itself", () => {
    expect(relatedCultureEntries(entries, "culture-target")).toHaveLength(3);
    expect(relatedCultureEntries(entries, "culture-target", { limit: 2 })).toHaveLength(2);
    const many = syntheticCultureEntries(60);
    const bounded = relatedCultureEntries(many, many[0]?.id ?? "", { limit: 999 });
    expect(bounded.length).toBeLessThanOrEqual(RELATED_MAX_LIMIT);
    expect(bounded.length).toBeGreaterThan(0);
    expect(bounded.some((entry) => entry.id === many[0]?.id)).toBe(false);
  });

  it("returns an empty list for an unknown article and default limit", () => {
    expect(relatedCultureEntries(entries, "culture-missing")).toEqual([]);
    expect(RELATED_DEFAULT_LIMIT).toBe(6);
  });

  it("accepts declared ids that are not in the library without inventing entries", () => {
    const related = relatedCultureEntries(entries, "culture-target", {
      declared: ["culture-ghost", "culture-declared"],
    });
    expect(related.map((entry) => entry.id)[0]).toBe("culture-declared");
    expect(related.some((entry) => entry.id === "culture-ghost")).toBe(false);
  });
});

describe("random discovery", () => {
  const entries = syntheticCultureEntries(60);

  it("avoids the recent-seen history and the caller's exclude set", () => {
    const seen = entries.slice(0, 20).map((entry) => entry.id);
    const exclude = entries.slice(20, 25).map((entry) => entry.id);
    const picked = randomCultureEntry(entries, { seen, exclude, random: () => 0.42 });
    expect(picked).not.toBeNull();
    expect(seen).not.toContain(picked?.id);
    expect(exclude).not.toContain(picked?.id);
    expect(randomCultureEntry(entries, { seen, exclude, random: () => 0.42 })?.id).toBe(picked?.id);
  });

  it("relaxes the seen filter when every article has been seen", () => {
    const seen = entries.map((entry) => entry.id);
    const picked = randomCultureEntry(entries, {
      seen,
      exclude: [entries[0]?.id ?? ""],
      random: () => 0.1,
    });
    expect(picked).not.toBeNull();
    expect(picked?.id).not.toBe(entries[0]?.id);
  });

  it("returns null when every article is excluded or the library is empty", () => {
    expect(randomCultureEntry([], { random: () => 0.5 })).toBeNull();
    expect(
      randomCultureEntry(entries, {
        exclude: entries.map((entry) => entry.id),
        random: () => 0.5,
      }),
    ).toBeNull();
  });

  it("can read the already-loaded compact index when called with options only", async () => {
    const counters = makeFixtureCounters();
    const fixture = syntheticCultureEntries(24);
    const { payload, chunks } = chunkedCultureCatalog(fixture, 12);
    setCultureDataSource(fixtureCultureSource(payload, chunks, counters));
    await loadCultureIndex();
    const seen = fixture.slice(0, 5).map((entry) => entry.id);
    const picked = randomCultureEntry({ seen, random: () => 0.7 });
    expect(picked).not.toBeNull();
    expect(seen).not.toContain(picked?.id);
    expect(fixture.some((entry) => entry.id === picked?.id)).toBe(true);
  });
});
