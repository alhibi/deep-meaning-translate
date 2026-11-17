/**
 * Shared pipeline helpers for the cultural knowledge library.
 *
 * The product is written editorial content: every published record is a three-language article
 * about people, societies, language or everyday life. Objects, images and museum catalogues are
 * rejected here by design, and the validators fail the build rather than publish placeholders.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

export const REPO = join(dirname(new URL(import.meta.url).pathname), "..", "..");
export const SEEDS_DIR = join(REPO, "data/culture/seeds");
export const GEN_DIR = join(REPO, "artifacts/phase2/culture-gen");
export const OUT_DIR = join(REPO, "src/lib/culture/data");
export const REPORT_FILE = join(REPO, "data/culture/report.json");
export const CHUNK_SIZE = 50;
export const SCHEMA_VERSION = 2;

export const CATEGORIES = [
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
];
export const CONTINENTS = ["africa", "asia", "europe", "north-america", "south-america", "oceania"];
export const TYPES = ["feature", "note", "language", "scene", "contrast", "detail"];
const LOCALES = ["ar", "de", "en"];
const BANNED = [
  /\bmuseum\b/i,
  /\bartifact(s)?\b/i,
  /\bartefact(s)?\b/i,
  /\baccession\b/i,
  /\bcatalogue\b/i,
  /metmuseum/i,
  /\bsculpture\b/i,
  /\bpainting\b/i,
  /\bceramic\b/i,
  /\bpottery\b/i,
  /\btextile fragment\b/i,
  /\bfurniture\b/i,
  /\brelief\b/i,
  /\bamphora\b/i,
];
const PLACEHOLDERS = [
  /lorem ipsum/i,
  /\bTBD\b/,
  /\bTODO\b/,
  /\bplaceholder\b/i,
  /\bAI[- ]generated\b/i,
  /\bexample text\b/i,
];

export const isText = (v) => typeof v === "string" && v.trim().length > 0;
export function words(text) {
  return (text || "").trim().split(/\s+/u).filter(Boolean).length;
}
export function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "article"
  );
}
export function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function topicKey(seed) {
  return normalizeTitle(seed.titleEn).split(" ").slice(0, 6).join(" ");
}
export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}
export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
export async function listSeeds() {
  if (!existsSync(SEEDS_DIR)) return [];
  const files = (await readdir(SEEDS_DIR)).filter((f) => f.endsWith(".json"));
  const all = [];
  for (const file of files) {
    const rows = await readJson(join(SEEDS_DIR, file), []);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) all.push({ ...row, seedFile: file });
  }
  return all;
}

/** Structural validation of a research seed; returns reasons when unusable. */
export function seedProblems(seed) {
  const problems = [];
  if (!isText(seed.id) || !/^[a-z]{3}-\d{3,}$/.test(seed.id)) problems.push("id");
  if (!isText(seed.titleEn) || words(seed.titleEn) < 3) problems.push("titleEn");
  if (!CATEGORIES.includes(seed.category)) problems.push("category");
  if (!CONTINENTS.includes(seed.continent)) problems.push("continent");
  if (!TYPES.includes(seed.contentType)) problems.push("contentType");
  if (!Array.isArray(seed.countries) || seed.countries.some((c) => !/^[A-Z]{2}$/.test(c)))
    problems.push("countries");
  if (!Array.isArray(seed.facts) || seed.facts.length < 3) problems.push("facts");
  if (!Array.isArray(seed.sources) || seed.sources.length < 2) problems.push("sources");
  for (const source of seed.sources || []) {
    if (
      !isText(source.organization) ||
      !isText(source.title) ||
      !/^https:\/\/[^\s]+$/.test(source.url || "")
    )
      problems.push("source-shape");
  }
  if (seed.category === "languages" || seed.category === "communication") {
    if (!seed.expression || !isText(seed.expression.original)) problems.push("expression");
  }
  return problems;
}

/** Validates one generated article in all three locales. Returns { ok, problems }. */
export function articleProblems(article) {
  const problems = [];
  if (article.version !== SCHEMA_VERSION) problems.push("version");
  if (!isText(article.id) || !isText(article.slug)) problems.push("id");
  if (!CATEGORIES.includes(article.category)) problems.push("category");
  if (!TYPES.includes(article.contentType)) problems.push("contentType");
  if (!CONTINENTS.includes(article.context?.continent)) problems.push("continent");
  if (
    !Array.isArray(article.context?.countries) ||
    article.context.countries.some((c) => !/^[A-Z]{2}$/.test(c))
  )
    problems.push("countries");
  if (!Array.isArray(article.sources) || article.sources.length < 2) problems.push("sources");
  for (const source of article.sources || []) {
    if (!/^https:\/\/[^\s]+$/.test(source.url || "")) problems.push("source-url");
    if (!isText(source.organization) || !isText(source.accessed)) problems.push("source-meta");
    if (!LOCALES.every((l) => isText(source.title?.[l]))) problems.push("source-title");
    if (!LOCALES.every((l) => isText(source.supports?.[l]))) problems.push("source-supports");
  }
  const extended = article.contentType === "feature" || article.contentType === "contrast";
  let totalWords = 0;
  for (const locale of LOCALES) {
    const title = article.title?.[locale] || "";
    const teaser = article.teaser?.[locale] || "";
    const deck = article.deck?.[locale] || "";
    if (!isText(title) || words(title) < 2) problems.push("title:" + locale);
    if (!isText(teaser) || words(teaser) < 6) problems.push("teaser:" + locale);
    if (!isText(deck) || words(deck) < 4) problems.push("deck:" + locale);
    const sections = article.sections?.[locale];
    if (!Array.isArray(sections) || sections.length < 2) {
      problems.push("sections:" + locale);
      continue;
    }
    let body = 0;
    for (const section of sections) {
      if (!isText(section.heading)) problems.push("heading:" + locale);
      if (!Array.isArray(section.paragraphs) || section.paragraphs.length < 1)
        problems.push("paragraphs:" + locale);
      for (const paragraph of section.paragraphs || []) {
        if (!isText(paragraph) || words(paragraph) < 12) problems.push("paragraph:" + locale);
        body += words(paragraph);
      }
    }
    if (locale === "en") totalWords = body;
    const min = extended ? 180 : 85;
    const max = extended ? 520 : 215;
    if (body < min || body > max) problems.push("body-length:" + locale + ":" + body);
    const text = [
      title,
      teaser,
      deck,
      ...sections.flatMap((s) => [s.heading, ...(s.paragraphs || [])]),
    ].join(" ");
    if (BANNED.some((re) => re.test(text))) problems.push("object-content:" + locale);
    if (PLACEHOLDERS.some((re) => re.test(text))) problems.push("placeholder:" + locale);
  }
  if (article.contentType === "language") {
    if (
      !article.expression ||
      !isText(article.expression.original) ||
      !isText(article.expression.language)
    )
      problems.push("expression");
    for (const locale of LOCALES) {
      if (
        !isText(article.expression?.gloss?.[locale]) ||
        !isText(article.expression?.usage?.[locale])
      )
        problems.push("expression:" + locale);
    }
  }
  if (article.expression && !isText(article.expression.original))
    problems.push("expression-original");
  return { ok: problems.length === 0, problems: [...new Set(problems)], words: totalWords };
}
