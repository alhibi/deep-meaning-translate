/**
 * Shared cultural-discovery contract (Phase II).
 *
 * Content is sourced, licensed and traceable. Every display record carries its provenance;
 * machine-translated copy is labelled as such and is never presented as institutional wording.
 * The catalog is large, so the search/filter index and the item bodies live in separate chunks.
 */

export const CULTURE_SCHEMA_VERSION = 1;

/** Broad editorial categories. A record has exactly one primary category and optional tags. */
export const CULTURE_CATEGORIES = [
  "traditions",
  "architecture",
  "indigenous-knowledge",
  "crafts",
  "textiles",
  "food-culture",
  "ingredients",
  "music",
  "dance",
  "festivals",
  "storytelling",
  "language",
  "untranslatable",
  "games",
  "tools",
  "astronomy",
  "agriculture",
  "trade",
  "landscapes",
  "medicine-knowledge",
  "ritual-objects",
  "endangered-crafts",
  "design",
  "everyday-life",
  "objects",
] as const;

export type CultureCategory = (typeof CULTURE_CATEGORIES)[number];

/** The three interface languages the core display metadata must provide. */
export type CultureLocale = "ar" | "de" | "en";

export type LocalizedText = Record<CultureLocale, string>;

export type CultureContinent =
  "africa" | "asia" | "europe" | "north-america" | "south-america" | "oceania";

/** Where a statement came from, and how sure we are allowed to be about it. */
export type CultureProvenance =
  /** Institutional description kept as-is (translated only). */
  | "institution"
  /** Our own short translation/paraphrase of an institutional text. */
  | "machine-translated"
  /** Editorially reviewed wording written from the source. */
  | "editorial-reviewed";

export interface CultureSource {
  /** Human-readable organization, e.g. "The Metropolitan Museum of Art". */
  organization: string;
  /** Stable source URL for this item. */
  url: string;
  /** License identifier, e.g. "CC0-1.0", "CC-BY-4.0", "PDM-1.0". */
  license: string;
  licenseUrl?: string | undefined;
  /** Required attribution line. */
  attribution: string;
  /** ISO date of the source record's own last modification, when supplied. */
  modified?: string | undefined;
}

export interface CultureMedia {
  url: string;
  /** Rights are per item, never assumed from the collection. */
  license: string;
  credit: string;
  width?: number | undefined;
  height?: number | undefined;
  /** Small variant for lists when the source offers one. */
  thumbnailUrl?: string | undefined;
}

export interface CultureTaxonomy {
  category: CultureCategory;
  subcategory?: string | undefined;
}

export interface CulturePlace {
  continent: CultureContinent;
  /** ISO 3166-1 alpha-2 codes; empty for cultures that span states or are not state-bound. */
  countries: string[];
  region?: string | undefined;
  /** Named community/people/tradition when the source provides one. */
  community?: string | undefined;
}

export interface CultureItem {
  id: string;
  version: typeof CULTURE_SCHEMA_VERSION;
  title: LocalizedText & { original?: string | undefined; originalLanguage?: string | undefined };
  /** One or two sentences for lists. */
  summary: LocalizedText;
  /** Longer editorial text for the detail surface. */
  description?: LocalizedText | undefined;
  taxonomy: CultureTaxonomy;
  place: CulturePlace;
  /** Historical period or date as documented by the source (never estimated). */
  period?: string | undefined;
  /** The source's own subject label, kept in its original wording. */
  subject?: string | undefined;
  tags: string[];
  media?: CultureMedia | undefined;
  source: CultureSource;
  provenance: CultureProvenance;
  /**
   * The reason the item is distinctive, in the source's or an editor's own words. Absent
   * when the source states no reason: the interface never invents one.
   */
  whyDistinctive?: LocalizedText | undefined;
  /** Related item ids from genuine metadata relationships (same culture, technique, theme). */
  related?: string[] | undefined;
  /** Ingestion date (ISO). */
  ingestedAt: string;
}

/** Compact record used by the search/filter index. Kept small so the first payload stays light. */
export interface CultureIndexEntry {
  id: string;
  title: LocalizedText;
  category: CultureCategory;
  continent: CultureContinent;
  countries: string[];
  tags: string[];
  /** 0–1 editorial emphasis used for featured selection, from documented criteria. */
  weight: number;
  hasMedia: boolean;
  /**
   * Small media block (URL + credit + licence + aspect) so a feed card can show the real
   * image without opening the full record. Absent = the card uses a typographic composition.
   */
  media?: CultureMedia | undefined;
}

export interface CultureFilters {
  category?: CultureCategory | undefined;
  continent?: CultureContinent | undefined;
  country?: string | undefined;
  /** Free text over titles, tags and subject. */
  search?: string | undefined;
  savedOnly?: boolean | undefined;
  /** Cursor from the previous page (stable id of the last item seen). */
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface CulturePage {
  items: CultureIndexEntry[];
  nextCursor?: string | undefined;
  total?: number | undefined;
}
