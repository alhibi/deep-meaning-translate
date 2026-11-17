/**
 * Corpus validation gate (A09, task-17).
 *
 * Fails (exit 1) on: duplicate ids, missing source/licence/attribution, non-https or
 * non-allowlisted media URLs, missing ar/de fields, unknown category/continent, malformed
 * ISO dates, images without credit/licence, provenance that claims institutional wording
 * while the English was rewritten, index/chunk order mismatch, chunk/file integrity drift,
 * stats disagreement, and an index over the documented compact-size budget.
 *
 * Usage:
 *   node scripts/culture/validate.mjs
 *   node scripts/culture/validate.mjs --data-dir=<dir> --stats=<file>   # for selftests
 *
 * The exported validators are pure so scripts/culture/selftest.mjs can prove that each
 * failure class actually fires on a mutated record.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CHUNK_SIZE,
  CONTINENTS,
  CULTURE_SCHEMA_VERSION,
  DATA_DIR,
  MET,
  REPO_ROOT,
} from "./lib.mjs";
import { CULTURE_CATEGORIES } from "../../src/lib/culture/types.ts";

const STATS_PATH = join(REPO_ROOT, "data/culture/corpus-stats.json");
export const MEDIA_HOSTS = MET.imageHosts;
export const SOURCE_HOSTS = ["www.metmuseum.org", "metmuseum.org"];
export const MAX_INDEX_COMPACT_BYTES = 250 * 1024;

const ITEM_KEYS = new Set([
  "id",
  "version",
  "title",
  "summary",
  "description",
  "taxonomy",
  "place",
  "period",
  "subject",
  "tags",
  "media",
  "source",
  "provenance",
  "related",
  "ingestedAt",
]);
const ENTRY_KEYS = new Set([
  "id",
  "title",
  "category",
  "continent",
  "countries",
  "tags",
  "weight",
  "hasMedia",
  "media",
]);
const PROVENANCES = new Set(["institution", "machine-translated", "editorial-reviewed"]);
const PLACEHOLDER =
  /\bTODO\b|\bTBD\b|lorem ipsum|\bplaceholder\b|\bXXX\b|\bundefined\b|\bnull\b|\bNaN\b|\?\?\?/i;
const ARABIC_LETTER = /[\u0621-\u064A]/;
const ARABIC_DIGITS = {
  "\u0660": "0",
  "\u0661": "1",
  "\u0662": "2",
  "\u0663": "3",
  "\u0664": "4",
  "\u0665": "5",
  "\u0666": "6",
  "\u0667": "7",
  "\u0668": "8",
  "\u0669": "9",
};

export function context() {
  return {
    categories: new Set(CULTURE_CATEGORIES),
    continents: new Set(CONTINENTS),
    mediaHosts: MEDIA_HOSTS,
    sourceHosts: SOURCE_HOSTS,
    schemaVersion: CULTURE_SCHEMA_VERSION,
    organization: MET.organization,
    license: MET.license,
    licenseUrl: MET.licenseUrl,
  };
}

function isString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttps(value) {
  if (typeof value !== "string" || !/^https:\/\//.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function hostOf(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function isIso(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function westerniseDigits(text) {
  let out = text;
  for (const [arabic, latin] of Object.entries(ARABIC_DIGITS)) out = out.split(arabic).join(latin);
  return out;
}

function numericTokens(text) {
  return Array.from(new Set(text.match(/\d{3,}/g) || []));
}

function validLocalizedText(value, errors, label) {
  if (!value || typeof value !== "object") {
    errors.push(label + ":missing");
    return;
  }
  for (const part of ["en", "ar", "de"]) {
    if (typeof value[part] !== "string" || !value[part].trim())
      errors.push(label + "." + part + ":missing");
  }
  if (typeof value.en === "string") {
    if (!/[.!?]$/.test(value.en.trim()) && label === "summary")
      errors.push(label + ".en:no-terminal-punctuation");
    if (PLACEHOLDER.test(value.en)) errors.push(label + ".en:placeholder");
  }
  if (typeof value.ar === "string") {
    if (label === "title") {
      if (!ARABIC_LETTER.test(value.ar)) errors.push(label + ".ar:not-arabic");
    } else if ((value.ar.match(/[\u0621-\u064A]/g) || []).length < 4) {
      errors.push(label + ".ar:not-arabic");
    }
    if (PLACEHOLDER.test(value.ar)) errors.push(label + ".ar:placeholder");
  }
  if (typeof value.de === "string") {
    if (ARABIC_LETTER.test(value.de)) errors.push(label + ".de:contains-arabic");
    if (label === "summary" && value.de.trim() === (value.en || "").trim())
      errors.push(label + ".de:identical-to-english");
    if (PLACEHOLDER.test(value.de)) errors.push(label + ".de:placeholder");
  }
}

/** Every rule the corpus must satisfy for one CultureItem. Returns error strings. */
export function validateItem(item, cfg) {
  const errors = [];
  if (!item || typeof item !== "object") return ["item:not-an-object"];
  const id = isString(item.id) ? item.id : "(missing-id)";
  const tag = "item " + id + ": ";
  const push = (message) => errors.push(tag + message);

  for (const key of Object.keys(item)) {
    if (!ITEM_KEYS.has(key)) push("unexpected-key " + key);
  }
  if (!/^met-\d+$/.test(id)) push("id-format");
  if (item.version !== cfg.schemaVersion) push("version=" + String(item.version));
  if (item.provenance && !PROVENANCES.has(item.provenance))
    push("unknown-provenance " + String(item.provenance));
  if (!item.provenance) push("missing-provenance");

  // Titles must retain the institutional English wording.
  validLocalizedText(item.title, errors, "title");
  if (!item.title || typeof item.title !== "object") {
    push("title:missing");
  } else {
    if (!isString(item.title.original))
      push("title.original:missing (source English not retained)");
    else if (item.title.en && item.title.original !== item.title.en)
      push("title.original:rewritten (differs from title.en)");
    if (item.title.originalLanguage !== "en") push("title.originalLanguage:not-en");
    if (typeof item.title.ar === "string" && item.title.ar.trim() === (item.title.en || "").trim())
      push("title.ar:identical-to-english");
  }
  if (!item.summary || typeof item.summary !== "object") {
    push("summary:missing");
  } else {
    for (const part of ["en", "ar", "de"]) {
      if (!isString(item.summary[part])) push("summary." + part + ":missing");
    }
    if (
      typeof item.summary.ar === "string" &&
      (item.summary.ar.match(/[\u0621-\u064A]/g) || []).length < 4
    )
      push("summary.ar:not-arabic");
    if (
      typeof item.summary.en === "string" &&
      typeof item.summary.de === "string" &&
      item.summary.en.trim() === item.summary.de.trim()
    )
      push("summary.de:identical-to-english");
    for (const token of numericTokens(String(item.summary.en || ""))) {
      for (const locale of ["ar", "de"]) {
        const haystack =
          String((item.summary && item.summary[locale]) || "") +
          " " +
          String((item.title && item.title[locale]) || "");
        if (!westerniseDigits(haystack).includes(token))
          push("summary." + locale + ":lost-number-" + token);
      }
    }
    if (typeof item.summary.en === "string") {
      if (PLACEHOLDER.test(item.summary.en)) push("summary.en:placeholder");
      const place = item.place && item.place.continent;
      if (!place) push("place:missing");
    }
  }
  if (item.description !== undefined) validLocalizedText(item.description, errors, "description");

  // Taxonomy and place vocabulary.
  if (!item.taxonomy || typeof item.taxonomy !== "object") push("taxonomy:missing");
  else {
    if (!cfg.categories.has(item.taxonomy.category))
      push("unknown-category " + String(item.taxonomy.category));
    if (item.taxonomy.subcategory !== undefined && !isString(item.taxonomy.subcategory))
      push("taxonomy.subcategory:empty");
  }
  if (!item.place || typeof item.place !== "object") push("place:missing");
  else {
    if (!cfg.continents.has(item.place.continent))
      push("unknown-continent " + String(item.place.continent));
    if (!Array.isArray(item.place.countries)) push("place.countries:not-array");
    else {
      for (const country of item.place.countries) {
        if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country))
          push("place.countries:invalid-code " + String(country));
      }
      if (new Set(item.place.countries).size !== item.place.countries.length)
        push("place.countries:duplicate");
    }
    if (item.place.region !== undefined && !isString(item.place.region)) push("place.region:empty");
    if (item.place.community !== undefined && !isString(item.place.community))
      push("place.community:empty");
  }

  if (item.period !== undefined) {
    if (!isString(item.period)) push("period:empty");
    else {
      if (item.period.length > 160) push("period:too-long");
      if (/^\d{4}-\d{2}-\d{2}/.test(item.period) && !isIso(item.period))
        push("period:malformed-iso-date");
      if (PLACEHOLDER.test(item.period)) push("period:placeholder");
      if (/[,;:\u2013-]\s*$/.test(item.period)) push("period:dangling-separator");
    }
  }
  if (item.subject !== undefined) {
    if (!isString(item.subject)) push("subject:empty");
    else if (item.subject.length > 120) push("subject:too-long");
  }

  if (!Array.isArray(item.tags)) push("tags:not-array");
  else {
    if (item.tags.length === 0) push("tags:empty");
    if (item.tags.length > 4) push("tags:too-many");
    if (new Set(item.tags).size !== item.tags.length) push("tags:duplicate");
    for (const tagValue of item.tags) {
      if (!isString(tagValue)) push("tags:empty-entry");
      else if (tagValue.length > 60) push("tags:entry-too-long");
      else if (PLACEHOLDER.test(tagValue)) push("tags:placeholder");
    }
  }

  // Media: rights are per item. This corpus only accepts records with a real Met image.
  if (!item.media || typeof item.media !== "object") {
    push("media:missing (public-domain image is an acceptance requirement)");
  } else {
    if (!isHttps(item.media.url)) push("media.url:not-https");
    else if (!cfg.mediaHosts.includes(hostOf(item.media.url)))
      push("media.url:unexpected-host " + hostOf(item.media.url));
    if (!isString(item.media.license)) push("media.license:missing");
    else if (item.media.license !== cfg.license) push("media.license:not-" + cfg.license);
    if (!isString(item.media.credit)) push("media.credit:missing");
    if (item.media.thumbnailUrl !== undefined) {
      if (!isHttps(item.media.thumbnailUrl)) push("media.thumbnailUrl:not-https");
      else if (!cfg.mediaHosts.includes(hostOf(item.media.thumbnailUrl)))
        push("media.thumbnailUrl:unexpected-host");
    }
    if (
      item.media.width !== undefined &&
      !(typeof item.media.width === "number" && item.media.width > 0)
    )
      push("media.width:invalid");
    if (
      item.media.height !== undefined &&
      !(typeof item.media.height === "number" && item.media.height > 0)
    )
      push("media.height:invalid");
  }

  // Source and provenance.
  if (!item.source || typeof item.source !== "object") push("source:missing");
  else {
    if (!isString(item.source.organization)) push("source.organization:missing");
    if (!isHttps(item.source.url)) push("source.url:not-https");
    else if (!cfg.sourceHosts.includes(hostOf(item.source.url)))
      push("source.url:unexpected-host " + hostOf(item.source.url));
    if (!isString(item.source.license)) push("source.license:missing");
    else if (item.source.license !== cfg.license) push("source.license:not-" + cfg.license);
    if (!isString(item.source.licenseUrl) || !isHttps(item.source.licenseUrl))
      push("source.licenseUrl:not-https");
    if (!isString(item.source.attribution)) push("source.attribution:missing");
    else if (!item.source.attribution.includes(cfg.organization))
      push("source.attribution:missing-institution");
    if (item.source.modified === undefined) push("source.modified:missing");
    else if (!isIso(item.source.modified)) push("source.modified:malformed-iso-date");
    // Provenance integrity: this corpus's English summary is a derived template, so a
    // record may never claim institutional wording for it.
    if (item.source.organization === cfg.organization && item.provenance !== "machine-translated") {
      push("provenance:met-records-must-be-machine-translated");
    }
    if (item.provenance === "institution") {
      if (
        item.title &&
        typeof item.title.original === "string" &&
        item.title.en !== item.title.original
      ) {
        push("provenance:claims-institution-but-title-rewritten");
      }
      if (!item.description) push("provenance:claims-institution-but-no-institutional-text");
    }
  }

  if (!isIso(item.ingestedAt)) push("ingestedAt:malformed-iso-date");

  if (item.related !== undefined) {
    if (!Array.isArray(item.related) || item.related.length === 0) push("related:empty");
    else {
      if (item.related.length > 3) push("related:too-many");
      if (new Set(item.related).size !== item.related.length) push("related:duplicate");
      for (const relatedId of item.related) {
        if (typeof relatedId !== "string" || !/^met-\d+$/.test(relatedId))
          push("related:invalid-id");
        else if (relatedId === item.id) push("related:self-reference");
      }
    }
  }

  return errors;
}

/** Rules for one compact index entry against its full item. */
export function validateIndexEntry(entry, item, cfg) {
  const errors = [];
  if (!entry || typeof entry !== "object") return ["index-entry:not-an-object"];
  const id = isString(entry.id) ? entry.id : "(missing-id)";
  const tag = "index " + id + ": ";
  const push = (message) => errors.push(tag + message);
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.has(key)) push("unexpected-key " + key);
  }
  if (
    typeof entry.weight !== "number" ||
    !Number.isFinite(entry.weight) ||
    entry.weight < 0 ||
    entry.weight > 1
  ) {
    push("weight-out-of-range " + String(entry.weight));
  }
  if (!cfg.categories.has(entry.category)) push("unknown-category");
  if (!cfg.continents.has(entry.continent)) push("unknown-continent");
  if (
    !entry.title ||
    typeof entry.title.en !== "string" ||
    typeof entry.title.ar !== "string" ||
    typeof entry.title.de !== "string"
  ) {
    push("title:not-localized");
  }
  if (!Array.isArray(entry.tags) || entry.tags.length > 3) push("tags:not-compact");
  if (item) {
    if (entry.id !== item.id) push("id-mismatch");
    if (
      JSON.stringify(entry.title) !==
      JSON.stringify({ en: item.title.en, ar: item.title.ar, de: item.title.de })
    )
      push("title-mismatch");
    if (entry.category !== item.taxonomy.category) push("category-mismatch");
    if (entry.continent !== item.place.continent) push("continent-mismatch");
    if (JSON.stringify(entry.countries) !== JSON.stringify(item.place.countries))
      push("countries-mismatch");
    if (JSON.stringify(entry.tags) !== JSON.stringify(item.tags.slice(0, 3))) push("tags-mismatch");
    if (
      entry.hasMedia &&
      (!entry.media ||
        !isHttps(entry.media.url) ||
        !cfg.mediaHosts.includes(hostOf(entry.media.url)))
    ) {
      push("media:invalid-block");
    }
    if (
      entry.hasMedia &&
      entry.media &&
      (!isString(entry.media.license) || !isString(entry.media.credit))
    ) {
      push("media:missing-credit-or-licence");
    }
    if (
      entry.hasMedia &&
      entry.media &&
      item.media &&
      item.media.thumbnailUrl &&
      entry.media.url !== item.media.thumbnailUrl
    ) {
      push("media:not-the-card-variant");
    }
    const shouldHaveMedia = Boolean(item.media && isHttps(item.media.url));
    if (entry.hasMedia !== shouldHaveMedia) push("hasMedia-mismatch");
    if (!entry.hasMedia && entry.media) push("media:block-with-false-hasMedia");
  }
  return errors;
}

/** Whole-corpus structure: index order vs concatenated chunks, duplicates, counts. */
export function validateCorpus({ index, chunks, manifest }, cfg) {
  const errors = [];
  const warnings = [];
  const push = (message) => errors.push(message);
  if (!index || typeof index !== "object") return { errors: ["index:missing"], warnings };
  if (index.version !== cfg.schemaVersion) push("index.version=" + String(index.version));
  if (index.chunkSize !== manifest.CHUNK_SIZE)
    push(
      "index.chunkSize=" + String(index.chunkSize) + " vs manifest " + String(manifest.CHUNK_SIZE),
    );
  if (index.chunkSize !== CHUNK_SIZE)
    push("index.chunkSize=" + String(index.chunkSize) + " vs script " + String(CHUNK_SIZE));
  const entries = Array.isArray(index.entries) ? index.entries : [];
  if (entries.length !== manifest.TOTAL_ITEMS)
    push(
      "index.entries:length " +
        String(entries.length) +
        " vs manifest TOTAL_ITEMS " +
        String(manifest.TOTAL_ITEMS),
    );
  if (manifest.CHUNK_COUNT !== Math.ceil(entries.length / index.chunkSize))
    push("manifest.CHUNK_COUNT mismatch");
  if (chunks.length !== manifest.CHUNK_COUNT)
    push("chunk files " + String(chunks.length) + " vs manifest " + String(manifest.CHUNK_COUNT));

  const ids = [];
  const items = [];
  const chunkSize = index.chunkSize;
  for (let k = 0; k < chunks.length; k += 1) {
    const chunk = chunks[k];
    if (!chunk || typeof chunk !== "object") {
      push("chunk " + String(k) + ":missing-default-export");
      continue;
    }
    if (chunk.version !== cfg.schemaVersion)
      push("chunk " + String(k) + ".version=" + String(chunk.version));
    if (!Array.isArray(chunk.items)) {
      push("chunk " + String(k) + ".items:not-array");
      continue;
    }
    const expectedLength = k === chunks.length - 1 ? entries.length - k * chunkSize : chunkSize;
    if (chunk.items.length !== expectedLength)
      push(
        "chunk " +
          String(k) +
          ":length " +
          String(chunk.items.length) +
          " vs expected " +
          String(expectedLength),
      );
    for (let j = 0; j < chunk.items.length; j += 1) {
      const position = k * chunkSize + j;
      const item = chunk.items[j];
      const entry = entries[position];
      if (!entry) {
        push("chunk " + String(k) + "[" + String(j) + "]:no-index-entry");
        continue;
      }
      if (item.id !== entry.id)
        push(
          "order-mismatch at position " +
            String(position) +
            ": chunk has " +
            String(item.id) +
            ", index has " +
            String(entry.id),
        );
      ids.push(item.id);
      items.push(item);
    }
  }
  if (new Set(ids).size !== ids.length) push("duplicate-ids across the corpus");
  const numericOrder = ids.map((id) => Number(id.slice(4)));
  for (let i = 1; i < numericOrder.length; i += 1) {
    if (numericOrder[i] <= numericOrder[i - 1]) {
      push("ids-not-sorted at position " + String(i));
      break;
    }
  }
  for (let position = 0; position < items.length; position += 1) {
    for (const error of validateItem(items[position], cfg)) push(error);
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  for (let position = 0; position < entries.length; position += 1) {
    const entry = entries[position];
    for (const error of validateIndexEntry(entry, byId.get(entry.id), cfg)) push(error);
  }
  for (const item of items) {
    for (const relatedId of item.related || []) {
      if (!byId.has(relatedId)) push("item " + item.id + ": related id missing " + relatedId);
    }
  }
  const emptyCountries = items.filter((item) => item.place.countries.length === 0).length;
  if (emptyCountries > 0)
    warnings.push(
      String(emptyCountries) + " records have an empty countries array (non-state-bound culture)",
    );
  const compact = Buffer.byteLength(JSON.stringify(entries), "utf8");
  if (compact > MAX_INDEX_COMPACT_BYTES)
    push("index:compact-size " + String(compact) + " > " + String(MAX_INDEX_COMPACT_BYTES));
  const stats = {
    items: items.length,
    entries: entries.length,
    chunks: chunks.length,
    compactIndexBytes: compact,
  };
  return { errors, warnings, stats };
}

async function main() {
  const args = { dataDir: DATA_DIR, stats: STATS_PATH };
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--data-dir=")) args.dataDir = raw.slice(11);
    else if (raw.startsWith("--stats=")) args.stats = raw.slice(8);
    else throw new Error("Unknown argument: " + raw);
  }
  const cfg = context();
  const load = async (name) => (await import(pathToFileURL(join(args.dataDir, name)).href)).default;
  const index = await load("index.ts");
  // manifest.ts exports named constants only (no default export).
  const manifest = await import(pathToFileURL(join(args.dataDir, "manifest.ts")).href);
  const chunkNames = (await readdir(args.dataDir))
    .filter((name) => /^chunk-\d+\.ts$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const chunks = [];
  for (const name of chunkNames) chunks.push(await load(name));

  const result = validateCorpus({ index, chunks, manifest }, cfg);
  const errors = result.errors.slice();
  const warnings = result.warnings.slice();

  // Integrity: every generated module must match the hash recorded in manifest.FILES.
  const rawTexts = new Map();
  for (const name of ["index.ts", ...chunkNames]) {
    const text = await readFile(join(args.dataDir, name), "utf8");
    rawTexts.set(name, text);
    const recorded = manifest.FILES && manifest.FILES[name];
    if (!recorded) {
      errors.push("manifest.FILES: missing " + name);
      continue;
    }
    if (Buffer.byteLength(text, "utf8") !== recorded.bytes)
      errors.push(name + ":bytes changed (manifest " + String(recorded.bytes) + ")");
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(text).digest("hex");
    if (digest !== recorded.sha256) errors.push(name + ":sha256 changed (manifest integrity)");
  }

  // The committed stats file must agree with the generated corpus.
  try {
    const stats = JSON.parse(await readFile(args.stats, "utf8"));
    if (!stats || typeof stats !== "object") throw new Error("not an object");
    if (stats.totals && stats.totals.published !== result.stats.items)
      errors.push("stats.totals.published mismatch");
    if (stats.sizes && stats.sizes.indexCompactBytes !== result.stats.compactIndexBytes)
      errors.push("stats.sizes.indexCompactBytes mismatch");
    if (stats.coverage && (stats.coverage.ar !== 100 || stats.coverage.de !== 100))
      errors.push("stats.coverage: ar/de not 100%");
    if (stats.files) {
      for (const name of rawTexts.keys()) {
        const recorded = manifest.FILES[name];
        const reported = stats.files[name];
        if (!reported || reported.sha256 !== recorded.sha256)
          errors.push("stats.files mismatch for " + name);
      }
    }
  } catch (error) {
    errors.push("stats file unreadable: " + args.stats + " (" + error.message + ")");
  }

  const items = chunks.flatMap((chunk) => chunk.items || []);
  const byContinent = {};
  const byCategory = {};
  const translations = { en: 0, ar: 0, de: 0 };
  for (const item of items) {
    const category = (item.taxonomy || {}).category;
    const continent = (item.place || {}).continent;
    if (category) byCategory[category] = (byCategory[category] || 0) + 1;
    if (continent) byContinent[continent] = (byContinent[continent] || 0) + 1;
    if (item.summary && item.summary.en && item.title && item.title.en) translations.en += 1;
    if (item.summary && item.summary.ar && item.title && item.title.ar) translations.ar += 1;
    if (item.summary && item.summary.de && item.title && item.title.de) translations.de += 1;
  }

  console.log("=== culture corpus validation (A09 task-17) ===");
  console.log("data dir: " + args.dataDir);
  console.log(
    "records: " +
      String(items.length) +
      " in " +
      String(chunks.length) +
      " chunks of " +
      String(index.chunkSize),
  );
  console.log(
    "index: " +
      String(Buffer.byteLength(rawTexts.get("index.ts"), "utf8")) +
      " bytes raw, " +
      String(result.stats.compactIndexBytes) +
      " bytes compact (budget " +
      String(MAX_INDEX_COMPACT_BYTES) +
      ")",
  );
  console.log("by continent: " + JSON.stringify(byContinent));
  console.log("by category: " + JSON.stringify(byCategory));
  console.log(
    "translation coverage: en " +
      String(translations.en) +
      "/" +
      String(items.length) +
      ", ar " +
      String(translations.ar) +
      "/" +
      String(items.length) +
      ", de " +
      String(translations.de) +
      "/" +
      String(items.length),
  );
  console.log(
    "unique ids: " +
      String(new Set(items.map((item) => item.id)).size) +
      "/" +
      String(items.length),
  );
  console.log(
    "checks: contract keys, provenance/licence/credit, https+allowlisted hosts, ISO dates, category/continent vocab, number retention, index/chunk order, file hashes, stats agreement, size budget",
  );
  for (const warning of warnings) console.log("WARN " + warning);
  if (errors.length) {
    console.log("");
    console.log("FAIL " + String(errors.length) + " error(s):");
    for (const error of errors.slice(0, 60)) console.log("  - " + error);
    if (errors.length > 60) console.log("  ... " + String(errors.length - 60) + " more");
    process.exitCode = 1;
    return;
  }
  console.log("");
  console.log(
    "PASS: all corpus checks green (" +
      String(items.length) +
      " records, ar/de 100%, " +
      String(result.stats.compactIndexBytes) +
      " bytes compact index)",
  );
  console.log(
    JSON.stringify({
      ok: true,
      items: items.length,
      chunks: chunks.length,
      compactIndexBytes: result.stats.compactIndexBytes,
      byContinent,
      byCategory,
      translations,
    }),
  );
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("validate failed: " + error.message);
    process.exit(1);
  });
}
