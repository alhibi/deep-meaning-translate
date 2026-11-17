import type {
  CultureArticle,
  CultureContinent,
  CultureIndexEntry,
  CultureLocale,
  LocalizedText,
} from "@/lib/culture/types";
import { COPY, fill, type CultureCopy, type CulturePeriod } from "./copy";

/**
 * Presentation helpers for the written library.
 *
 * Everything here is derived from the record itself or from Intl: a place, a language or
 * a reading-time label is never invented. Unknown identifiers are shown the way the source
 * wrote them, not guessed into something prettier.
 */

export type TextDirection = "rtl" | "ltr";

/** The three interface languages of the library, each written in its own name. */
export const LANGUAGE_NAMES: Record<CultureLocale, string> = {
  ar: "العربية",
  de: "Deutsch",
  en: "English",
};

/** Interface direction: Arabic is the only RTL interface language. */
export function directionOf(locale: CultureLocale): TextDirection {
  return locale === "ar" ? "rtl" : "ltr";
}

/** The localized string, falling back to English when a translation is missing. */
export function localized(text: LocalizedText | undefined, locale: CultureLocale): string {
  if (!text) return "";
  const value = text[locale];
  return value && value.trim() ? value : text.en || text.de || text.ar || "";
}

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "dv", "ckb", "sd", "ug"]);
const RTL_SCRIPT =
  /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Direction of a run of text: the language tag when it is a known code, otherwise the
 * script itself. Used for the native expression only — interface copy follows the locale.
 */
export function textDirection(
  text: string | undefined,
  language?: string | undefined,
): TextDirection {
  const code = language?.toLowerCase().split(/[-_]/)[0];
  if (code && RTL_LANGUAGES.has(code)) return "rtl";
  return text && RTL_SCRIPT.test(text) ? "rtl" : "ltr";
}

/** The language tag for the native expression, when it looks like a BCP-47 code. */
export function languageTag(language: string | undefined): string | undefined {
  const value = language?.trim();
  if (!value) return undefined;
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value) ? value : undefined;
}

function displayName(locale: CultureLocale, type: "region" | "language", code: string): string {
  const value = code.trim();
  if (!value) return "";
  try {
    const names = new Intl.DisplayNames([locale], { type });
    return names.of(value) ?? value;
  } catch {
    return value;
  }
}

/** Human country name for an ISO 3166-1 alpha-2 code, in the interface language. */
export function countryName(code: string, locale: CultureLocale): string {
  return displayName(locale, "region", code.toUpperCase());
}

/** Human language name for a code or name, in the interface language (best effort). */
export function languageName(code: string | undefined, locale: CultureLocale): string {
  const value = code?.trim();
  if (!value) return "";
  return displayName(locale, "language", value);
}

const listFormatters = new Map<CultureLocale, Intl.ListFormat>();
function listOf(locale: CultureLocale): Intl.ListFormat {
  const existing = listFormatters.get(locale);
  if (existing) return existing;
  const formatter = new Intl.ListFormat(locale, { type: "conjunction" });
  listFormatters.set(locale, formatter);
  return formatter;
}

/** Country names for a record, in the interface language. Unknown codes are shown as-is. */
export function countryNames(codes: readonly string[], locale: CultureLocale): string[] {
  return codes.map((code) => countryName(code, locale)).filter(Boolean);
}

/** One line of place: its countries, or the continent when it names none. */
export function placeLine(
  entry: CultureIndexEntry,
  locale: CultureLocale,
  copy: CultureCopy,
): string {
  const countries = countryNames(entry.countries, locale);
  if (countries.length) return listOf(locale).format(countries.slice(0, 3));
  return copy.continents[entry.continent];
}

/** The reading-time label ("4 min read" / "4 Min. Lesezeit" / "4 دقائق قراءة"). */
export function readingTimeLabel(minutes: number, copy: CultureCopy): string {
  return fill(copy.readingTime, { minutes: Math.max(1, Math.round(minutes)) });
}

export function categoryLabel(category: CultureIndexEntry["category"], copy: CultureCopy): string {
  return copy.categories[category];
}

export function contentTypeLabel(
  type: CultureIndexEntry["contentType"],
  copy: CultureCopy,
): string {
  return copy.types[type];
}

export function continentLabel(continent: CultureContinent, copy: CultureCopy): string {
  return copy.continents[continent];
}

export function periodLabel(period: CulturePeriod | undefined, copy: CultureCopy): string {
  if (period === "historical") return copy.periodHistorical;
  if (period === "both") return copy.periodBoth;
  if (period === "contemporary") return copy.periodContemporary;
  return "";
}

/** The context line under a reading: countries · continent · languages. */
export function contextLine(article: CultureArticle, locale: CultureLocale): string {
  const parts: string[] = [];
  const countries = countryNames(article.context.countries, locale);
  if (countries.length) parts.push(listOf(locale).format(countries.slice(0, 3)));
  if (article.context.region) parts.push(article.context.region);
  const languages = article.context.languages
    .map((code) => languageName(code, locale))
    .filter(Boolean);
  if (languages.length) parts.push(listOf(locale).format(languages.slice(0, 3)));
  return parts.join(" · ");
}

/** A stable, human key for a tag. Tags are source data; they are shown, not translated. */
export function tagLabel(tag: string): string {
  return tag.replace(/[-_]+/g, " ").trim();
}

/** The copy bundle for a locale. Small helper so components read one object. */
export function copyFor(locale: CultureLocale): CultureCopy {
  return COPY[locale];
}
