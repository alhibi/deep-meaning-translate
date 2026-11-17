/**
 * Three-language core metadata for the Met corpus (A09, task-17).
 *
 * Translates each sourced English title and summary into Arabic and German with the project
 * model (DeepSeek, OpenAI-compatible JSON batches). The English source is never modified and
 * the record provenance stays "machine-translated".
 *
 * Bounded and cacheable:
 *   - one batch = up to BATCH_SIZE records, one request per batch, at most MAX_REQUESTS;
 *   - every translated string is cached by sha256(prompt version, locale, field, English);
 *   - an existing src/lib/culture/data corpus is used as a warm cache, so a rebuild after a
 *     mapping change costs zero model calls;
 *   - a batch that keeps failing validation is split, and any string still missing is
 *     reported and the script exits 1 - no placeholder is ever written.
 *
 * Usage:
 *   node scripts/culture/translate.mjs                 # fill the cache (warm starts are free)
 *   node scripts/culture/translate.mjs --limit=12      # smoke test on a few records
 *   node scripts/culture/translate.mjs --dry-run       # report coverage only
 *   node scripts/culture/translate.mjs --regenerate    # ignore the cache
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACT_DIR, DATA_DIR, REPO_ROOT, log, sha256 } from "./lib.mjs";

const SNAPSHOT_PATH = join(ARTIFACT_DIR, "snapshot.json");
const CACHE_PATH = join(ARTIFACT_DIR, "translation-cache.json");
const TRANSLATIONS_PATH = join(ARTIFACT_DIR, "translations.json");

const MODEL = "deepseek-flash";
const BASE = "https://api.deepseek.com";
const PROMPT_VERSION = "met-trilingual-v2";
const BATCH_SIZE = 12;
const MAX_REQUESTS = 160;
const CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 90000;
/** Documented deepseek-flash off-peak cache-miss prices, per 1M tokens (2026-11-17 docs). */
const PRICE_INPUT_PER_M = 0.15;
const PRICE_OUTPUT_PER_M = 0.6;

const SYSTEM_PROMPT = [
  "You are a precise museum-catalogue translator for a cultural discovery app.",
  "Translate each English museum object title and summary into Modern Standard Arabic (ar)",
  "and German (de).",
  "",
  "Rules:",
  "- Preserve every fact exactly: numbers, years, dates, eras, materials, place names,",
  "  people/proper names and object types. Do not add, omit, explain, soften or embellish.",
  "- Keep numerals as Western digits 0-9 exactly as in the source (never Arabic-Indic digits).",
  "- German: keep Latin-script proper names and place names in their usual German form.",
  "- Arabic: transliterate proper names into Arabic script; use formal museum-label Arabic.",
  "- Translate materials and object terms accurately; never substitute a different animal,",
  "  material or object. If a specialised term has no confident equivalent, give the best",
  "  equivalent and keep the English term in parentheses.",
  "- Preserve the grammatical number of the English title (singular stays singular).",
  "- A title stays a short noun phrase; do not turn it into a full sentence.",
  "- A summary stays one or two factual sentences in museum-label register.",
  "- Never output notes, the English text, or any explanation.",
  "",
  'Reply with one JSON object only: {"items":[{"id":"<id>","ar":{"title":"...","summary":"..."},"de":{"title":"...","summary":"..."}}]}',
].join("\n");

function parseArgs(argv) {
  const args = {
    limit: null,
    batchSize: BATCH_SIZE,
    maxRequests: MAX_REQUESTS,
    concurrency: CONCURRENCY,
    dryRun: false,
    regenerate: false,
  };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--regenerate") args.regenerate = true;
    else if (raw.startsWith("--limit=")) args.limit = Math.max(1, Number(raw.slice(8)) || 0);
    else if (raw.startsWith("--batch-size="))
      args.batchSize = Math.max(1, Number(raw.slice(13)) || BATCH_SIZE);
    else if (raw.startsWith("--max-requests="))
      args.maxRequests = Math.max(1, Number(raw.slice(15)) || MAX_REQUESTS);
    else throw new Error("Unknown argument: " + raw);
  }
  return args;
}

function readDotEnv() {
  const envPath = join(REPO_ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

const ARABIC_LETTER = /[\u0621-\u064A]/;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;
const ARABIC_TO_WESTERN = {
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

function numericTokens(text) {
  return Array.from(new Set((text.match(/\d{3,}/g) || []).map((token) => token.trim())));
}

function hasNumber(text, token) {
  if (text.includes(token)) return true;
  let western = text;
  for (const [arabic, latin] of Object.entries(ARABIC_TO_WESTERN)) {
    western = western.split(arabic).join(latin);
  }
  return western.includes(token);
}

/** Deterministic quality gate for one translated record; failures are retried, never hidden. */
function validateTranslation(record, translated) {
  const problems = [];
  const locales = ["ar", "de"];
  for (const locale of locales) {
    const entry = translated && translated[locale];
    if (!entry || typeof entry.title !== "string" || typeof entry.summary !== "string") {
      problems.push(locale + ":missing");
      continue;
    }
    const title = entry.title.replace(/\s+/g, " ").trim();
    const summary = entry.summary.replace(/\s+/g, " ").trim();
    if (!title) problems.push(locale + ":empty-title");
    if (!summary) problems.push(locale + ":empty-summary");
    if (/[<>]|https?:\/\//.test(title + " " + summary)) problems.push(locale + ":markup");
    if (title.length > record.title.en.length * 3.5 + 20) problems.push(locale + ":title-too-long");
    if (summary.length < record.summary.en.length * 0.3)
      problems.push(locale + ":summary-too-short");
    if (summary.length > record.summary.en.length * 2.6 + 40)
      problems.push(locale + ":summary-too-long");
    if (locale === "ar") {
      if (!ARABIC_LETTER.test(title)) problems.push("ar:title-not-arabic");
      if ((summary.match(/[\u0621-\u064A]/g) || []).length < 4)
        problems.push("ar:summary-not-arabic");
    } else {
      if (ARABIC_LETTER.test(title + " " + summary)) problems.push("de:contains-arabic");
      if (summary === record.summary.en) problems.push("de:summary-identical");
    }
    for (const token of numericTokens(record.summary.en)) {
      if (!hasNumber(title + " " + summary, token)) problems.push(locale + ":lost-number-" + token);
    }
  }
  if (!problems.length && translated.ar.summary === translated.de.summary) {
    problems.push("locales-identical");
  }
  return { ok: problems.length === 0, problems };
}

function translationKey(locale, field, english) {
  return sha256(PROMPT_VERSION + "|" + locale + "|" + field + "|" + english);
}

function assemble(cache, record) {
  const out = {};
  for (const locale of ["ar", "de"]) {
    out[locale] = {
      title: cache[translationKey(locale, "title", record.title.en)] || "",
      summary: cache[translationKey(locale, "summary", record.summary.en)] || "",
    };
  }
  return out;
}

/** Warm cache from an already generated corpus (previous build), so remaps are free. */
async function loadGeneratedCorpus() {
  if (!existsSync(join(DATA_DIR, "index.ts"))) return [];
  const files = (await readdir(DATA_DIR)).filter((name) => /^chunk-\d+\.ts$/.test(name));
  const items = [];
  for (const file of files) {
    try {
      const module = await import("file://" + join(DATA_DIR, file));
      const chunk = module.default;
      if (chunk && Array.isArray(chunk.items)) items.push(...chunk.items);
    } catch (error) {
      log("warm cache: cannot import " + file + " (" + error.message + ")");
    }
  }
  return items;
}

async function callModel(apiKey, batch) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(BASE + "/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        thinking: { type: "disabled" },
        temperature: 0.2,
        max_tokens: 6000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              task: "Translate to Arabic and German. Return JSON.",
              items: batch.map((record) => ({
                id: record.id,
                title: record.title.en,
                summary: record.summary.en,
              })),
            }),
          },
        ],
      }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const error = new Error("DeepSeek HTTP " + response.status);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    const choice = payload.choices && payload.choices[0];
    const finish = choice && choice.finish_reason;
    if (finish !== "stop") throw new Error("DeepSeek finish_reason=" + String(finish));
    const raw = choice && choice.message && choice.message.content;
    if (typeof raw !== "string" || !raw.trim()) throw new Error("DeepSeek empty reply");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) throw new Error("DeepSeek reply missing items");
    const usage = payload.usage || {};
    return {
      items: parsed.items,
      usage: {
        prompt: Number(usage.prompt_tokens) || 0,
        completion: Number(usage.completion_tokens) || 0,
      },
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(ARTIFACT_DIR, { recursive: true });

  const snapshot = await readJson(SNAPSHOT_PATH);
  if (!snapshot || !Array.isArray(snapshot.items)) {
    throw new Error("No snapshot at " + SNAPSHOT_PATH + "; run ingest.mjs first");
  }
  let records = snapshot.items;
  if (args.limit) records = records.slice(0, args.limit);

  const env = readDotEnv();
  const apiKey = (process.env.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey && !args.dryRun)
    throw new Error("DEEPSEEK_API_KEY is not configured (read from .env, never printed)");

  const cache = args.regenerate ? {} : (await readJson(CACHE_PATH)) || {};
  if (!args.regenerate) {
    for (const item of await loadGeneratedCorpus()) {
      for (const locale of ["ar", "de"]) {
        const title = item.title && item.title[locale];
        const summary = item.summary && item.summary[locale];
        if (title && item.title.original) {
          cache[translationKey(locale, "title", item.title.original)] = title;
        }
        if (summary && item.summary.en) {
          cache[translationKey(locale, "summary", item.summary.en)] = summary;
        }
      }
    }
  }

  const existing = (await readJson(TRANSLATIONS_PATH)) || { translations: {} };
  for (const record of records) {
    const previous = existing.translations && existing.translations[record.id];
    if (!previous) continue;
    for (const locale of ["ar", "de"]) {
      const title = previous[locale] && previous[locale].title;
      const summary = previous[locale] && previous[locale].summary;
      if (title) cache[translationKey(locale, "title", record.title.en)] = title;
      if (summary) cache[translationKey(locale, "summary", record.summary.en)] = summary;
    }
  }
  const completed = new Map();
  const pending = [];
  for (const record of records) {
    const translated = assemble(cache, record);
    const gate = validateTranslation(record, translated);
    if (gate.ok) completed.set(record.id, { ...translated, problems: [] });
    else pending.push({ record, problems: gate.problems });
  }

  log(
    "coverage before run: " +
      String(completed.size) +
      "/" +
      String(records.length) +
      " records; pending " +
      String(pending.length) +
      "; cache entries " +
      String(Object.keys(cache).length),
  );

  let requests = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let failed = 0;
  const inflight = new Set();

  async function translateRecords(group) {
    if (!group.length) return { ok: [], failed: [] };
    let attempts = 0;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      attempts += 1;
      if (requests >= args.maxRequests) {
        return { ok: [], failed: group, error: "request budget exhausted" };
      }
      requests += 1;
      try {
        const result = await callModel(apiKey, group);
        totalPrompt += result.usage.prompt;
        totalCompletion += result.usage.completion;
        const byId = new Map(result.items.map((item) => [String(item.id), item]));
        const ok = [];
        const retry = [];
        for (const record of group) {
          const translated = byId.get(record.id);
          const gate = validateTranslation(record, translated);
          if (gate.ok) {
            for (const locale of ["ar", "de"]) {
              cache[translationKey(locale, "title", record.title.en)] =
                translated[locale].title.trim();
              cache[translationKey(locale, "summary", record.summary.en)] =
                translated[locale].summary.trim();
            }
            ok.push({ record, translated });
          } else {
            retry.push({ record, translated, problems: gate.problems });
          }
        }
        await writeFile(CACHE_PATH, JSON.stringify(cache) + "\n");
        if (retry.length && group.length > 1) {
          // Split the batch: a single bad record must not hold back its neighbours.
          const half = Math.ceil(retry.length / 2);
          const first = await translateRecords(retry.slice(0, half).map((entry) => entry.record));
          const second = await translateRecords(retry.slice(half).map((entry) => entry.record));
          return { ok: ok.concat(first.ok, second.ok), failed: first.failed.concat(second.failed) };
        }
        return { ok, failed: retry.map((entry) => entry.record) };
      } catch (error) {
        lastError = error;
        if (error.status === 401 || error.status === 403 || error.status === 402) throw error;
        if (attempt < 2) await sleep(2000 * (attempt + 1));
      }
    }
    if (group.length > 1) {
      const half = Math.ceil(group.length / 2);
      log("  batch failing (" + String(lastError && lastError.message) + "), splitting");
      const first = await translateRecords(group.slice(0, half));
      const second = await translateRecords(group.slice(half));
      return { ok: first.ok.concat(second.ok), failed: first.failed.concat(second.failed) };
    }
    log(
      "  record failed after retries: " +
        group[0].id +
        " (" +
        String(lastError && lastError.message) +
        ")",
    );
    return { ok: [], failed: group };
  }

  if (!args.dryRun && pending.length) {
    const queue = pending.map((entry) => entry.record);
    const groups = [];
    for (let index = 0; index < queue.length; index += args.batchSize) {
      groups.push(queue.slice(index, index + args.batchSize));
    }
    log(
      "translating " +
        String(queue.length) +
        " records in " +
        String(groups.length) +
        " batches of up to " +
        String(args.batchSize) +
        " (max " +
        String(args.maxRequests) +
        " requests)",
    );
    const started = Date.now();
    let cursor = 0;
    async function worker() {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= groups.length) return;
        const result = await translateRecords(groups[index]);
        for (const entry of result.ok) {
          completed.set(entry.record.id, {
            ar: {
              title: entry.translated.ar.title.trim(),
              summary: entry.translated.ar.summary.trim(),
            },
            de: {
              title: entry.translated.de.title.trim(),
              summary: entry.translated.de.summary.trim(),
            },
            problems: [],
          });
        }
        failed += result.failed.length;
        log(
          "  batch " +
            String(index + 1) +
            "/" +
            String(groups.length) +
            " ok " +
            String(result.ok.length) +
            " retry " +
            String(result.failed.length) +
            " (requests " +
            String(requests) +
            ")",
        );
      }
    }
    const workers = [];
    for (let index = 0; index < Math.max(1, args.concurrency); index += 1) workers.push(worker());
    await Promise.all(workers);
    log("translation run finished in " + String(Math.round((Date.now() - started) / 1000)) + "s");
  }

  // Final report over the records this run covers (all of them unless --limit was used).
  const allRecords = records;
  const translations = {};
  let covered = 0;
  const stillMissing = [];
  for (const record of allRecords) {
    const existingEntry = completed.get(record.id);
    const translated = existingEntry || assemble(cache, record);
    const gate = validateTranslation(record, translated);
    if (gate.ok) {
      translations[record.id] = { ar: translated.ar, de: translated.de };
      covered += 1;
    } else {
      stillMissing.push({ id: record.id, problems: gate.problems });
    }
  }
  const output = {
    generatedWith: "scripts/culture/translate.mjs",
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    promptTokens: totalPrompt,
    completionTokens: totalCompletion,
    requests,
    estimatedCostUsd:
      Math.round(
        ((totalPrompt / 1000000) * PRICE_INPUT_PER_M +
          (totalCompletion / 1000000) * PRICE_OUTPUT_PER_M) *
          10000,
      ) / 10000,
    coverage: { records: allRecords.length, translated: covered, missing: stillMissing.length },
    translations,
  };
  await writeFile(TRANSLATIONS_PATH, JSON.stringify(output) + "\n");
  log(
    "coverage: " +
      String(covered) +
      "/" +
      String(allRecords.length) +
      " ar=100%? " +
      String(covered === allRecords.length) +
      "; requests " +
      String(requests) +
      "; tokens in " +
      String(totalPrompt) +
      " out " +
      String(totalCompletion),
  );
  if (stillMissing.length) {
    log("missing translations: " + JSON.stringify(stillMissing.slice(0, 10)));
    process.exitCode = 1;
  }
  console.log(
    JSON.stringify({
      ok: stillMissing.length === 0,
      coverage: output.coverage,
      requests,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      estimatedCostUsd: output.estimatedCostUsd,
    }),
  );
}

main().catch((error) => {
  console.error("translate failed: " + error.message);
  process.exit(1);
});
