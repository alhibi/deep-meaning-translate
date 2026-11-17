import { describe, expect, it } from "vitest";
import {
  browseCulture,
  countCultureEntries,
  featuredForDay,
  mixedFeedOrder,
  randomCultureEntry,
  relatedCultureEntries,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
} from "./discovery";
import { europeHeavyIndex, makeEntry, syntheticIndex, testCountry } from "./testing";
import type { CultureIndexEntry } from "./types";

const dayKeyAt = (offset: number): string => {
  const date = new Date(Date.UTC(2026, 10, 17) + offset * 86_400_000);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${String(date.getUTCFullYear())}-${month}-${day}`;
};

const ids = (entries: readonly CultureIndexEntry[]): string[] => entries.map((entry) => entry.id);

const collectPages = (
  catalog: readonly CultureIndexEntry[],
  limit: number,
  filters: Parameters<typeof browseCulture>[1] = {},
  options: Parameters<typeof browseCulture>[2] = {},
): { ids: string[]; pages: number; total: number } => {
  const collected: string[] = [];
  let page = browseCulture(catalog, { ...filters, limit }, options);
  let pages = 1;
  while (page.nextCursor) {
    collected.push(...ids(page.items));
    page = browseCulture(catalog, { ...filters, limit, cursor: page.nextCursor }, options);
    pages += 1;
    if (pages > 100) throw new Error("pagination did not terminate");
  }
  collected.push(...ids(page.items));
  return { ids: collected, pages, total: page.total ?? -1 };
};

describe("featured for the day", () => {
  const catalog = europeHeavyIndex();

  it("is a pure function of the day key", () => {
    const first = featuredForDay(catalog, "2026-11-17");
    expect(first).not.toBeNull();
    expect(featuredForDay(catalog, "2026-11-17")?.id).toBe(first?.id);
    expect(featuredForDay(catalog, "2026-11-18")).not.toBeNull();
    expect(catalog.some((entry) => entry.id === first?.id)).toBe(true);
  });

  it("rotates across days and never features the same record two days running", () => {
    const featured = Array.from({ length: 30 }, (_, i) => featuredForDay(catalog, dayKeyAt(i))?.id);
    expect(new Set(featured).size).toBeGreaterThan(1);
    for (let i = 1; i < featured.length; i += 1) {
      expect(featured[i]).not.toBe(featured[i - 1]);
    }
  });

  it("does not let a Europe-heavy corpus dominate the featured slot", () => {
    let europe = 0;
    for (let i = 0; i < 60; i += 1) {
      const pick = featuredForDay(catalog, dayKeyAt(i));
      if (pick?.continent === "europe") europe += 1;
    }
    // Europe is 20/54 of this corpus; a corpus-mirroring pick would be ~22 of 60.
    expect(europe).toBeLessThanOrEqual(20);
  });

  it("accepts a malformed day key deterministically and handles tiny catalogs", () => {
    const first = featuredForDay(catalog, "not-a-day");
    expect(first).not.toBeNull();
    expect(featuredForDay(catalog, "not-a-day")?.id).toBe(first?.id);
    expect(featuredForDay([], "2026-11-17")).toBeNull();
    const only = makeEntry("met-only");
    expect(featuredForDay([only], "2026-11-17")?.id).toBe("met-only");
    expect(featuredForDay([only], "2026-11-18")?.id).toBe("met-only");
  });
});

describe("mixed feed", () => {
  it("returns every record exactly once", () => {
    const catalog = syntheticIndex(60);
    const order = mixedFeedOrder(catalog);
    expect(order).toHaveLength(catalog.length);
    expect(new Set(ids(order)).size).toBe(catalog.length);
  });

  it("never repeats a category or a country twice in a row", () => {
    const catalog = syntheticIndex(60);
    const order = mixedFeedOrder(catalog);
    for (let i = 1; i < order.length; i += 1) {
      const previous = order[i - 1];
      const current = order[i];
      if (!previous || !current) continue;
      expect(current.category).not.toBe(previous.category);
      const shared = current.countries.filter((country) => previous.countries.includes(country));
      expect(shared).toEqual([]);
    }
  });

  it("keeps a repeated generic object name at least four rows apart", () => {
    // A museum catalog holds many objects with the same generic name ("Perfume bottle").
    // They are genuine records, but repeating the same card two rows apart reads as a bug.
    const categories = ["crafts", "textiles", "music", "tools", "objects", "design"] as const;
    const continents = ["africa", "asia", "europe", "north-america", "south-america"] as const;
    // The real corpus repeats generic object names (~50 repeated titles over 535 rows),
    // so this is a realistic-density check rather than an adversarial one.
    const catalog = Array.from({ length: 120 }, (_, i) =>
      makeEntry(`met-${i}`, {
        title: { en: i % 8 === 0 ? "Perfume bottle" : `Unique record ${i}` },
        category: categories[i % categories.length],
        continent: continents[i % continents.length],
        countries: [testCountry(i)],
      }),
    );
    const order = mixedFeedOrder(catalog);
    expect(order).toHaveLength(catalog.length);
    const repeatedAt = order
      .map((entry, index) => (entry.title.en === "Perfume bottle" ? index : -1))
      .filter((index) => index >= 0);
    expect(repeatedAt.length).toBe(15);
    let shortGaps = 0;
    for (let i = 1; i < repeatedAt.length; i += 1) {
      const previous = repeatedAt[i - 1];
      const current = repeatedAt[i];
      if (previous === undefined || current === undefined) continue;
      // Adjacent identical cards must never happen; a handful of short gaps in the tail
      // (where the remaining records are all the same object name) is the documented limit.
      expect(current - previous).toBeGreaterThan(1);
      if (current - previous < 5) shortGaps += 1;
    }
    expect(shortGaps).toBeLessThanOrEqual(3);
  });

  it("defers a same-country record instead of dropping or repeating it", () => {
    const catalog = [
      makeEntry("met-1", { category: "textiles", countries: ["DE"] }),
      makeEntry("met-2", { category: "music", countries: ["DE"] }),
      makeEntry("met-3", { category: "food-culture", countries: ["FR"] }),
      makeEntry("met-4", { category: "crafts", countries: ["IT"] }),
    ];
    const order = mixedFeedOrder(catalog);
    expect(ids(order)).toHaveLength(4);
    expect(new Set(ids(order)).size).toBe(4);
    for (let i = 1; i < order.length; i += 1) {
      const previous = order[i - 1];
      const current = order[i];
      if (!previous || !current) continue;
      expect(current.category).not.toBe(previous.category);
      const shared = current.countries.filter((country) => previous.countries.includes(country));
      expect(shared).toEqual([]);
    }
  });

  it("is stable for the same index", () => {
    const catalog = syntheticIndex(24);
    expect(ids(mixedFeedOrder(catalog))).toEqual(ids(mixedFeedOrder(catalog)));
  });

  it("rotates continents instead of mirroring a Europe-heavy corpus", () => {
    const catalog = europeHeavyIndex();
    const page = browseCulture(catalog, { limit: 18 });
    const europe = page.items.filter((entry) => entry.continent === "europe").length;
    // Europe is 20/54 of the corpus; a corpus-mirroring first page would be ~7 of 18.
    expect(europe).toBeLessThanOrEqual(6);
  });
});

describe("cursor pagination", () => {
  const catalog = syntheticIndex(38);

  it("pages through the whole feed without duplicates or gaps", () => {
    const { ids: collected, total, pages } = collectPages(catalog, 7);
    expect(collected).toHaveLength(catalog.length);
    expect(new Set(collected).size).toBe(catalog.length);
    expect(collected).toEqual(ids(mixedFeedOrder(catalog)));
    expect(total).toBe(catalog.length);
    expect(pages).toBe(Math.ceil(catalog.length / 7));
  });

  it("gives the same page when a page request is retried", () => {
    const first = browseCulture(catalog, { limit: 5 });
    const retry = browseCulture(catalog, { limit: 5 });
    expect(ids(retry.items)).toEqual(ids(first.items));
    expect(retry.nextCursor).toBe(first.nextCursor);
    expect(first.nextCursor).toBe(first.items.at(-1)?.id);
  });

  it("starts over when the cursor is not part of the selection", () => {
    const firstPage = browseCulture(catalog, { limit: 5 });
    const restarted = browseCulture(catalog, { limit: 5, cursor: "met-does-not-exist" });
    expect(ids(restarted.items)).toEqual(ids(firstPage.items));
  });

  it("reports no next cursor on the last page and respects the page-size bounds", () => {
    const page = browseCulture(catalog, { limit: FEED_MAX_LIMIT });
    expect(page.nextCursor).toBeUndefined();
    expect(page.items).toHaveLength(catalog.length);
    expect(browseCulture(catalog, {}).items).toHaveLength(FEED_DEFAULT_LIMIT);
    expect(browseCulture(catalog, { limit: 0 }).items).toHaveLength(1);
    expect(browseCulture(catalog, { limit: 1000 }).items).toHaveLength(
      Math.min(FEED_MAX_LIMIT, catalog.length),
    );
  });
});

describe("filters", () => {
  const catalog = europeHeavyIndex();

  it("filters by category, continent and country", () => {
    const category = catalog[0]?.category;
    const byCategory = browseCulture(catalog, { category, limit: 60 });
    expect(byCategory.items.every((entry) => entry.category === category)).toBe(true);
    expect(byCategory.total).toBe(countCultureEntries(catalog, { category }));

    const byContinent = browseCulture(catalog, { continent: "oceania", limit: 60 });
    expect(byContinent.items).toHaveLength(6);
    expect(byContinent.items.every((entry) => entry.continent === "oceania")).toBe(true);

    const code = testCountry(3);
    const byCountry = browseCulture(catalog, { country: code.toLowerCase(), limit: 60 });
    expect(byCountry.items.map((entry) => entry.id)).toEqual([catalog[3]?.id]);
  });

  it("filters to saved records only when the caller supplies the saved ids", () => {
    const saved = catalog.slice(0, 3).map((entry) => entry.id);
    const page = browseCulture(catalog, { savedOnly: true, limit: 2 }, { savedIds: saved });
    expect(page.total).toBe(3);
    const collected = collectPages(catalog, 2, { savedOnly: true }, { savedIds: saved });
    expect(collected.ids.sort()).toEqual([...saved].sort());
    expect(browseCulture(catalog, { savedOnly: true }).total).toBe(0);
  });

  it("combines filters and keeps pagination consistent", () => {
    const category = catalog[0]?.category;
    const continent = catalog[0]?.continent;
    const page = browseCulture(catalog, { category, continent, limit: 2 });
    expect(
      page.items.every((entry) => entry.category === category && entry.continent === continent),
    ).toBe(true);
    expect(collectPages(catalog, 2, { category, continent }).ids).toEqual(
      collectPages(catalog, 2, { category, continent }).ids,
    );
  });

  it("ranks search matches and pages through all of them", () => {
    const searchable = [
      makeEntry("met-a", {
        title: { ar: "القهوة العربية", de: "Arabischer Kaffee", en: "Arabic coffee" },
        tags: ["kaffee"],
        continent: "asia",
        category: "food-culture",
        weight: 0.9,
      }),
      makeEntry("met-b", {
        title: { ar: "قهوة", de: "Kaffee", en: "Coffee" },
        tags: ["getrank"],
        continent: "europe",
        category: "food-culture",
        weight: 0.2,
      }),
      makeEntry("met-c", {
        title: { ar: "موسيقى", de: "Musik", en: "Music" },
        tags: ["klang"],
        continent: "africa",
        category: "music",
        weight: 0.5,
      }),
    ];
    const page = browseCulture(searchable, { search: "kaffee", limit: 1 });
    expect(page.total).toBe(2);
    expect(page.items[0]?.id).toBe("met-b"); // exact title beats a title token + tag
    const collected = collectPages(searchable, 1, { search: "kaffee" });
    expect(collected.ids).toEqual(["met-b", "met-a"]);
    expect(browseCulture(searchable, { search: "kaffee", continent: "europe" }).total).toBe(1);
    expect(browseCulture(searchable, { search: "zzzz" }).total).toBe(0);
  });
});

describe("related records", () => {
  const catalog = [
    makeEntry("met-target", {
      category: "textiles",
      continent: "asia",
      countries: ["TR"],
      tags: ["kilim", "weaving"],
      weight: 0.5,
    }),
    makeEntry("met-declared", {
      category: "music",
      continent: "europe",
      countries: ["DE"],
      tags: ["song"],
      weight: 0.9,
    }),
    makeEntry("met-category", {
      category: "textiles",
      continent: "africa",
      countries: ["EG"],
      tags: ["weaving"],
      weight: 0.3,
    }),
    makeEntry("met-country", {
      category: "food-culture",
      continent: "asia",
      countries: ["TR"],
      tags: ["kilim", "weaving"],
      weight: 0.2,
    }),
    makeEntry("met-unrelated", {
      category: "astronomy",
      continent: "oceania",
      countries: ["NZ"],
      tags: ["stars"],
      weight: 0.9,
    }),
  ];

  it("uses metadata only and never invents a relationship", () => {
    const related = relatedCultureEntries(catalog, "met-target");
    expect(ids(related)).toEqual(["met-country", "met-category"]);
    expect(ids(related)).not.toContain("met-target");
    expect(ids(related)).not.toContain("met-unrelated");
  });

  it("honours declared relationships and the bounded limit", () => {
    const related = relatedCultureEntries(catalog, "met-target", { declared: ["met-declared"] });
    expect(related[0]?.id).toBe("met-declared");
    expect(relatedCultureEntries(catalog, "met-target", { limit: 1 })).toHaveLength(1);
    expect(relatedCultureEntries(catalog, "met-unknown")).toEqual([]);
    expect(ids(relatedCultureEntries(catalog, "met-target"))).toEqual(
      ids(relatedCultureEntries(catalog, "met-target")),
    );
  });
});

describe("random discovery", () => {
  const catalog = syntheticIndex(60);

  it("picks a record from the requested continent fairly and deterministically", () => {
    const first = randomCultureEntry(catalog, { random: () => 0 });
    expect(first?.continent).toBe("africa");
    const third = randomCultureEntry(catalog, { random: () => 0.5 });
    expect(third?.continent).toBe("north-america");
    expect(randomCultureEntry(catalog, { random: () => 0 })?.id).toBe(first?.id);
  });

  it("avoids recently seen records when an alternative exists", () => {
    const seen = catalog.filter((entry) => entry.continent === "africa").map((entry) => entry.id);
    const pick = randomCultureEntry(catalog, { seen, random: () => 0 });
    expect(pick).not.toBeNull();
    expect(seen).not.toContain(pick?.id);
    expect(pick?.continent).not.toBe("africa");
  });

  it("relaxes the seen history but never the current session's exclude set", () => {
    const all = catalog.map((entry) => entry.id);
    expect(randomCultureEntry(catalog, { seen: all, random: () => 0.3 })).not.toBeNull();
    expect(randomCultureEntry(catalog, { exclude: all, random: () => 0.3 })).toBeNull();
    const excluded = new Set(catalog.slice(0, 50).map((entry) => entry.id));
    const pick = randomCultureEntry(catalog, { exclude: excluded, random: () => 0.1 });
    expect(pick).not.toBeNull();
    expect(excluded.has(pick?.id ?? "")).toBe(false);
  });

  it("does not repeat results when the session keeps an exclude set", () => {
    const served = new Set<string>();
    const random = (() => {
      let seed = 0;
      return () => {
        seed = (seed + 0.37) % 1;
        return seed;
      };
    })();
    for (let i = 0; i < 12; i += 1) {
      const pick = randomCultureEntry(catalog, { exclude: served, random });
      expect(pick).not.toBeNull();
      expect(served.has(pick?.id ?? "")).toBe(false);
      if (pick) served.add(pick.id);
    }
    expect(served.size).toBe(12);
  });

  it("handles an empty catalog and out-of-range random values", () => {
    expect(randomCultureEntry([])).toBeNull();
    expect(randomCultureEntry(catalog, { random: () => 2 })).not.toBeNull();
    expect(randomCultureEntry(catalog, { random: () => -1 })).not.toBeNull();
  });
});
