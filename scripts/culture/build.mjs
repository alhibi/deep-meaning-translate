/**
 * Build the client corpus from the ingest snapshot + machine translations (A09, task-17).
 *
 * Deterministic: same snapshot + translations -> byte-identical src/lib/culture/data files.
 * Output contract (see also the report and data/culture/corpus-stats.json):
 *   data/index.ts            default export { version, chunkSize, entries: CultureIndexEntry[] }
 *   data/chunk-0.ts ...      default export { version, items: CultureItem[] } in index order,
 *                            chunk k = index entries at [k*chunkSize, (k+1)*chunkSize)
 *   data/manifest.ts         constants + counts + per-file sha256 (integrity for validate.mjs)
 *
 * Usage:
 *   node scripts/culture/build.mjs                 # build from artifacts/phase2/task-17
 *   node scripts/culture/build.mjs --max-items=560 # deterministic published cap (default all)
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { format as formatPrettier, resolveConfig as resolvePrettierConfig } from "prettier";
import {
  ARTIFACT_DIR,
  CHUNK_SIZE,
  CONTINENTS,
  CULTURE_SCHEMA_VERSION,
  DATA_DIR,
  MET,
  REPO_ROOT,
  log,
  normalizeDetail,
  sha256,
} from "./lib.mjs";

const SNAPSHOT_PATH = join(ARTIFACT_DIR, "snapshot.json");
const TRANSLATIONS_PATH = join(ARTIFACT_DIR, "translations.json");
const STATS_PATH = join(REPO_ROOT, "data/culture/corpus-stats.json");

const CULTURE_CATEGORIES = [
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
];

function parseArgs(argv) {
  const args = { maxItems: null };
  for (const raw of argv) {
    if (raw.startsWith("--max-items=")) args.maxItems = Math.max(1, Number(raw.slice(12)) || 0);
    else throw new Error("Unknown argument: " + raw);
  }
  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

function numericId(id) {
  return Number(id.slice("met-".length));
}

/**
 * Deterministic published selection: when a cap is requested, keep every category and
 * continent represented, ordered by the documented weight then by id. Records dropped from
 * the published corpus stay in the ingest snapshot; nothing is fabricated to fill a slot.
 */
function selectPublished(records, maxItems) {
  if (!maxItems || records.length <= maxItems) return records;
  const sorted = records
    .slice()
    .sort((a, b) => b.weight - a.weight || numericId(a.item.id) - numericId(b.item.id));
  const kept = [];
  const categoryCount = new Map();
  const continentCount = new Map();
  // First pass: guarantee breadth (one per category/continent), then fill by weight.
  for (const record of sorted) {
    const categoryKey = record.item.taxonomy.category;
    const continentKey = record.item.place.continent;
    if (
      (categoryCount.get(categoryKey) || 0) === 0 ||
      (continentCount.get(continentKey) || 0) === 0
    ) {
      kept.push(record);
      bump(categoryCount, categoryKey);
      bump(continentCount, continentKey);
      if (kept.length >= maxItems)
        return kept.sort((a, b) => numericId(a.item.id) - numericId(b.item.id));
    }
  }
  const seen = new Set(kept.map((record) => record.item.id));
  for (const record of sorted) {
    if (seen.has(record.item.id)) continue;
    kept.push(record);
    if (kept.length >= maxItems) break;
  }
  return kept.sort((a, b) => numericId(a.item.id) - numericId(b.item.id));
}

function relatedFor(item, byKey) {
  const candidates = new Set();
  for (const key of ["cat:country", "cat:continent"]) {
    const bucket = byKey.get(
      key +
        ":" +
        item.taxonomy.category +
        "|" +
        (key === "cat:country" ? item.place.countries[0] : item.place.continent),
    );
    if (!bucket) continue;
    for (const id of bucket) {
      if (id !== item.id) candidates.add(id);
    }
  }
  const out = [...candidates].sort((a, b) => numericId(a) - numericId(b)).slice(0, 3);
  return out.length ? out : undefined;
}

function indexEntry(record) {
  const item = record.item;
  const media = item.media;
  const hasMedia =
    Boolean(media) &&
    /^https:\/\//.test(media.url) &&
    media.url.includes("images.metmuseum.org/") &&
    Boolean(media.credit) &&
    Boolean(media.license);
  const entry = {
    id: item.id,
    title: { en: item.title.en, ar: item.title.ar, de: item.title.de },
    category: item.taxonomy.category,
    continent: item.place.continent,
    countries: [...item.place.countries],
    tags: item.tags.slice(0, 3),
    weight: record.weight,
    hasMedia,
  };
  if (hasMedia) {
    entry.media = {
      url: media.thumbnailUrl || media.url,
      license: media.license,
      credit: item.source.organization,
    };
  }
  return entry;
}

async function writeModule(path, source) {
  // Prettier's API does not read .prettierrc on its own; resolve the project config so the
  // generated modules satisfy the same prettier/prettier lint rule as hand-written code.
  const config = (await resolvePrettierConfig(path)) ?? {};
  const formatted = await formatPrettier(source, { ...config, filepath: path });
  await writeFile(path, formatted);
  return formatted;
}

function headerNote(title) {
  return [
    "/**",
    " * GENERATED FILE - do not edit by hand.",
    " * " + title,
    " * Source: The Metropolitan Museum of Art Open Access (CC0 1.0), ingested",
    " * " + String(INGESTED_AT) + ".",
    " * Regenerate with: node scripts/culture/build.mjs",
    " */",
  ].join("\n");
}

let INGESTED_AT = "";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await readJson(SNAPSHOT_PATH);
  const translations = await readJson(TRANSLATIONS_PATH);
  INGESTED_AT = snapshot.fetchedAt;
  if (!Array.isArray(snapshot.details) || snapshot.details.length === 0) {
    throw new Error("Snapshot has no details; run ingest.mjs first");
  }
  if (!translations || !translations.translations) {
    throw new Error("No translations at " + TRANSLATIONS_PATH + "; run translate.mjs first");
  }

  const detailsById = new Map(snapshot.details.map((detail) => [String(detail.objectID), detail]));
  const rejected = [];
  const records = [];
  for (const [id, detail] of detailsById) {
    const result = normalizeDetail(detail, snapshot.fetchedAt);
    if (!result.ok) {
      rejected.push({ objectID: id, reason: result.reason });
      continue;
    }
    const translated = translations.translations[result.item.id];
    if (!translated || !translated.ar || !translated.de) {
      throw new Error("Missing ar/de translation for " + result.item.id + " - run translate.mjs");
    }
    const item = result.item;
    item.title.ar = translated.ar.title;
    item.title.de = translated.de.title;
    item.title.original = item.title.en;
    item.title.originalLanguage = "en";
    item.summary.ar = translated.ar.summary;
    item.summary.de = translated.de.summary;
    records.push({ item, weight: result.weight, detail });
  }
  if (rejected.length) {
    log("WARNING: " + String(rejected.length) + " snapshot records no longer pass normalization:");
    for (const entry of rejected.slice(0, 20)) log("  met-" + entry.objectID + ": " + entry.reason);
  }

  const published = selectPublished(records, args.maxItems);
  published.sort((a, b) => numericId(a.item.id) - numericId(b.item.id));

  // Related ids from genuine shared metadata: same category + same country, else continent.
  const buckets = new Map();
  for (const record of published) {
    for (const [key, value] of [
      ["cat:country", record.item.taxonomy.category + "|" + (record.item.place.countries[0] || "")],
      ["cat:continent", record.item.taxonomy.category + "|" + record.item.place.continent],
    ]) {
      const bucketKey = key + ":" + value;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey).push(record.item.id);
    }
  }
  for (const record of published) {
    const related = relatedFor(record.item, buckets);
    if (related) record.item.related = related;
  }

  const items = published.map((record) => record.item);
  const entries = published.map((record) => indexEntry(record));

  await mkdir(DATA_DIR, { recursive: true });
  const written = new Map();
  const indexPath = join(DATA_DIR, "index.ts");
  const indexSource = [
    headerNote("Compact search/filter index: one entry per item, in the same order as the chunks."),
    'import type { CultureIndexEntry } from "../types";',
    "",
    "const chunkSize = " + String(CHUNK_SIZE) + ";",
    "const entries: CultureIndexEntry[] = " + JSON.stringify(entries, null, 2) + ";",
    "",
    "const index = { version: 1, chunkSize, entries };",
    "",
    "export default index;",
    "",
  ].join("\n");
  written.set("index.ts", await writeModule(indexPath, indexSource));

  const chunkCount = Math.ceil(items.length / CHUNK_SIZE);
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const chunkItems = items.slice(chunk * CHUNK_SIZE, (chunk + 1) * CHUNK_SIZE);
    const chunkPath = join(DATA_DIR, "chunk-" + String(chunk) + ".ts");
    const chunkSource = [
      headerNote(
        "Detail chunk " +
          String(chunk) +
          " of " +
          String(chunkCount) +
          ": items at index positions " +
          String(chunk * CHUNK_SIZE) +
          "-" +
          String(chunk * CHUNK_SIZE + chunkItems.length - 1) +
          ".",
      ),
      'import type { CultureItem } from "../types";',
      "",
      "const items: CultureItem[] = " + JSON.stringify(chunkItems, null, 2) + ";",
      "",
      "const chunk = { version: 1, items };",
      "",
      "export default chunk;",
      "",
    ].join("\n");
    written.set("chunk-" + String(chunk) + ".ts", await writeModule(chunkPath, chunkSource));
  }

  // Counts used by the report, manifest and validator.
  const byContinent = new Map();
  const byCategory = new Map();
  const byCountry = new Map();
  for (const item of items) {
    bump(byContinent, item.place.continent);
    bump(byCategory, item.taxonomy.category);
    if (item.place.countries.length === 0) bump(byCountry, "(non-state-bound)");
    for (const country of item.place.countries) bump(byCountry, country);
  }
  const files = {};
  for (const [name, text] of written) {
    files[name] = { bytes: Buffer.byteLength(text, "utf8"), sha256: sha256(text) };
  }
  const compactIndex = JSON.stringify(entries);
  const manifestPath = join(DATA_DIR, "manifest.ts");
  const manifestSource = [
    headerNote("Corpus manifest: version, layout, counts and per-file integrity hashes."),
    'import type { CultureCategory, CultureContinent } from "../types";',
    "",
    "export const CULTURE_DATA_VERSION = 1;",
    "export const CHUNK_SIZE = " + String(CHUNK_SIZE) + ";",
    "export const CHUNK_COUNT = " + String(chunkCount) + ";",
    "export const TOTAL_ITEMS = " + String(items.length) + ";",
    "export const INGESTED_AT = " + JSON.stringify(snapshot.fetchedAt) + ";",
    "export const SOURCE = {",
    "  organization: " + JSON.stringify(MET.organization) + ",",
    "  license: " + JSON.stringify(MET.license) + ",",
    "  licenseUrl: " + JSON.stringify(MET.licenseUrl) + ",",
    "  api: " + JSON.stringify(MET.apiBase) + ",",
    "} as const;",
    "",
    "export const COUNTS = " +
      JSON.stringify(
        {
          byContinent: sortedObject(byContinent),
          byCategory: sortedObject(byCategory),
        },
        null,
        2,
      ) +
      " as const;",
    "",
    "export const FILES: Record<string, { bytes: number; sha256: string }> = " +
      JSON.stringify(files, null, 2) +
      ";",
    "",
    "export const INDEX_BYTES = " + String(Buffer.byteLength(compactIndex, "utf8")) + ";",
    "export const INDEX_GZIP_BYTES = " + String(gzipSync(compactIndex).length) + ";",
    "",
  ].join("\n");
  const manifestFormatted = await writeModule(manifestPath, manifestSource);

  // Committed corpus statistics (deterministic, no build timestamp).
  const stats = {
    schemaVersion: 1,
    generatedBy: "scripts/culture/build.mjs",
    source: {
      organization: MET.organization,
      license: MET.license,
      licenseUrl: MET.licenseUrl,
      api: MET.apiBase,
      ingestedAt: snapshot.fetchedAt,
    },
    totals: {
      published: items.length,
      ingestedRecordsInSnapshot: records.length,
      droppedFromPublished: records.length - items.length,
      rejectedByCurrentRules: rejected.length,
      chunkSize: CHUNK_SIZE,
      chunkCount,
    },
    counts: {
      byContinent: sortedObject(byContinent),
      byCategory: sortedObject(byCategory),
      byCountry: sortedObject(byCountry),
      withEmptyCountries: items.filter((item) => item.place.countries.length === 0).length,
      withMediaBlock: entries.filter((entry) => entry.hasMedia).length,
      provenance: sortedObject(
        items.reduce((map, item) => {
          bump(map, item.provenance);
          return map;
        }, new Map()),
      ),
    },
    coverage: {
      en: 100,
      ar: Math.round(
        (items.filter((item) => item.title.ar && item.summary.ar).length / items.length) * 100,
      ),
      de: Math.round(
        (items.filter((item) => item.title.de && item.summary.de).length / items.length) * 100,
      ),
      machineTranslated: items.filter((item) => item.provenance === "machine-translated").length,
    },
    categoryRules: JSON.parse(
      await readFile(join(REPO_ROOT, "data/culture/met-source.json"), "utf8"),
    ).categoryRules,
    sizes: {
      indexModuleBytes: Buffer.byteLength(written.get("index.ts"), "utf8"),
      indexCompactBytes: Buffer.byteLength(compactIndex, "utf8"),
      indexGzipBytes: gzipSync(compactIndex).length,
      chunkBytes: Object.fromEntries(
        Object.entries(files)
          .filter(([name]) => name.startsWith("chunk-"))
          .map(([name, info]) => [name, info.bytes]),
      ),
    },
    files: Object.fromEntries(Object.entries(files).map(([name, info]) => [name, info])),
    loaderContract: {
      index:
        "src/lib/culture/data/index.ts -> default { version: 1, chunkSize, entries: CultureIndexEntry[] }",
      chunks: "src/lib/culture/data/chunk-<k>.ts -> default { version: 1, items: CultureItem[] }",
      ordering:
        "entries are in the same global order as the concatenated chunks; chunk = floor(position / chunkSize)",
      version:
        "compare index.version / manifest.CULTURE_DATA_VERSION with CULTURE_SCHEMA_VERSION from src/lib/culture/types.ts",
      lazy: "import the index statically; load chunk-<k>.ts on demand (import.meta.glob or explicit dynamic import); never import every chunk up front",
    },
  };
  await mkdir(join(REPO_ROOT, "data/culture"), { recursive: true });
  await writeFile(STATS_PATH, JSON.stringify(stats, null, 2) + "\n");

  log("wrote " + String(items.length) + " items in " + String(chunkCount) + " chunks");
  log(
    "index.ts: " +
      String(Buffer.byteLength(written.get("index.ts"), "utf8")) +
      " bytes (compact " +
      String(Buffer.byteLength(compactIndex)) +
      " bytes, gzip " +
      String(gzipSync(compactIndex).length) +
      " bytes)",
  );
  log("byContinent: " + JSON.stringify(sortedObject(byContinent)));
  log("byCategory: " + JSON.stringify(sortedObject(byCategory)));
  log("manifest: " + manifestFormatted.length + " bytes; stats: " + STATS_PATH);
  console.log(
    JSON.stringify({
      ok: true,
      published: items.length,
      chunkCount,
      indexModuleBytes: Buffer.byteLength(written.get("index.ts"), "utf8"),
      indexCompactBytes: Buffer.byteLength(compactIndex, "utf8"),
      indexGzipBytes: gzipSync(compactIndex).length,
      byContinent: sortedObject(byContinent),
      byCategory: sortedObject(byCategory),
    }),
  );
}

main().catch((error) => {
  console.error("build failed: " + error.message);
  process.exit(1);
});
