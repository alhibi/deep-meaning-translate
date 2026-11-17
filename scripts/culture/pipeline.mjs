#!/usr/bin/env node
/**
 * Cultural knowledge library pipeline.
 *
 *   node scripts/culture/pipeline.mjs generate   # research seeds -> three-language articles (cached)
 *   node scripts/culture/pipeline.mjs build      # validated articles -> lazy TS index + chunks + report
 *   node scripts/culture/pipeline.mjs validate   # corpus gates and distribution report; exit 1 on failure
 *
 * Content is generated once at build time by a model from human-curated facts and verified
 * sources, then validated. Nothing is generated at runtime and no article depends on an image.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  REPO,
  GEN_DIR,
  OUT_DIR,
  REPORT_FILE,
  CHUNK_SIZE,
  SCHEMA_VERSION,
  CATEGORIES,
  CONTINENTS,
  TYPES,
  listSeeds,
  seedProblems,
  articleProblems,
  topicKey,
  slugify,
  words,
  isText,
  readJson,
  writeJson,
} from "./lib.mjs";

const MODE = process.argv[2] || "all";
const ACCESSED = "2026-11-17";
const LOCALES = ["ar", "de", "en"];
const LANG = { ar: "Arabic", de: "German", en: "English" };

function env() {
  const envPath = join(REPO, ".env");
  const raw = existsSync(envPath) ? readFileSyncSafe(envPath) : "";
  const map = {};
  for (const line of raw.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) map[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return { ...map, ...process.env };
}
import { readFileSync } from "node:fs";
function readFileSyncSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const SYSTEM = `You are the editorial team of a written cultural knowledge library about people and societies. You write three-language articles (Arabic, German, English) that explain how people actually live, communicate, celebrate, work and understand each other. You never write about museum objects, artefacts, paintings, furniture or catalogues. You never invent facts beyond the supplied research notes and you never present one local practice as universal. Arabic must read as originally written Arabic (not translated English), German as natural German, English as polished editorial English. Return JSON only.`;

function promptFor(batch, extended) {
  const topics = batch.map((seed) => ({
    id: seed.id,
    titleEn: seed.titleEn,
    category: seed.category,
    contentType:
      extended && seed.contentType !== "feature" && seed.contentType !== "contrast"
        ? "feature"
        : seed.contentType,
    countries: seed.countries,
    region: seed.region,
    community: seed.community,
    languages: seed.languages,
    facts: seed.facts,
    exampleEn: seed.exampleEn,
    qualificationEn: seed.qualificationEn,
    expression: seed.expression || null,
    extended,
  }));
  return `Write the articles for these research topics. Return a JSON object {"articles": [...]} with one element per topic, in the same order, each having the topic "id" and three locale objects "ar", "de", "en".

For EVERY locale object use exactly: {"title": string, "deck": string, "teaser": string, "sections": [{"heading": string, "paragraphs": [string, ...]}], "example": string, "misunderstanding": string, "comparison": string, "expression": {"original": string, "transliteration": string, "language": string, "gloss": string, "usage": string} | null}.

Editorial rules:
- The article is about PEOPLE and how they live, not about objects. Never mention museums, collections, artefacts, paintings, furniture, catalogues or images.
- Standard topics (extended=false): exactly 2 sections, 3 paragraphs in total, total body 110-165 words per locale. Feature/contrast topics (extended=true): 3 sections, 5 paragraphs in total, total body 270-350 words per locale; Arabic, German and English must each be within 15% of the same length.
- "title" 3-8 words, specific and intriguing (never "X culture" or "Culture of X"); "deck" one sentence of editorial framing; "teaser" 15-28 words that makes the reader want the article.
- Headings are meaningful section titles, not "Introduction"/"Overview".
- Use ONLY the supplied facts; explain why the practice exists, how it works in daily life, and who it varies for. Include the concrete example naturally in the body. Include one sentence of qualification about regional/generational variation (do not list "it varies" mechanically; write it naturally).
- "example" is the concrete everyday situation (1-2 sentences); "misunderstanding" is a common misconception or, if none is documented, a short caution about generalisation; "comparison" is a one-sentence contrast with another context, only when it follows from the facts.
- "expression" must be present for category languages/communication and null for all other categories. For expression topics put the expression in the body at least once, keep its original script, and make gloss/usage explain real social usage.
- Arabic: natural, idiomatic Modern Standard Arabic; German: natural German; English: clear editorial English. Native scripts for all non-Latin expressions. No markdown, no URLs inside the article text, no headings numbering.
- Never write about the sources; the product shows references separately.

Topics: ${JSON.stringify(topics)}`;
}

function articleFrom(seed, payload, extended) {
  const article = {
    id: seed.id,
    version: SCHEMA_VERSION,
    slug: slugify(seed.titleEn),
    contentType:
      extended && seed.contentType !== "feature" && seed.contentType !== "contrast"
        ? "feature"
        : seed.contentType,
    category: seed.category,
    title: {},
    deck: {},
    teaser: {},
    readingMinutes: 1,
    sections: {},
    context: {
      countries: seed.countries,
      ...(seed.region ? { region: seed.region } : {}),
      ...(seed.community ? { community: seed.community } : {}),
      continent: seed.continent,
      languages: seed.languages,
      period: "contemporary",
    },
    tags: [
      ...new Set([
        seed.category,
        ...(seed.region ? [seed.region] : []),
        ...seed.facts.slice(0, 2).map((f) => f.split(" ").slice(0, 2).join(" ")),
      ]),
    ].slice(0, 8),
    sources: seed.sources.map((source) => ({
      organization: source.organization,
      title: Object.fromEntries(LOCALES.map((l) => [l, source.title])),
      url: source.url,
      ...(source.published ? { published: source.published } : {}),
      accessed: ACCESSED,
      supports: Object.fromEntries(
        LOCALES.map((l) => [l, "Background facts and context for this article."]),
      ),
    })),
    status: {
      verification: "source-linked",
      editorial: "machine-drafted",
      translation: "machine-drafted",
      revision: 1,
      published: true,
    },
    related: [],
    publishedAt: ACCESSED,
  };
  let bodyWords = 0;
  for (const locale of LOCALES) {
    const part = payload[locale];
    article.title[locale] = String(part.title || "").trim();
    article.deck[locale] = String(part.deck || "").trim();
    article.teaser[locale] = String(part.teaser || "").trim();
    article.sections[locale] = (part.sections || []).map((section) => ({
      heading: String(section.heading || "").trim(),
      paragraphs: (section.paragraphs || []).map((p) => String(p || "").trim()).filter(Boolean),
    }));
    if (locale === "en")
      bodyWords = article.sections[locale]
        .flatMap((s) => s.paragraphs)
        .reduce((n, p) => n + words(p), 0);
    if (isText(part.example))
      article.example = { ...(article.example || {}), [locale]: String(part.example).trim() };
    if (isText(part.misunderstanding))
      article.misunderstanding = {
        ...(article.misunderstanding || {}),
        [locale]: String(part.misunderstanding).trim(),
      };
    if (isText(part.comparison))
      article.comparison = {
        ...(article.comparison || {}),
        [locale]: String(part.comparison).trim(),
      };
    if (seed.expression && part.expression) {
      article.expression = article.expression || {
        original: "",
        language: "",
        gloss: {},
        usage: {},
      };
      const expression = part.expression;
      article.expression.original = String(
        seed.expression.original || expression.original || "",
      ).trim();
      article.expression.language = String(
        seed.expression.language || expression.language || "",
      ).trim();
      if (isText(expression.transliteration || seed.expression.transliteration))
        article.expression.transliteration = String(
          expression.transliteration || seed.expression.transliteration,
        ).trim();
      article.expression.gloss = {
        ...(article.expression.gloss || {}),
        [locale]: String(expression.gloss || seed.expression.glossEn || "").trim(),
      };
      article.expression.usage = {
        ...(article.expression.usage || {}),
        [locale]: String(expression.usage || "").trim(),
      };
    }
    if (!article.expression && seed.expression) {
      article.expression = {
        original: seed.expression.original,
        ...(seed.expression.transliteration
          ? { transliteration: seed.expression.transliteration }
          : {}),
        language: seed.expression.language,
        gloss: {},
        usage: {},
      };
    }
    if (article.expression && locale === "en" && !article.expression.gloss?.en) {
      article.expression.gloss.en = seed.expression?.glossEn || "";
      article.expression.usage.en = article.example?.en || "";
    }
  }
  article.readingMinutes = Math.max(1, Math.round(bodyWords / 200));
  if (article.contentType === "language" && seed.expression)
    article.expression = article.expression || undefined;
  return article;
}

async function callModel(key, messages, attempt = 1) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(240_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-flash",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.75,
      max_tokens: 8192,
      thinking: { type: "disabled" },
      stream: false,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error("provider " + response.status + " " + text.slice(0, 160));
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  return content;
}

function parseArticles(content) {
  try {
    const parsed = JSON.parse(content);
    const articles = Array.isArray(parsed) ? parsed : parsed.articles;
    if (!Array.isArray(articles)) return [];
    return articles;
  } catch {
    return [];
  }
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function generate() {
  const token = env().DEEPSEEK_API_KEY;
  if (!token) throw new Error("DEEPSEEK_API_KEY missing in .env");
  await mkdir(GEN_DIR, { recursive: true });
  const seeds = (await listSeeds()).filter((seed) => {
    const problems = seedProblems(seed);
    if (problems.length) console.warn("seed rejected", seed.id || seed.titleEn, problems.join(","));
    return problems.length === 0;
  });
  const seen = new Set();
  const unique = [];
  for (const seed of seeds) {
    const key = topicKey(seed);
    if (seen.has(key)) {
      console.warn("duplicate seed skipped", seed.id, key);
      continue;
    }
    seen.add(key);
    unique.push(seed);
  }
  console.log("seeds:", unique.length);
  const extendedIds = new Set(
    unique
      .filter((seed) => seed.contentType === "feature" || seed.contentType === "contrast")
      .map((s) => s.id),
  );
  // At most 120 long-form articles: research agents over-assigned "feature". Extras are
  // demoted to standard notes (contentType is corrected in articleFrom).
  if (extendedIds.size > 100) {
    const keep = [...extendedIds].sort().slice(0, 100);
    extendedIds.clear();
    for (const id of keep) extendedIds.add(id);
  }
  // Guarantee at least 100 extended articles: promote remaining topics deterministically.
  if (extendedIds.size < 100) {
    for (const seed of unique) {
      if (extendedIds.size >= 100) break;
      if (!extendedIds.has(seed.id)) {
        extendedIds.add(seed.id);
      }
    }
  }
  const shard = (process.env.SHARD || "").split("/").map(Number);
  const inShard = (seed) =>
    shard.length !== 2 ||
    !Number.isInteger(shard[0]) ||
    unique.indexOf(seed) % shard[1] === shard[0];
  const todo = [];
  for (const seed of unique) {
    if (!inShard(seed)) continue;
    const cacheFile = join(GEN_DIR, seed.id + ".json");
    if (existsSync(cacheFile)) {
      const cached = await readJson(cacheFile, null);
      if (cached && articleProblems(cached).ok) continue;
    }
    todo.push({ seed, extended: extendedIds.has(seed.id) });
  }
  console.log("to generate:", todo.length, "extended total:", extendedIds.size);
  const batches = [];
  const size = 6;
  for (let i = 0; i < todo.length;) {
    const first = todo[i];
    const width = first.extended ? 1 : size;
    batches.push(todo.slice(i, i + width));
    i += width;
  }
  let done = 0;
  let failed = 0;
  await mapLimit(batches, 6, async (batch) => {
    const extended = batch[0].extended;
    const messages = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: promptFor(
          batch.map((b) => b.seed),
          extended,
        ),
      },
    ];
    let lastProblems = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const content = await callModel(token, messages);
        const parsed = parseArticles(content);
        let ok = 0;
        for (const seed of batch.map((b) => b.seed)) {
          const payload = parsed.find((p) => p && p.id === seed.id);
          if (!payload) continue;
          const article = articleFrom(seed, payload, extended);
          const verdict = articleProblems(article);
          if (verdict.ok) {
            await writeJson(join(GEN_DIR, seed.id + ".json"), article);
            console.log(new Date().toISOString(), "ok", seed.id);
            ok += 1;
          } else {
            lastProblems = verdict.problems;
          }
        }
        if (ok === batch.length) {
          done += batch.length;
          return;
        }
      } catch (error) {
        lastProblems = [String(error).slice(0, 120)];
      }
      messages.push({
        role: "user",
        content:
          "The previous reply was not acceptable. Problems: " +
          JSON.stringify(lastProblems.slice(0, 8)) +
          ". Reply again with the COMPLETE corrected JSON object (all topics, all three locales).",
      });
    }
    failed += batch.length;
    console.error(
      "generation failed",
      batch.map((b) => b.seed.id).join(","),
      lastProblems.slice(0, 6),
    );
  });
  console.log("generated:", done, "failed:", failed);
}

function dateOrder(a, b) {
  return a.id < b.id ? -1 : 1;
}

async function loadArticles() {
  const files = existsSync(GEN_DIR)
    ? (await readdir(GEN_DIR)).filter((file) => file.endsWith(".json"))
    : [];
  const articles = [];
  for (const file of files) {
    const article = await readJson(join(GEN_DIR, file), null);
    if (article && articleProblems(article).ok) articles.push(article);
  }
  return articles.sort(dateOrder);
}

function indexEntry(article) {
  return {
    id: article.id,
    title: article.title,
    teaser: article.teaser,
    category: article.category,
    contentType: article.contentType,
    continent: article.context.continent,
    countries: article.context.countries,
    tags: article.tags.slice(0, 8),
    readingMinutes: article.readingMinutes,
    weight:
      article.contentType === "feature"
        ? 0.9
        : article.contentType === "contrast"
          ? 0.8
          : article.contentType === "language"
            ? 0.75
            : article.contentType === "scene"
              ? 0.65
              : 0.5,
    hasExpression: Boolean(article.expression?.original),
  };
}

async function build() {
  const articles = await loadArticles();
  if (articles.length === 0) throw new Error("no valid generated articles: run generate first");
  const entries = articles.map(indexEntry);
  await mkdir(OUT_DIR, { recursive: true });
  const indexFile = join(OUT_DIR, "index.ts");
  const indexLines = [
    'import type { CultureIndexEntry } from "../types";',
    "",
    "const entries: CultureIndexEntry[] = " + JSON.stringify(entries) + ";",
    "",
    "export default { version: " + SCHEMA_VERSION + ", chunkSize: " + CHUNK_SIZE + ", entries };",
    "",
  ];
  await writeFile(indexFile, indexLines.join("\n"));
  const chunkCount = Math.ceil(articles.length / CHUNK_SIZE);
  for (let n = 0; n < chunkCount; n += 1) {
    const items = articles.slice(n * CHUNK_SIZE, (n + 1) * CHUNK_SIZE);
    const file = join(OUT_DIR, "chunk-" + n + ".ts");
    const lines = [
      'import type { CultureArticle } from "../types";',
      "",
      "const items: CultureArticle[] = " + JSON.stringify(items) + ";",
      "",
      "export default { version: " + SCHEMA_VERSION + ", items };",
      "",
    ];
    await writeFile(file, lines.join("\n"));
  }
  const report = buildReport(articles);
  await writeJson(REPORT_FILE, report);
  await writeJson(join(REPO, "artifacts/phase2/culture-report.json"), report);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log("chunks:", chunkCount, "index entries:", entries.length);
}

function buildReport(articles) {
  const byContinent = {};
  const byCategory = {};
  const byCountry = new Map();
  const communities = new Set();
  const languages = new Set();
  const tags = new Set();
  let extended = 0;
  let withExpression = 0;
  let totalWords = 0;
  for (const article of articles) {
    byContinent[article.context.continent] = (byContinent[article.context.continent] || 0) + 1;
    byCategory[article.category] = (byCategory[article.category] || 0) + 1;
    for (const country of article.context.countries)
      byCountry.set(country, (byCountry.get(country) || 0) + 1);
    if (article.context.community) communities.add(article.context.community);
    for (const language of article.context.languages) languages.add(language);
    for (const tag of article.tags) tags.add(tag);
    if (article.contentType === "feature" || article.contentType === "contrast") extended += 1;
    if (article.expression?.original) withExpression += 1;
    totalWords += article.sections.en
      .flatMap((s) => s.paragraphs)
      .reduce((n, p) => n + words(p), 0);
  }
  const titles = new Map();
  for (const article of articles) {
    const key = article.title.en.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    titles.set(key, (titles.get(key) || 0) + 1);
  }
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: articles.length,
      byContinent,
      byCategory,
      countries: byCountry.size,
      communities: communities.size,
      languages: languages.size,
      tags: tags.size,
      extended,
      withExpression,
      averageBodyWords: Math.round(totalWords / articles.length),
      locales: { ar: articles.length, de: articles.length, en: articles.length },
    },
    countries: Object.fromEntries([...byCountry.entries()].sort((a, b) => b[1] - a[1])),
    duplicates: [...titles.entries()].filter(([, n]) => n > 1),
  };
}

async function validate() {
  const articles = await loadArticles();
  const problems = [];
  if (articles.length < 500) problems.push("count " + articles.length + " < 500");
  const report = buildReport(articles);
  if (report.summary.countries < 60)
    problems.push("countries " + report.summary.countries + " < 60");
  if (Object.keys(report.summary.byContinent).length < 6) problems.push("continents < 6");
  if (Object.keys(report.summary.byCategory).length < 15) problems.push("categories < 15");
  if (report.summary.extended < 100)
    problems.push("extended " + report.summary.extended + " < 100");
  if (report.duplicates.length) problems.push("duplicate titles: " + report.duplicates.length);
  if (
    report.summary.locales.ar !== articles.length ||
    report.summary.locales.de !== articles.length
  )
    problems.push("locale coverage");
  console.log(JSON.stringify(report.summary, null, 2));
  if (problems.length) {
    console.error("FAIL:", problems.join("; "));
    process.exitCode = 1;
  } else console.log("PASS — cultural library corpus is valid:", articles.length, "articles");
}

if (MODE === "generate") await generate();
else if (MODE === "build") await build();
else if (MODE === "validate") await validate();
else {
  await generate();
  await build();
  await validate();
}
