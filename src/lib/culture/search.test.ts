import { describe, expect, it } from "vitest";
import {
  normalizeSearchText,
  searchCulture,
  searchCultureItems,
  prepareCultureSearch,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
} from "./search";
import { makeEntry } from "./testing";

const catalog = [
  makeEntry("met-1", {
    title: { ar: "القهوة العربية", de: "Arabischer Kaffee", en: "Arabic coffee" },
    tags: ["قهوة", "Kaffee", "coffee"],
    category: "food-culture",
    continent: "asia",
    countries: ["SA"],
    weight: 0.9,
  }),
  makeEntry("met-2", {
    title: { ar: "قهوة", de: "Kaffee", en: "Coffee" },
    tags: ["getränk"],
    category: "food-culture",
    continent: "europe",
    countries: ["DE"],
    weight: 0.2,
  }),
  makeEntry("met-3", {
    title: { ar: "موسيقى", de: "Müller-Tradition", en: "Miller tradition" },
    tags: ["tradition", "muller"],
    category: "music",
    continent: "europe",
    countries: ["DE"],
    weight: 0.5,
  }),
  makeEntry("met-4", {
    title: { ar: "سوق", de: "Markt", en: "Market" },
    tags: ["handel"],
    category: "trade",
    continent: "africa",
    countries: ["MA"],
    weight: 0.4,
  }),
];

describe("search normalisation", () => {
  it("folds Arabic harakat, alef forms, hamza seats, alef maqsura and taa marbuta", () => {
    expect(normalizeSearchText("القَهْوَة")).toBe("القهوه");
    expect(normalizeSearchText("القهوة")).toBe("القهوه");
    expect(normalizeSearchText("أحمد")).toBe("احمد");
    expect(normalizeSearchText("إحمد")).toBe("احمد");
    expect(normalizeSearchText("آحمد")).toBe("احمد");
    expect(normalizeSearchText("ٱحمد")).toBe("احمد");
    expect(normalizeSearchText("مسؤول")).toBe("مسوول");
    expect(normalizeSearchText("شيء")).toBe("شي");
    expect(normalizeSearchText("مصطفى")).toBe("مصطفي");
    expect(normalizeSearchText("مـحـمـد")).toBe("محمد");
    expect(normalizeSearchText("١٢٣")).toBe("123");
    expect(normalizeSearchText("۱۲۳")).toBe("123");
  });

  it("folds German umlauts and ß to the forms people can type", () => {
    expect(normalizeSearchText("Müller")).toBe("muller");
    expect(normalizeSearchText("Mueller")).toBe("muller");
    expect(normalizeSearchText("MUELLER")).toBe("muller");
    expect(normalizeSearchText("Straße")).toBe("strasse");
    expect(normalizeSearchText("Strasse")).toBe("strasse");
    expect(normalizeSearchText("ÄÖÜ")).toBe("aou");
    expect(normalizeSearchText("Schön")).toBe("schon");
    expect(normalizeSearchText("Schoen")).toBe("schon");
    expect(normalizeSearchText("Muller")).toBe("muller");
  });

  it("treats punctuation as a separator and collapses whitespace", () => {
    expect(normalizeSearchText("St. Martin's")).toBe("st martin s");
    expect(normalizeSearchText("Kaffee  &   Kultur")).toBe("kaffee kultur");
    expect(normalizeSearchText("   ")).toBe("");
    expect(normalizeSearchText("")).toBe("");
  });
});

describe("culture search", () => {
  it("matches titles in every display language, whatever the query script", () => {
    expect(searchCulture(catalog, "القهوه").map((hit) => hit.entry.id)).toContain("met-1");
    expect(searchCulture(catalog, "kaffee").map((hit) => hit.entry.id)).toEqual(
      expect.arrayContaining(["met-1", "met-2"]),
    );
    expect(searchCulture(catalog, "coffee").map((hit) => hit.entry.id)).toEqual(
      expect.arrayContaining(["met-1", "met-2"]),
    );
    expect(searchCulture(catalog, "muller").map((hit) => hit.entry.id)).toEqual(["met-3"]);
    expect(searchCulture(catalog, "mueller").map((hit) => hit.entry.id)).toEqual(["met-3"]);
  });

  it("ranks exact and prefix title matches above tag matches", () => {
    const hits = searchCulture(catalog, "kaffee");
    expect(hits[0]?.entry.id).toBe("met-2"); // exact German title "Kaffee"
    expect(hits[0]?.fields).toContain("title");
    const tagOnly = hits.find((hit) => hit.entry.id === "met-4");
    expect(tagOnly).toBeUndefined();
  });

  it("requires every query token to match somewhere (AND, not OR)", () => {
    const both = [
      makeEntry("met-9", {
        title: { ar: "سوق", de: "Markt", en: "Market" },
        tags: ["kaffee", "marokko"],
      }),
    ];
    expect(searchCulture(both, "kaffee marokko")).toHaveLength(1);
    expect(searchCulture(both, "kaffee tunesien")).toHaveLength(0);
    expect(searchCulture(catalog, "kaffee marokko")).toHaveLength(0);
  });

  it("uses the editorial weight to break ties between equally matched records", () => {
    const rows = [
      makeEntry("met-low", {
        title: { ar: "تراث", de: "Erbe", en: "Heritage" },
        tags: ["berber"],
        weight: 0.1,
      }),
      makeEntry("met-high", {
        title: { ar: "تراث", de: "Erbe", en: "Heritage" },
        tags: ["berber"],
        weight: 0.9,
      }),
    ];
    expect(searchCulture(rows, "berber").map((hit) => hit.entry.id)).toEqual([
      "met-high",
      "met-low",
    ]);
  });

  it("searches the subject only when the caller can supply it", () => {
    const subjects = new Map([["met-4", "Regenwald und Handelswege"]]);
    expect(searchCulture(catalog, "regenwald")).toEqual([]);
    const withSubjects = searchCulture(catalog, "regenwald", {
      subjects: (id) => subjects.get(id),
    });
    expect(withSubjects).toHaveLength(1);
    expect(withSubjects[0]?.entry.id).toBe("met-4");
    expect(withSubjects[0]?.fields).toContain("subject");
  });

  it("returns nothing for an empty query and is deterministic", () => {
    expect(searchCulture(catalog, "")).toEqual([]);
    expect(searchCulture(catalog, "   ")).toEqual([]);
    expect(searchCulture(catalog, "tradition").map((hit) => hit.entry.id)).toEqual(
      searchCulture(catalog, "tradition").map((hit) => hit.entry.id),
    );
    expect(searchCulture(catalog, "zzzzz")).toEqual([]);
  });

  it("bounds the result list even when many records match", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      makeEntry(`met-${String(i)}`, {
        title: { ar: "قهوة", de: "Kaffee", en: "Coffee" },
        tags: ["kaffee"],
        weight: (i % 10) / 10,
      }),
    );
    expect(searchCulture(many, "kaffee")).toHaveLength(SEARCH_DEFAULT_LIMIT);
    expect(searchCulture(many, "kaffee", { limit: 5 })).toHaveLength(5);
    expect(searchCulture(many, "kaffee", { limit: 999 })).toHaveLength(SEARCH_MAX_LIMIT);
  });

  it("prepares a reusable matcher that returns the same order as the shortcut", () => {
    const prepared = prepareCultureSearch(catalog);
    expect(prepared.search("kaffee").map((hit) => hit.entry.id)).toEqual(
      searchCulture(catalog, "kaffee").map((hit) => hit.entry.id),
    );
  });
});

describe("culture item search", () => {
  const item = (id: string, title: string, tags: string[], subject?: string) => ({
    id,
    title: { ar: title, de: title, en: title },
    tags,
    ...(subject === undefined ? {} : { subject }),
  });

  it("ranks titles over tags over subjects", () => {
    const rows = [
      item("subject", "Markt", ["handel"], "Kaffee"),
      item("tag", "Markt", ["kaffee"]),
      item("title", "Kaffee", ["getrank"]),
    ];
    expect(searchCultureItems(rows, "kaffee").map((row) => row.id)).toEqual([
      "title",
      "tag",
      "subject",
    ]);
  });

  it("is bounded, diacritic-insensitive and empty for no query", () => {
    const rows = [item("a", "Müller", []), item("b", "Muller", [])];
    // Both fold to the same title; the stable tie-break is the id.
    expect(searchCultureItems(rows, "muller").map((row) => row.id)).toEqual(["a", "b"]);
    expect(searchCultureItems(rows, "")).toEqual([]);
    expect(searchCultureItems(rows, "muller", 1)).toHaveLength(1);
  });
});
