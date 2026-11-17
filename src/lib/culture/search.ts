/**
 * Culture search (Phase II): fast, local and diacritic-insensitive.
 *
 * The compact index is small enough to scan in memory, so there is no external service
 * and no server round-trip: a query is normalised once and matched against the three
 * display titles, the tags, and (when the caller supplies it from a loaded detail chunk)
 * the item's source subject. Ranking is field weight first, editorial weight second, id
 * last so a result list is deterministic.
 *
 * Normalisation is deliberately lossy in the one direction that helps a person find a
 * record they cannot spell:
 * - Unicode NFKD, lowercase, combining marks removed (German umlauts, Arabic harakat,
 *   decomposed input all fold to one form);
 * - Arabic: alef variants (آ أ إ ٱ) → ا, alef maqsura ى → ي, ؤ → و, ئ → ي, ة → ه,
 *   standalone hamza removed, tatweel removed, Arabic-Indic digits → ASCII
 *   (the same mapping the Lucene Arabic normalizer uses);
 * - German: ß → ss and the digraph spellings ae/oe/ue fold to ä/ö/ü's base letters, so
 *   "Mueller", "Müller" and "mueller" are one query;
 * - everything that is not a letter or digit becomes a separator.
 *
 * The compact `CultureIndexEntry` does not carry `subject`; the search accepts an
 * optional subject lookup so a caller that has detail data gets that field too. Subject
 * hits rank below title and tag hits, never above them.
 */
import type { CultureIndexEntry } from "./types";

export type CultureSearchField = "title" | "tags" | "subject";

export interface CultureSearchHit {
  entry: CultureIndexEntry;
  score: number;
  /** Fields that matched at least one query token, strongest first. */
  fields: CultureSearchField[];
}

export interface CultureSearchOptions {
  /** Bounded result count; defaults to `SEARCH_DEFAULT_LIMIT`, capped at `SEARCH_MAX_LIMIT`. */
  limit?: number | undefined;
  /**
   * Resolve a record's source subject (only known after the detail chunk is loaded).
   * omit and subject text is simply not searched.
   */
  subjects?: ((id: string) => string | undefined) | undefined;
}

export const SEARCH_DEFAULT_LIMIT = 24;
export const SEARCH_MAX_LIMIT = 60;

/* ------------------------------------------------------------------ normalisation */

const ARABIC_ALEF = /[\u0622\u0623\u0625\u0671]/g;
const ARABIC_HARAKAT = /[\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;
const EXTENDED_ARABIC_DIGITS = /[\u06f0-\u06f9]/g;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

const arabicDigit = (ch: string): string => String(ch.charCodeAt(0) - 0x0660);
const extendedArabicDigit = (ch: string): string => String(ch.charCodeAt(0) - 0x06f0);

/**
 * Fold one string to the form used for matching and for building prepared haystacks.
 * Empty/whitespace input folds to `""`.
 */
export function normalizeSearchText(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  let text = input.normalize("NFKD").toLowerCase();
  // Combining marks carry the umlaut dots and the Arabic vowel marks; the base letter stays.
  text = text.replace(/\p{M}+/gu, "");
  text = text.replace(ARABIC_HARAKAT, "");
  text = text.replace(ARABIC_ALEF, "\u0627");
  text = text.replace(/\u0624/g, "\u0648"); // ؤ → و
  text = text.replace(/\u0626/g, "\u064a"); // ئ → ي
  text = text.replace(/\u0621/g, ""); // standalone hamza carries no consonant of its own
  text = text.replace(/\u0649/g, "\u064a"); // ى → ي
  text = text.replace(/\u0629/g, "\u0647"); // ة → ه (Lucene Arabic normalizer)
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
  /** Normalised tags joined by a space; a query token matches any single tag. */
  tagText: string;
  tagTokens: string[];
}

const preparedCache = new WeakMap<readonly CultureIndexEntry[], PreparedEntry[]>();

function prepareEntry(entry: CultureIndexEntry): PreparedEntry {
  const titles: string[] = [];
  for (const value of [entry.title.ar, entry.title.de, entry.title.en]) {
    const normalized = normalizeSearchText(value);
    if (normalized && !titles.includes(normalized)) titles.push(normalized);
  }
  const tagTokens: string[] = [];
  for (const tag of entry.tags) {
    const normalized = normalizeSearchText(tag);
    if (normalized && !tagTokens.includes(normalized)) tagTokens.push(normalized);
  }
  return { entry, titles, tagText: tagTokens.join(" "), tagTokens };
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
const SUBJECT_TOKEN = 5;
const EDITORIAL_WEIGHT_FACTOR = 12;
const MEDIA_BONUS = 1;

function scoreOne(
  prepared: PreparedEntry,
  query: string,
  tokens: readonly string[],
  subject: string | undefined,
): { score: number; fields: CultureSearchField[] } | null {
  const titlePhrase = prepared.titles.some((title) => title.includes(query));
  const titleExact = prepared.titles.some((title) => title === query);
  const titlePrefix = prepared.titles.some((title) => title.startsWith(query));
  let titleTokenMatches = 0;
  let tagMatches = 0;
  let subjectMatches = 0;
  for (const token of tokens) {
    if (prepared.titles.some((title) => title.includes(token))) titleTokenMatches += 1;
    if (prepared.tagTokens.some((tag) => tag.includes(token))) tagMatches += 1;
    if (subject && subject.includes(token)) subjectMatches += 1;
  }
  // Every token must be found somewhere (AND semantics): "kaffee marokko" does not
  // match a coffee record that never mentions Morocco.
  if (titleTokenMatches === 0 && tagMatches === 0 && subjectMatches === 0) return null;
  for (const token of tokens) {
    const inTitle = prepared.titles.some((title) => title.includes(token));
    const inTags = prepared.tagTokens.some((tag) => tag.includes(token));
    const inSubject = subject ? subject.includes(token) : false;
    if (!inTitle && !inTags && !inSubject) return null;
  }
  let score = 0;
  if (titleExact) score += TITLE_EXACT;
  else if (titlePrefix) score += TITLE_PREFIX;
  else if (titlePhrase) score += TITLE_PHRASE;
  score += titleTokenMatches * TITLE_TOKEN;
  score += tagMatches * TAG_TOKEN;
  score += subjectMatches * SUBJECT_TOKEN;
  score += Math.round(prepared.entry.weight * EDITORIAL_WEIGHT_FACTOR);
  if (prepared.entry.hasMedia) score += MEDIA_BONUS;
  const fields: CultureSearchField[] = [];
  if (titleTokenMatches > 0 || titlePhrase) fields.push("title");
  if (tagMatches > 0) fields.push("tags");
  if (subjectMatches > 0) fields.push("subject");
  return { score, fields };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return SEARCH_DEFAULT_LIMIT;
  return Math.min(SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/* ---------------------------------------------------------------------- public API */

export interface CultureSearchIndex {
  /** Ranked hits for a raw query string; `[]` for an empty query. */
  search(query: string, options?: CultureSearchOptions): CultureSearchHit[];
}

function rank(
  entries: readonly CultureIndexEntry[],
  query: string,
  options: CultureSearchOptions,
): CultureSearchHit[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const tokens = searchTokens(normalized);
  const prepared = preparedFor(entries);
  const subjects = options.subjects;
  const hits: CultureSearchHit[] = [];
  for (const candidate of prepared) {
    const subject = subjects ? normalizeSearchText(subjects(candidate.entry.id) ?? "") : "";
    const scored = scoreOne(candidate, normalized, tokens, subject || undefined);
    if (scored) hits.push({ entry: candidate.entry, score: scored.score, fields: scored.fields });
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
 * Rank every matching record without a result cap. The discovery feed pages through this
 * order, so it must be complete; interactive search must use `searchCulture`, which is
 * bounded (requirement: no unbounded result list reaches the UI).
 */
export function rankCultureEntries(
  entries: readonly CultureIndexEntry[],
  query: string,
  options: Pick<CultureSearchOptions, "subjects"> = {},
): CultureSearchHit[] {
  return rank(entries, query, options);
}

/** Build (and cache per index array) the prepared matcher for one compact index. */
export function prepareCultureSearch(entries: readonly CultureIndexEntry[]): CultureSearchIndex {
  return {
    search(query: string, options: CultureSearchOptions = {}) {
      return rank(entries, query, options).slice(0, clampLimit(options.limit));
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

/**
 * Rank full item bodies (detail chunks) by title/tags/subject. Used where the UI already
 * has bodies loaded and wants the same ordering over a smaller set; returns items, not
 * score rows, so a caller never re-derives the result.
 */
export function searchCultureItems<
  T extends {
    id: string;
    title: { ar: string; de: string; en: string };
    tags: string[];
    subject?: string | undefined;
  },
>(items: readonly T[], query: string, limit = SEARCH_DEFAULT_LIMIT): T[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const prepared = items.map((item) => ({
    title: [item.title.ar, item.title.de, item.title.en].map(normalizeSearchText),
    tags: item.tags.map(normalizeSearchText).filter(Boolean),
    subject: normalizeSearchText(item.subject ?? ""),
  }));
  const scored = items
    .map((item, i) => {
      const row = prepared[i];
      if (!row) return null;
      const tokens = searchTokens(normalized);
      let score = 0;
      for (const token of tokens) {
        const title = row.title.some((value) => value.includes(token));
        const tag = row.tags.some((value) => value.includes(token));
        const subject = row.subject.includes(token);
        if (!title && !tag && !subject) return null;
        if (title) score += TITLE_TOKEN;
        if (tag) score += TAG_TOKEN;
        if (subject) score += SUBJECT_TOKEN;
      }
      if (row.title.some((value) => value === normalized)) score += TITLE_EXACT;
      else if (row.title.some((value) => value.startsWith(normalized))) score += TITLE_PREFIX;
      return { item, score };
    })
    .filter((row): row is { item: (typeof items)[number]; score: number } => row !== null);
  scored.sort(
    (a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0),
  );
  return scored.slice(0, clampLimit(limit)).map((row) => row.item);
}
