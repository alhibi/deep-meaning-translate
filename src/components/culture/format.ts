import type {
  CultureContinent,
  CultureLocale,
  CulturePlace,
  CultureProvenance,
  LocalizedText,
} from "@/lib/culture/types";
import type { CultureCopy } from "./copy";
import type { CultureListEntry } from "./contract";

/**
 * Formatting helpers for the discovery surface. Everything here is derived from the record
 * itself or from Intl: no name, place or licence is ever invented, and an unknown
 * identifier is shown exactly as the source wrote it.
 */

/** Interface direction for each language. Arabic is the only RTL interface language. */
export function directionOf(locale: CultureLocale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** The localized string, falling back to English when the corpus has no translation yet. */
export function localized(text: LocalizedText | undefined, locale: CultureLocale): string {
  if (!text) return "";
  const value = text[locale];
  return value && value.trim() ? value : text.en;
}

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "dv", "ckb", "sd", "ug"]);
const RTL_SCRIPT =
  /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Direction of a run of text: the language tag when known, otherwise its script. */
export function textDirection(
  text: string | undefined,
  language?: string | undefined,
): "rtl" | "ltr" {
  if (language) {
    const code = language.toLowerCase().split(/[-_]/)[0] ?? "";
    if (RTL_LANGUAGES.has(code)) return "rtl";
  }
  return text && RTL_SCRIPT.test(text) ? "rtl" : "ltr";
}

function displayName(locale: CultureLocale, type: "region" | "language", code: string): string {
  try {
    const names = new Intl.DisplayNames([locale], { type });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Human country name for an ISO 3166-1 alpha-2 code, in the interface language. */
export function countryName(code: string, locale: CultureLocale): string {
  const value = code.trim();
  if (!value) return "";
  return displayName(locale, "region", value.toUpperCase());
}

/** Human language name for an ISO code, in the interface language. */
export function languageName(code: string | undefined, locale: CultureLocale): string {
  const value = code?.trim();
  if (!value) return "";
  return displayName(locale, "language", value);
}

function listOf(locale: CultureLocale): Intl.ListFormat {
  return new Intl.ListFormat(locale, { type: "conjunction" });
}

/** A record's place, read out as one line: region or community, then its countries. */
export function placeLine(place: CulturePlace, locale: CultureLocale, copy: CultureCopy): string {
  const parts: string[] = [];
  if (place.region) parts.push(place.region);
  else if (place.community) parts.push(place.community);
  const countries = place.countries.map((code) => countryName(code, locale)).filter(Boolean);
  if (countries.length) parts.push(listOf(locale).format(countries));
  const continent = copy.continents[place.continent];
  if (!parts.length && continent) parts.push(continent);
  return parts.join(" · ");
}

/**
 * The place line for a compact list record: its countries in the interface language, or the
 * continent when the index records none. It never names a place the record does not carry.
 */
export function entryPlace(
  entry: CultureListEntry,
  locale: CultureLocale,
  copy: CultureCopy,
): string {
  const countries = entry.countries.map((code) => countryName(code, locale)).filter(Boolean);
  if (countries.length) return countries.slice(0, 2).join(" · ");
  return copy.continents[entry.continent];
}

const LICENSE_NAMES: Record<string, string> = {
  "CC0-1.0": "CC0 1.0",
  CC0: "CC0",
  "PDM-1.0": "Public Domain Mark 1.0",
  PD: "Public domain",
  "CC-BY-4.0": "CC BY 4.0",
  "CC-BY-3.0": "CC BY 3.0",
  "CC-BY-2.0": "CC BY 2.0",
  "CC-BY-SA-4.0": "CC BY-SA 4.0",
  "CC-BY-SA-3.0": "CC BY-SA 3.0",
  "CC-BY-NC-4.0": "CC BY-NC 4.0",
  "CC-BY-NC-SA-4.0": "CC BY-NC-SA 4.0",
  "CC-BY-ND-4.0": "CC BY-ND 4.0",
  "OGL-3.0": "Open Government Licence 3.0",
};

/**
 * Readable rights label for a licence identifier. Known identifiers are spelled out; a
 * Creative Commons identifier is spaced out mechanically; anything else stays untouched,
 * because guessing what an unknown licence permits would be a claim we cannot support.
 */
export function licenseName(identifier: string): string {
  const value = identifier.trim();
  if (!value) return "";
  const known = LICENSE_NAMES[value] ?? LICENSE_NAMES[value.toUpperCase()];
  if (known) return known;
  if (/^CC[- ]/i.test(value)) {
    return value.toUpperCase().replace(/^CC-/, "CC ").replace(/-/g, " ");
  }
  return value;
}

/** Provenance label for the reading surface: who wrote the words the reader sees. */
export function provenanceLabel(provenance: CultureProvenance, copy: CultureCopy): string {
  if (provenance === "institution") return copy.provenanceInstitution;
  if (provenance === "editorial-reviewed") return copy.provenanceEditorial;
  return copy.provenanceMachine;
}

/** Counts, read locally (Arabic-Indic digits in Arabic). */
export function formatCount(value: number, locale: CultureLocale): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

/** Convenience wrappers so components never index a copy table directly. */
export function categoryLabel(
  category: keyof CultureCopy["categories"],
  copy: CultureCopy,
): string {
  return copy.categories[category];
}

/**
 * A source's own date, read in the interface language. An unparseable value is shown as
 * written: a date we cannot read is not a date we may guess.
 */
export function formatDate(iso: string | undefined, locale: CultureLocale): string {
  const value = iso?.trim();
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  } catch {
    return value;
  }
}
