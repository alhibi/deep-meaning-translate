/**
 * Culture search (schema v2): fast, local, diacritic-insensitive.
 *
 * The compact index is small enough to scan in memory, so there is no external service and
 * no server round-trip: a query is normalised once and matched against the three display
 * titles, the three teaser lines and the tags of every article. Ranking is field weight
 * first (title > tags > teaser), editorial weight second and id last, so a result list is
 * deterministic and the same order is returned for the same index array.
 *
 * Normalisation is deliberately lossy in the one direction that helps a person find an
 * article they cannot spell:
 * - Unicode NFKD, lowercase, combining marks removed (German umlauts, Arabic harakat,
 *   decomposed input all fold to one form);
 * - Arabic: alef variants (ا آ أ إ ٱ) -> ا, alef maqsura ى -> ي, ؤ -> و, ئ -> ي,
 *   taa marbuta ة -> ه, standalone hamza removed, tatweel removed, Arabic-Indic digits -> ASCII;
 * - German: ß -> ss and the digraph spellings ae/oe/ue fold to the umlaut base letters, so
 *   "Mueller", "Müller" and "mueller" are one query;
 * - everything that is not a letter or digit becomes a separator.
 *
 * The folded string is never shown; it only decides whether an article is a hit.
 */
import type { CultureIndexEntry } from "./types";

export type CultureSearchField = "title" | "tags" | "teaser";

export interface CultureSearchHit {
  entry: CultureIndexEntry;
  score: number;
  /** Fields that matched at least one query token, strongest first. */
  fields: CultureSearchField[];
}

export interface CultureSearchOptions {
  /** Bounded result count; defaults to SEARCH_DEFAULT_LIMIT, capped at SEARCH_MAX_LIMIT. */
  limit?: number | undefined;
}

export const SEARCH_DEFAULT_LIMIT = 24;
export const SEARCH_MAX_LIMIT = 60;

/* ------------------------------------------------------------------ normalisation */

const ARABIC_ALEF = /[\u0622\u0623\u0625\u0671]/g;
const ARABIC_HARAKAT = /[\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;
const EXTENDED_ARABIC_DIGITS = /[\u06f0-\u06f9]/g;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

const arabicDigit = (character: string): string => String(character.charCodeAt(0) - 0x0660);
const extendedArabicDigit = (character: string): string => String(character.charCodeAt(0) - 0x06f0);

/**
 * Fold one string to the form used for matching and for building prepared haystacks.
 * Empty/whitespace input folds to "".
 */
export function normalizeSearchText(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  let text = input.normalize("NFKD").toLowerCase();
  // Combining marks carry the umlaut dots and the Arabic vowel marks; the base letter stays.
  text = text.replace(/\p{M}+/gu, "");
  text = text.replace(ARABIC_HARAKAT, "");
  text = text.replace(ARABIC_ALEF, "\u0627");
  text = text.replace(/\u0624/g, "\u0648"); // ؤ -> و
  text = text.replace(/\u0626/g, "\u064a"); // ئ -> ي
  text = text.replace(/\u0621/g, ""); // standalone hamza carries no consonant of its own
  text = text.replace(/\u0649/g, "\u064a"); // ى -> ي
  text = text.replace(/\u0629/g, "\u0647"); // ة -> ه
  text = text.replace(/\u0640/g, ""); // tatweel
  text = text.replace(ARABIC_DIGITS, arabicDigit);
  text = text.replace(EXTENDED_ARABIC_DIGITS, extendedArabicDigit);
  text = text.replace(/ß/g, "ss");
  text = text.replace(/ae/g, "a");
  text = text.replace(/oe/g, "o");
  text = text.replace(/ue/g, "u");
  return text.replace(NON_WORD, " ").trim();
}

/** Split a normalised string into the tokens a query is matched by. */
export function searchTokens(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean);
}

/* --------------------------------------------------------------- prepared index */

interface PreparedEntry {
  entry: CultureIndexEntry;
  /** One normalised title per display language, kept separate for phrase bonuses. */
  titles: string[];
  /** One normalised teaser per display language. */
  teasers: string[];
  /** One normalised string per tag. */
  tagTokens: string[];
}

const preparedCache = new WeakMap<readonly CultureIndexEntry[], PreparedEntry[]>();

function pushUnique(list: string[], value: string): void {
  if (value && !list.includes(value)) list.push(value);
}

function prepareEntry(entry: CultureIndexEntry): PreparedEntry {
  const titles: string[] = [];
  for (const value of [entry.title.ar, entry.title.de, entry.title.en]) {
    pushUnique(titles, normalizeSearchText(value));
  }
  const teasers: string[] = [];
  for (const value of [entry.teaser.ar, entry.teaser.de, entry.teaser.en]) {
    pushUnique(teasers, normalizeSearchText(value));
  }
  const tagTokens: string[] = [];
  for (const tag of entry.tags) pushUnique(tagTokens, normalizeSearchText(tag));
  return { entry, titles, teasers, tagTokens };
}

function preparedFor(entries: readonly CultureIndexEntry[]): PreparedEntry[] {
  const cached = preparedCache.get(entries);
  if (cached) return cached;
  const prepared = entries.map(prepareEntry);
  preparedCache.set(entries, prepared);
  return prepared;
}

/* ---------------------------------------------------------------------- scoring */

const TITLE_EXACT = 90;
const TITLE_PREFIX = 55;
const TITLE_PHRASE = 38;
const TITLE_TOKEN = 14;
const TAG_TOKEN = 8;
const TEASER_TOKEN = 4;
const EDITORIAL_WEIGHT_FACTOR = 12;

function scoreOne(
  prepared: PreparedEntry,
  query: string,
  tokens: readonly string[],
): { score: number; fields: CultureSearchField[] } | null {
  const titlePhrase = prepared.titles.some((title) => title.includes(query));
  const titleExact = prepared.titles.some((title) => title === query);
  const titlePrefix = prepared.titles.some((title) => title.startsWith(query));
  let titleTokenMatches = 0;
  let tagMatches = 0;
  let teaserMatches = 0;
  for (const token of tokens) {
    const inTitle = prepared.titles.some((title) => title.includes(token));
    const inTags = prepared.tagTokens.some((tag) => tag.includes(token));
    const inTeaser = prepared.teasers.some((teaser) => teaser.includes(token));
    // Every token must be found somewhere (AND semantics): a hit is an article that could
    // plausibly be what the person meant, not a page of weakly related records.
    if (!inTitle && !inTags && !inTeaser) return null;
    if (inTitle) titleTokenMatches += 1;
    if (inTags) tagMatches += 1;
    if (inTeaser) teaserMatches += 1;
  }
  let score = 0;
  if (titleExact) score += TITLE_EXACT;
  else if (titlePrefix) score += TITLE_PREFIX;
  else if (titlePhrase) score += TITLE_PHRASE;
  score += titleTokenMatches * TITLE_TOKEN;
  score += tagMatches * TAG_TOKEN;
  score += teaserMatches * TEASER_TOKEN;
  score += Math.round(prepared.entry.weight * EDITORIAL_WEIGHT_FACTOR);
  const fields: CultureSearchField[] = [];
  if (titleTokenMatches > 0) fields.push("title");
  if (tagMatches > 0) fields.push("tags");
  if (teaserMatches > 0) fields.push("teaser");
  return { score, fields };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return SEARCH_DEFAULT_LIMIT;
  return Math.min(SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function rank(
  entries: readonly CultureIndexEntry[],
  query: string,
  options: CultureSearchOptions,
): CultureSearchHit[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const tokens = searchTokens(normalized);
  const hits: CultureSearchHit[] = [];
  for (const prepared of preparedFor(entries)) {
    const scored = scoreOne(prepared, normalized, tokens);
    if (scored) hits.push({ entry: prepared.entry, score: scored.score, fields: scored.fields });
  }
  // Deterministic order: score, then the record's documented editorial emphasis, then id.
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      b.entry.weight - a.entry.weight ||
      (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0),
  );
  return hits;
}

/**
 * Rank every matching record without a result cap. The discovery feed pages through a
 * filtered selection, so it must be complete; interactive search uses searchCulture, which
 * is bounded (no unbounded result list reaches the UI).
 */
export function rankCultureEntries(
  entries: readonly CultureIndexEntry[],
  query: string,
): CultureSearchHit[] {
  return rank(entries, query, {});
}

export interface CultureSearchIndex {
  /** Ranked hits for a raw query string; [] for an empty query. */
  search(query: string, options?: CultureSearchOptions): CultureSearchHit[];
}

/** Build (and cache per index array) the prepared matcher for one compact index. */
export function prepareCultureSearch(entries: readonly CultureIndexEntry[]): CultureSearchIndex {
  const prepared = preparedFor(entries);
  return {
    search(query: string, options: CultureSearchOptions = {}) {
      const normalized = normalizeSearchText(query);
      if (!normalized) return [];
      const tokens = searchTokens(normalized);
      const hits: CultureSearchHit[] = [];
      for (const candidate of prepared) {
        const scored = scoreOne(candidate, normalized, tokens);
        if (scored) {
          hits.push({
            entry: candidate.entry,
            score: scored.score,
            fields: scored.fields,
          });
        }
      }
      hits.sort(
        (a, b) =>
          b.score - a.score ||
          b.entry.weight - a.entry.weight ||
          (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0),
      );
      return hits.slice(0, clampLimit(options.limit));
    },
  };
}

const preparedIndexes = new WeakMap<readonly CultureIndexEntry[], CultureSearchIndex>();

/** Convenience wrapper: search one compact index with the cached prepared matcher. */
export function searchCulture(
  entries: readonly CultureIndexEntry[],
  query: string,
  options: CultureSearchOptions = {},
): CultureSearchHit[] {
  let index = preparedIndexes.get(entries);
  if (!index) {
    index = prepareCultureSearch(entries);
    preparedIndexes.set(entries, index);
  }
  return index.search(query, options);
}
