/**
 * The cultural knowledge library: written editorial articles about people, societies,
 * languages and everyday life. There is no catalogue object here and no media requirement —
 * the article is the product.
 */
export const CULTURE_SCHEMA_VERSION = 2;

export const CULTURE_CATEGORIES = [
  "everyday-life",
  "social-behaviour",
  "languages",
  "communication",
  "traditions",
  "family-and-friendship",
  "food-and-hospitality",
  "work-and-education",
  "cities-and-community",
  "music-and-dance",
  "games-and-leisure",
  "storytelling",
  "clothing-and-design",
  "nature-and-seasons",
  "beliefs-and-folklore",
  "migration-and-identity",
  "regional-humour",
  "cultural-change",
] as const;
export type CultureCategory = (typeof CULTURE_CATEGORIES)[number];

export type CultureContinent =
  "africa" | "asia" | "europe" | "north-america" | "south-america" | "oceania";
export type CultureLocale = "ar" | "de" | "en";
export type LocalizedText = Record<CultureLocale, string>;

export type CultureContentType = "feature" | "note" | "language" | "scene" | "contrast" | "detail";

/** One section of one locale's article text. */
export interface CultureSection {
  heading: string;
  paragraphs: string[];
}

export interface CultureExpression {
  original: string;
  transliteration?: string;
  language: string;
  gloss: LocalizedText;
  usage: LocalizedText;
}

export interface CultureSource {
  organization: string;
  title: LocalizedText;
  url: string;
  published?: string;
  accessed: string;
  supports: LocalizedText;
}

export type CultureVerification = "source-linked" | "double-checked" | "unverified";
export type CultureReview = "machine-drafted" | "editor-reviewed" | "not-reviewed";

export interface CultureStatus {
  verification: CultureVerification;
  editorial: CultureReview;
  translation: CultureReview;
  revision: number;
  published: boolean;
}

export interface CultureContext {
  countries: string[];
  region?: string;
  community?: string;
  continent: CultureContinent;
  languages: string[];
  period?: "contemporary" | "historical" | "both";
}

export interface CultureArticle {
  id: string;
  version: typeof CULTURE_SCHEMA_VERSION;
  slug: string;
  contentType: CultureContentType;
  category: CultureCategory;
  title: LocalizedText;
  deck: LocalizedText;
  teaser: LocalizedText;
  readingMinutes: number;
  /** Article body per interface language; the reader sees exactly one locale's sections. */
  sections: Record<CultureLocale, CultureSection[]>;
  expression?: CultureExpression;
  example?: LocalizedText;
  misunderstanding?: LocalizedText;
  comparison?: LocalizedText;
  context: CultureContext;
  tags: string[];
  sources: CultureSource[];
  status: CultureStatus;
  related: string[];
  publishedAt: string;
}

export interface CultureIndexEntry {
  id: string;
  title: LocalizedText;
  teaser: LocalizedText;
  category: CultureCategory;
  contentType: CultureContentType;
  continent: CultureContinent;
  countries: string[];
  tags: string[];
  readingMinutes: number;
  weight: number;
  hasExpression: boolean;
}

export interface CultureFilters {
  category?: CultureCategory;
  continent?: CultureContinent;
  country?: string;
  language?: string;
  contentType?: CultureContentType;
  search?: string;
  savedOnly?: boolean;
  cursor?: string;
  limit?: number;
}

export interface CulturePage {
  items: CultureIndexEntry[];
  nextCursor?: string;
  total?: number;
}
