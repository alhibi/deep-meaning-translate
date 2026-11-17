import { describe, expect, it } from "vitest";
import {
  normalizeSearchText,
  prepareCultureSearch,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  searchCulture,
  searchTokens,
} from "./search";
import { localized, makeCultureEntry } from "./testing";

const catalog = [
  makeCultureEntry("culture-coffee", {
    title: { ar: "القهوة العربية", de: "Arabischer Kaffee", en: "Arabic coffee" },
    teaser: localized("coffee-teaser"),
    tags: ["قهوة", "Kaffee", "coffee"],
    category: "food-and-hospitality",
    continent: "asia",
    countries: ["SA"],
    weight: 0.9,
  }),
  makeCultureEntry("culture-coffee-short", {
    title: { ar: "قهوة", de: "Kaffee", en: "Coffee" },
    teaser: localized("drink-teaser"),
    tags: ["getrank"],
    category: "food-and-hospitality",
    continent: "europe",
    countries: ["DE"],
    weight: 0.2,
  }),
  makeCultureEntry("culture-mueller", {
    title: { ar: "موسيقى", de: "Müller-Tradition", en: "Miller tradition" },
    teaser: localized("muller-teaser"),
    tags: ["tradition", "muller"],
    category: "music-and-dance",
    continent: "europe",
    countries: ["DE"],
    weight: 0.5,
  }),
  makeCultureEntry("culture-market", {
    title: { ar: "سوق", de: "Markt", en: "Market" },
    teaser: localized("handel-teaser"),
    tags: ["handel"],
    category: "cities-and-community",
    continent: "africa",
    countries: ["MA"],
    weight: 0.4,
  }),
];

describe("culture search normalisation", () => {
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

  it("folds German umlauts and eszett to the forms people can type", () => {
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
    expect(searchTokens("kaffee kultur")).toEqual(["kaffee", "kultur"]);
  });
});

describe("culture search ranking", () => {
  it("matches titles in every display language, whatever the query script", () => {
    expect(searchCulture(catalog, "القهوه").map((hit) => hit.entry.id)).toContain("culture-coffee");
    expect(searchCulture(catalog, "kaffee").map((hit) => hit.entry.id)).toEqual(
      expect.arrayContaining(["culture-coffee", "culture-coffee-short"]),
    );
    expect(searchCulture(catalog, "coffee").map((hit) => hit.entry.id)).toEqual(
      expect.arrayContaining(["culture-coffee", "culture-coffee-short"]),
    );
    expect(searchCulture(catalog, "muller").map((hit) => hit.entry.id)).toEqual([
      "culture-mueller",
    ]);
    expect(searchCulture(catalog, "mueller").map((hit) => hit.entry.id)).toEqual([
      "culture-mueller",
    ]);
    expect(searchCulture(catalog, "strasse")).toEqual([]);
  });

  it("finds records through their teaser when the title does not mention the query", () => {
    const rows = [
      makeCultureEntry("culture-a", {
        title: { ar: "سوق", de: "Markt", en: "Market" },
        teaser: { ar: "قهوة الصباح", de: "Kaffee am Morgen", en: "Morning coffee" },
        tags: [],
      }),
    ];
    expect(searchCulture(rows, "kaffee").map((hit) => hit.entry.id)).toEqual(["culture-a"]);
    expect(searchCulture(rows, "قهوة").map((hit) => hit.entry.id)).toEqual(["culture-a"]);
    expect(searchCulture(rows, "kaffee")[0]?.fields).toContain("teaser");
  });

  it("ranks title over tags over teaser", () => {
    const rows = [
      makeCultureEntry("culture-teaser", {
        title: { ar: "سوق", de: "Markt", en: "Market" },
        teaser: { ar: "كافيه", de: "Kaffee am Morgen", en: "Morning coffee" },
        tags: [],
      }),
      makeCultureEntry("culture-tag", {
        title: { ar: "سوق", de: "Markt", en: "Market" },
        teaser: { ar: "سوق", de: "Markt", en: "Market" },
        tags: ["kaffee"],
      }),
      makeCultureEntry("culture-title", {
        title: { ar: "قهوة", de: "Kaffee", en: "Coffee" },
        teaser: { ar: "مشروب", de: "Getrank", en: "Drink" },
        tags: [],
      }),
    ];
    expect(searchCulture(rows, "kaffee").map((hit) => hit.entry.id)).toEqual([
      "culture-title",
      "culture-tag",
      "culture-teaser",
    ]);
  });

  it("requires every query token to match somewhere (AND, not OR)", () => {
    const rows = [
      makeCultureEntry("culture-both", {
        title: { ar: "سوق", de: "Markt", en: "Market" },
        teaser: localized("teaser"),
        tags: ["kaffee", "marokko"],
      }),
    ];
    expect(searchCulture(rows, "kaffee marokko")).toHaveLength(1);
    expect(searchCulture(rows, "kaffee tunesien")).toHaveLength(0);
    expect(searchCulture(catalog, "kaffee marokko")).toHaveLength(0);
  });

  it("uses the editorial weight to break ties between equally matched records", () => {
    const rows = [
      makeCultureEntry("culture-low", {
        title: { ar: "تراث", de: "Erbe", en: "Heritage" },
        teaser: localized("heritage"),
        tags: ["berber"],
        weight: 0.1,
      }),
      makeCultureEntry("culture-high", {
        title: { ar: "تراث", de: "Erbe", en: "Heritage" },
        teaser: localized("heritage"),
        tags: ["berber"],
        weight: 0.9,
      }),
    ];
    expect(searchCulture(rows, "berber").map((hit) => hit.entry.id)).toEqual([
      "culture-high",
      "culture-low",
    ]);
  });

  it("returns nothing for an empty query and is deterministic", () => {
    expect(searchCulture(catalog, "")).toEqual([]);
    expect(searchCulture(catalog, "   ")).toEqual([]);
    expect(searchCulture(catalog, "zzzzz")).toEqual([]);
    expect(searchCulture(catalog, "kaffee").map((hit) => hit.entry.id)).toEqual(
      searchCulture(catalog, "kaffee").map((hit) => hit.entry.id),
    );
  });

  it("bounds the result list even when many records match", () => {
    const many = Array.from({ length: 100 }, (_, index) =>
      makeCultureEntry("culture-" + String(index), {
        title: { ar: "قهوة", de: "Kaffee", en: "Coffee" },
        teaser: localized("coffee"),
        tags: ["kaffee"],
        weight: (index % 10) / 10,
      }),
    );
    expect(searchCulture(many, "kaffee")).toHaveLength(SEARCH_DEFAULT_LIMIT);
    expect(searchCulture(many, "kaffee", { limit: 5 })).toHaveLength(5);
    expect(searchCulture(many, "kaffee", { limit: 999 })).toHaveLength(SEARCH_MAX_LIMIT);
    expect(searchCulture(many, "kaffee", { limit: 0 })).toHaveLength(1);
  });

  it("prepares a reusable matcher that returns the same order as the shortcut", () => {
    const prepared = prepareCultureSearch(catalog);
    expect(prepared.search("kaffee").map((hit) => hit.entry.id)).toEqual(
      searchCulture(catalog, "kaffee").map((hit) => hit.entry.id),
    );
    expect(prepared.search("")).toEqual([]);
  });

  it("matches a query token inside a multi-word tag and vice versa", () => {
    const rows = [
      makeCultureEntry("culture-tagphrase", {
        title: { ar: "سوق", de: "Markt", en: "Market" },
        teaser: localized("market"),
        tags: ["arabische kaffee kultur"],
      }),
    ];
    expect(searchCulture(rows, "kaffee").map((hit) => hit.entry.id)).toEqual(["culture-tagphrase"]);
    expect(searchCulture(rows, "arabische kaffee").map((hit) => hit.entry.id)).toEqual([
      "culture-tagphrase",
    ]);
  });
});
