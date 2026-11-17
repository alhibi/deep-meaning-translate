/**
 * Self-test for the culture corpus gates (A09, task-17).
 *
 * Proves that scripts/culture/validate.mjs is not vacuous: every required failure class is
 * exercised on a mutated copy of a REAL record from the ingested snapshot or the generated
 * corpus, and the validator must return the matching error. Also validates the generated
 * corpus when it exists (index/chunks/order/hashes/stats).
 *
 * Usage: node scripts/culture/selftest.mjs
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ARTIFACT_DIR,
  CHUNK_SIZE,
  CULTURE_SCHEMA_VERSION,
  DATA_DIR,
  MET,
  normalizeDetail,
} from "./lib.mjs";
import { validateCorpus, validateIndexEntry, validateItem, context } from "./validate.mjs";

const SNAPSHOT_PATH = join(ARTIFACT_DIR, "snapshot.json");
const cfg = context();

function clone(value) {
  return structuredClone(value);
}

function indexOf(item, weight = 0.5) {
  return {
    id: item.id,
    title: { en: item.title.en, ar: item.title.ar, de: item.title.de },
    category: item.taxonomy.category,
    continent: item.place.continent,
    countries: [...item.place.countries],
    tags: item.tags.slice(0, 3),
    weight,
    hasMedia: true,
    media: {
      url: item.media.thumbnailUrl || item.media.url,
      license: item.media.license,
      credit: item.source.organization,
    },
  };
}

function miniCorpus(items, entries) {
  return {
    index: { version: CULTURE_SCHEMA_VERSION, chunkSize: CHUNK_SIZE, entries },
    chunks: [{ version: CULTURE_SCHEMA_VERSION, items }],
    manifest: {
      CHUNK_SIZE,
      CHUNK_COUNT: 1,
      TOTAL_ITEMS: items.length,
    },
  };
}

async function loadSample() {
  if (existsSync(join(DATA_DIR, "chunk-0.ts")) && existsSync(join(DATA_DIR, "index.ts"))) {
    const index = (await import(pathToFileURL(join(DATA_DIR, "index.ts")).href)).default;
    const chunk = (await import(pathToFileURL(join(DATA_DIR, "chunk-0.ts")).href)).default;
    const entry = index.entries.find((candidate) => candidate.id === chunk.items[0].id);
    return { item: chunk.items[0], entry, source: "generated corpus" };
  }
  if (existsSync(SNAPSHOT_PATH)) {
    const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
    const record = snapshot.details && snapshot.details[0];
    if (record) {
      const result = normalizeDetail(record, snapshot.fetchedAt);
      if (result.ok)
        return {
          item: result.item,
          entry: indexOf(result.item, result.weight),
          source: "ingest snapshot",
        };
    }
  }
  throw new Error("No generated corpus or ingest snapshot to test against; run ingest/build first");
}

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

async function main() {
  const sample = await loadSample();
  const baseItem = sample.item;
  const baseEntry = sample.entry;
  console.log("selftest sample: " + baseItem.id + " from " + sample.source);

  function expectErrors(name, errors, expected) {
    const hit = errors.some((error) => error.includes(expected));
    test(name, async () => {
      if (!hit) {
        throw new Error(
          "expected an error containing " +
            JSON.stringify(expected) +
            "; got " +
            JSON.stringify(errors.slice(0, 6)),
        );
      }
    });
    // Record the evaluation result immediately (tests currently run synchronously).
    return hit;
  }

  // 1) the untouched record must pass every per-item rule
  const baseline = validateItem(clone(baseItem), cfg);
  test("baseline real record passes", async () => {
    if (baseline.length) throw new Error(JSON.stringify(baseline.slice(0, 6)));
  });
  if (baseline.length) {
    // If the real record already fails, surface it before the injection tests.
    console.log("BASELINE ERRORS: " + JSON.stringify(baseline.slice(0, 6)));
  }

  // 2) duplicate ids across the corpus
  const dup = miniCorpus(
    [clone(baseItem), clone(baseItem)],
    [indexOf(baseItem), indexOf(baseItem)],
  );
  expectErrors("duplicate ids fail", validateCorpus(dup, cfg).errors, "duplicate-ids");

  // 3) missing source licence
  let mutated = clone(baseItem);
  delete mutated.source.license;
  expectErrors(
    "missing source licence fails",
    validateItem(mutated, cfg),
    "source.license:missing",
  );

  // 4) missing attribution
  mutated = clone(baseItem);
  mutated.source.attribution = "CC0";
  expectErrors(
    "attribution without institution fails",
    validateItem(mutated, cfg),
    "source.attribution:missing-institution",
  );

  // 5) non-https source url
  mutated = clone(baseItem);
  mutated.source.url = "http://www.metmuseum.org/art/collection/search/1";
  expectErrors("http source url fails", validateItem(mutated, cfg), "source.url:not-https");

  // 6) non-https image
  mutated = clone(baseItem);
  mutated.media.url = "http://images.metmuseum.org/x.jpg";
  expectErrors("http media fails", validateItem(mutated, cfg), "media.url:not-https");

  // 7) image without credit
  mutated = clone(baseItem);
  delete mutated.media.credit;
  expectErrors("image without credit fails", validateItem(mutated, cfg), "media.credit:missing");

  // 8) image without licence
  mutated = clone(baseItem);
  delete mutated.media.license;
  expectErrors("image without licence fails", validateItem(mutated, cfg), "media.license:missing");

  // 9) unknown category / continent
  mutated = clone(baseItem);
  mutated.taxonomy.category = "invented-category";
  expectErrors("unknown category fails", validateItem(mutated, cfg), "unknown-category");
  mutated = clone(baseItem);
  mutated.place.continent = "atlantis";
  expectErrors("unknown continent fails", validateItem(mutated, cfg), "unknown-continent");

  // 10) missing localized field
  mutated = clone(baseItem);
  delete mutated.title.ar;
  expectErrors("missing arabic title fails", validateItem(mutated, cfg), "title.ar:missing");

  // 11) malformed dates
  mutated = clone(baseItem);
  mutated.source.modified = "17 November 2026";
  expectErrors(
    "malformed source modified date fails",
    validateItem(mutated, cfg),
    "source.modified:malformed-iso-date",
  );
  mutated = clone(baseItem);
  mutated.ingestedAt = "yesterday";
  expectErrors(
    "malformed ingestedAt fails",
    validateItem(mutated, cfg),
    "ingestedAt:malformed-iso-date",
  );

  // 12) provenance claims institutional wording but the English was rewritten
  mutated = clone(baseItem);
  mutated.provenance = "institution";
  mutated.title.en = "A rewritten display title";
  mutated.title.original = "The institutional title";
  expectErrors(
    "institution claim with rewritten title fails",
    validateItem(mutated, cfg),
    "title.original:rewritten",
  );
  mutated = clone(baseItem);
  mutated.provenance = "institution";
  // Keep the English verbatim, but no institutional text is provided at all.
  delete mutated.description;
  expectErrors(
    "institution claim without institutional text fails",
    validateItem(mutated, cfg),
    "claims-institution-but-no-institutional-text",
  );

  // 13) index/chunk order mismatch
  const other = clone(baseItem);
  other.id = "met-" + String(Number(baseItem.id.slice(4)) + 1);
  other.title = { ...other.title, en: other.title.en + " II" };
  const swapped = miniCorpus([clone(baseItem), other], [indexOf(other), indexOf(baseItem)]);
  expectErrors(
    "index/chunk order mismatch fails",
    validateCorpus(swapped, cfg).errors,
    "order-mismatch",
  );

  // 14) hasMedia drift
  const badEntry = indexOf(baseItem);
  badEntry.hasMedia = false;
  delete badEntry.media;
  expectErrors(
    "hasMedia drift fails",
    validateCorpus(miniCorpus([clone(baseItem)], [badEntry]), cfg).errors,
    "hasMedia-mismatch",
  );

  // 15) weight out of range
  const heavy = indexOf(baseItem);
  heavy.weight = 1.4;
  expectErrors(
    "weight out of range fails",
    validateIndexEntry(heavy, baseItem, cfg),
    "weight-out-of-range",
  );

  // 16) lost number in a translation
  mutated = clone(baseItem);
  mutated.summary.en = mutated.summary.en + " Dated 1234.";
  mutated.summary.ar = mutated.summary.ar;
  while (/\d/.test(mutated.summary.ar)) mutated.summary.ar = mutated.summary.ar.replace(/\d/, "x");
  while (/\d/.test(mutated.summary.de)) mutated.summary.de = mutated.summary.de.replace(/\d/, "x");
  expectErrors("lost number in translation fails", validateItem(mutated, cfg), "lost-number-1234");

  // 17) unexpected item key
  mutated = clone(baseItem);
  mutated.weight = 0.5;
  expectErrors("unexpected item key fails", validateItem(mutated, cfg), "unexpected-key weight");

  // 18) missing provenance
  mutated = clone(baseItem);
  delete mutated.provenance;
  expectErrors("missing provenance fails", validateItem(mutated, cfg), "missing-provenance");

  // 19) index title drift
  const drifted = indexOf(baseItem);
  drifted.title = { ...drifted.title, en: "Different title" };
  expectErrors(
    "index/item title drift fails",
    validateIndexEntry(drifted, baseItem, cfg),
    "title-mismatch",
  );

  // 20) the real corpus must pass when it exists
  if (existsSync(join(DATA_DIR, "index.ts"))) {
    test("generated corpus passes validateCorpus", async () => {
      const index = (await import(pathToFileURL(join(DATA_DIR, "index.ts")).href)).default;
      const manifestModule = await import(pathToFileURL(join(DATA_DIR, "manifest.ts")).href);
      const manifestValue = {
        CHUNK_SIZE: manifestModule.CHUNK_SIZE,
        CHUNK_COUNT: manifestModule.CHUNK_COUNT,
        TOTAL_ITEMS: manifestModule.TOTAL_ITEMS,
      };
      const chunkNames = (await readdir(DATA_DIR))
        .filter((name) => /^chunk-\d+\.ts$/.test(name))
        .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
      const chunks = [];
      for (const name of chunkNames)
        chunks.push((await import(pathToFileURL(join(DATA_DIR, name)).href)).default);
      const result = validateCorpus({ index, chunks, manifest: manifestValue }, cfg);
      if (result.errors.length)
        throw new Error(
          String(result.errors.length) + " errors: " + JSON.stringify(result.errors.slice(0, 5)),
        );
      if (chunkNames.length !== manifestValue.CHUNK_COUNT) throw new Error("chunk count mismatch");
    });
  }

  let failed = 0;
  for (const entry of tests) {
    try {
      await entry.run();
      console.log("PASS " + entry.name);
    } catch (error) {
      failed += 1;
      console.log("FAIL " + entry.name + " :: " + error.message);
    }
  }
  console.log("");
  if (failed) {
    console.log("SELFTEST FAIL: " + String(failed) + "/" + String(tests.length) + " checks failed");
    process.exitCode = 1;
    return;
  }
  console.log(
    "SELFTEST PASS: " +
      String(tests.length) +
      "/" +
      String(tests.length) +
      " checks (validator failure classes proven non-vacuous)",
  );
}

main().catch((error) => {
  console.error("selftest failed: " + error.message);
  process.exit(1);
});
