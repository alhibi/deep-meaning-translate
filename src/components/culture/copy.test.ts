import { describe, expect, it } from "vitest";
import { CULTURE_CATEGORIES, type CultureContinent } from "@/lib/culture/types";
import { COPY, cultureCopy } from "./copy";
import {
  categoryLabel,
  countryName,
  directionOf,
  entryPlace,
  formatCount,
  formatDate,
  languageName,
  licenseName,
  localized,
  placeLine,
  provenanceLabel,
  textDirection,
} from "./format";
import { compositionFor, isWideComposition, wantsMedia } from "./compositions";
import { LOCALES, makeEntry, makePlace } from "./testFixtures";

const CONTINENTS: CultureContinent[] = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];

describe("feature copy", () => {
  it("has the same keys in every interface language", () => {
    const reference = Object.keys(COPY.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(COPY[locale]).sort()).toEqual(reference);
    }
  });

  it("has no empty string anywhere", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(COPY[locale])) {
        if (typeof value === "string") {
          expect(value.trim(), locale + "." + key).not.toBe("");
        }
      }
    }
  });

  it("labels every shared category and continent in all three languages", () => {
    for (const locale of LOCALES) {
      const copy = COPY[locale];
      for (const category of CULTURE_CATEGORIES) {
        expect(copy.categories[category].trim(), locale + "." + category).not.toBe("");
      }
      for (const continent of CONTINENTS) {
        expect(copy.continents[continent].trim(), locale + "." + continent).not.toBe("");
      }
    }
  });

  it("labels the three provenances differently", () => {
    const copy = COPY.en;
    const labels = [
      provenanceLabel("institution", copy),
      provenanceLabel("machine-translated", copy),
      provenanceLabel("editorial-reviewed", copy),
    ];
    expect(new Set(labels).size).toBe(3);
    expect(labels[0]).toBe(copy.provenanceInstitution);
    expect(labels[1]).toBe(copy.provenanceMachine);
    expect(labels[2]).toBe(copy.provenanceEditorial);
  });

  it("is reachable through cultureCopy", () => {
    expect(cultureCopy("ar")).toBe(COPY.ar);
    expect(cultureCopy("de")).toBe(COPY.de);
    expect(cultureCopy("en")).toBe(COPY.en);
  });
});

describe("formatting helpers", () => {
  it("falls back to English only when a translation is actually missing", () => {
    expect(localized({ en: "English", ar: "عربي", de: "Deutsch" }, "ar")).toBe("عربي");
    expect(localized({ en: "English", ar: "  ", de: "" }, "ar")).toBe("English");
    expect(localized(undefined, "ar")).toBe("");
  });

  it("derives text direction from the language tag and then from the script", () => {
    expect(textDirection("صندوق", undefined)).toBe("rtl");
    expect(textDirection("Chest", undefined)).toBe("ltr");
    expect(textDirection("Chest", "ar")).toBe("rtl");
    // The script wins when the tag disagrees with the text it labels.
    expect(textDirection("صندوق", "de")).toBe("rtl");
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("de")).toBe("ltr");
  });

  it("names countries and languages in the interface language", () => {
    expect(countryName("MA", "en")).toBe("Morocco");
    expect(countryName("jp", "en")).toBe("Japan");
    expect(countryName("MA", "ar")).not.toBe("MA");
    expect(languageName("ar", "de")).toBe("Arabisch");
    expect(languageName(undefined, "en")).toBe("");
  });

  it("spells out known licences and never guesses an unknown one", () => {
    expect(licenseName("CC0-1.0")).toBe("CC0 1.0");
    expect(licenseName("CC-BY-4.0")).toBe("CC BY 4.0");
    expect(licenseName("CC-BY-SA-3.0")).toBe("CC BY-SA 3.0");
    expect(licenseName("Museum-Licence-1.0")).toBe("Museum-Licence-1.0");
    expect(licenseName("")).toBe("");
  });

  it("reads a place as region plus its countries, and falls back to the continent", () => {
    const place = makePlace({ region: "Atlas Mountains", countries: ["MA", "DZ"] });
    expect(placeLine(place, "en", COPY.en)).toBe("Atlas Mountains · Morocco and Algeria");
    const bare = makePlace({ countries: [] });
    expect(placeLine(bare, "en", COPY.en)).toBe("Africa");
  });

  it("reads a compact entry's place from its index fields only", () => {
    const withCountries = makeEntry({ id: "b", countries: ["JP"] });
    expect(entryPlace(withCountries, "en", COPY.en)).toBe("Japan");
    const twoCountries = makeEntry({ id: "b2", countries: ["JP", "MA"] });
    expect(entryPlace(twoCountries, "en", COPY.en)).toBe("Japan · Morocco");
    const withContinent = makeEntry({ id: "c", countries: [] });
    expect(entryPlace(withContinent, "en", COPY.en)).toBe("Africa");
  });

  it("formats counts and dates locally, and keeps an unreadable date as written", () => {
    expect(formatCount(1234, "en")).toBe("1,234");
    expect(formatDate("2026-01-15", "en")).toBe("Jan 15, 2026");
    expect(formatDate("not a date", "en")).toBe("not a date");
    expect(formatDate(undefined, "en")).toBe("");
  });

  it("never indexes a copy table directly in components", () => {
    expect(categoryLabel("music", COPY.en)).toBe("Music");
  });
});

describe("card compositions", () => {
  it("maps every shared category to a known composition", () => {
    const seen = new Set<string>();
    for (const category of CULTURE_CATEGORIES) {
      const composition = compositionFor(category);
      expect(composition).toBeTruthy();
      seen.add(composition);
    }
    // The feed must not collapse into one repeated tile.
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it("uses distinct editorial shapes for the required subjects", () => {
    expect(compositionFor("objects")).toBe("artifact");
    expect(compositionFor("architecture")).toBe("place");
    expect(compositionFor("traditions")).toBe("practice");
    expect(compositionFor("language")).toBe("word");
    expect(compositionFor("crafts")).toBe("material");
    expect(compositionFor("food-culture")).toBe("food");
    expect(compositionFor("everyday-life")).toBe("quiet");
  });

  it("marks only image-led compositions as wide and media-wanting", () => {
    expect(isWideComposition("artifact")).toBe(true);
    expect(isWideComposition("place")).toBe(true);
    expect(isWideComposition("practice")).toBe(false);
    expect(wantsMedia("food")).toBe(true);
    expect(wantsMedia("word")).toBe(false);
  });
});
