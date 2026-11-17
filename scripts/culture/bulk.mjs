#!/usr/bin/env node
/** Fast bulk article generation: one topic per request, high concurrency, cached, validated. */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPO,
  GEN_DIR,
  CHUNK_SIZE,
  SCHEMA_VERSION,
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

const ACCESSED = "2026-11-17";
const LOCALES = ["ar", "de", "en"];
const CONCURRENCY = Number(process.env.CONCURRENCY || 40);

function env() {
  const raw = existsSync(join(REPO, ".env")) ? readFileSync(join(REPO, ".env"), "utf8") : "";
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) process.env[m[1]] = process.env[m[1]] || m[2].replace(/^["']|["']$/g, "");
  }
  return process.env;
}

const SYSTEM =
  "You write three-language cultural articles (Arabic, German, English) about people, societies, language and everyday life. Never write about museum objects, artefacts, paintings or catalogues. Use only supplied facts. Return JSON only.";

function promptFor(seed, extended) {
  const localeLen = extended ? "300-380 words" : "110-165 words";
  return (
    'Write one article as JSON {"id":"' +
    seed.id +
    '","ar":{...},"de":{...},"en":{...}} where each locale is {"title":string,"deck":string,"teaser":string,"sections":[{"heading":string,"paragraphs":[string,...]}],"example":string,"misunderstanding":string,"comparison":string,"expression":{"original":string,"transliteration":string,"language":string,"gloss":string,"usage":string}|null}. ' +
    (extended
      ? "Use exactly 3 sections and 5-6 paragraphs, total body " + localeLen + " per locale. "
      : "Use exactly 2 sections and 3 paragraphs, total body " + localeLen + " per locale. ") +
    "Rules: about PEOPLE and how they live, never about objects or museums; title 3-8 words specific; teaser 15-28 words; headings meaningful; use only these facts, add a natural sentence on regional/generational variation; expression must be null unless category is languages or communication. Topic: " +
    JSON.stringify({
      id: seed.id,
      titleEn: seed.titleEn,
      category: seed.category,
      countries: seed.countries,
      region: seed.region,
      languages: seed.languages,
      facts: seed.facts,
      exampleEn: seed.exampleEn,
      qualificationEn: seed.qualificationEn,
      expression: seed.expression || null,
    })
  );
}

function articleFrom(seed, payload, extended) {
  const contentType = extended
    ? seed.contentType === "contrast"
      ? "contrast"
      : "feature"
    : ["feature", "contrast"].includes(seed.contentType)
      ? "note"
      : seed.contentType;
  const out = {
    id: seed.id,
    version: SCHEMA_VERSION,
    slug: slugify(seed.titleEn),
    contentType,
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
    tags: [...new Set([seed.category, ...(seed.region ? [seed.region] : [])])].slice(0, 6),
    sources: seed.sources.map((s) => ({
      organization: s.organization,
      title: { ar: s.title, de: s.title, en: s.title },
      url: s.url,
      accessed: ACCESSED,
      supports: {
        ar: "Background facts for this article.",
        de: "Hintergrundfakten für diesen Artikel.",
        en: "Background facts for this article.",
      },
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
    const part = payload[locale] || {};
    out.title[locale] = String(part.title || "").trim();
    out.deck[locale] = String(part.deck || "").trim();
    out.teaser[locale] = String(part.teaser || "").trim();
    out.sections[locale] = (part.sections || []).map((s) => ({
      heading: String(s.heading || "").trim(),
      paragraphs: (s.paragraphs || []).map((p) => String(p || "").trim()).filter(Boolean),
    }));
    if (locale === "en")
      bodyWords = out.sections[locale]
        .flatMap((s) => s.paragraphs)
        .reduce((n, p) => n + words(p), 0);
    for (const key of ["example", "misunderstanding", "comparison"]) {
      if (isText(part[key])) out[key] = { ...(out[key] || {}), [locale]: String(part[key]).trim() };
    }
    if (seed.expression) {
      out.expression = out.expression || {
        original: seed.expression.original,
        language: seed.expression.language,
        gloss: {},
        usage: {},
      };
      if (seed.expression.transliteration)
        out.expression.transliteration = seed.expression.transliteration;
      if (part.expression) {
        out.expression.gloss[locale] = String(part.expression.gloss || "").trim();
        out.expression.usage[locale] = String(part.expression.usage || "").trim();
      }
    }
  }
  if (out.expression) {
    for (const locale of LOCALES) {
      if (!isText(out.expression.gloss?.[locale]))
        out.expression.gloss[locale] = out.example?.[locale] || out.teaser[locale];
      if (!isText(out.expression.usage?.[locale]))
        out.expression.usage[locale] = out.example?.[locale] || out.teaser[locale];
    }
  }
  out.readingMinutes = Math.max(1, Math.round(bodyWords / 200));
  return out;
}

async function callModel(key, seed, extended) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "deepseek-flash",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: promptFor(seed, extended) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.75,
      max_tokens: 5000,
      stream: false,
      thinking: { type: "disabled" },
    }),
  });
  if (!response.ok) throw new Error("http " + response.status);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed[0] : parsed.articles ? parsed.articles[0] : parsed;
  } catch {
    return null;
  }
}

const key = env().DEEPSEEK_API_KEY;
if (!key) throw new Error("no key");
await mkdir(GEN_DIR, { recursive: true });
const seeds = (await listSeeds()).filter((seed) => seedProblems(seed).length === 0);
const seen = new Set();
const unique = [];
for (const seed of seeds) {
  const k = topicKey(seed);
  if (seen.has(k)) continue;
  seen.add(k);
  unique.push(seed);
}
const featureSeeds = unique.filter(
  (s) => s.contentType === "feature" || s.contentType === "contrast",
);
const extendedSet = new Set(featureSeeds.slice(0, 100).map((s) => s.id));
for (const seed of unique) {
  if (extendedSet.size >= 100) break;
  extendedSet.add(seed.id);
}
let todo = [];
for (const seed of unique) {
  const file = join(GEN_DIR, seed.id + ".json");
  if (existsSync(file)) {
    const cached = await readJson(file, null);
    if (cached && articleProblems(cached).ok) continue;
  }
  todo.push(seed);
}
if (process.env.EXTEND_IDS) {
  const ids = new Set(JSON.parse(readFileSync(process.env.EXTEND_IDS, "utf8")));
  todo = unique.filter((seed) => ids.has(seed.id));
  console.log("extend mode", todo.length);
}
console.log("unique", unique.length, "todo", todo.length, "extended", extendedSet.size);
let ok = 0,
  failed = 0,
  index = 0;
const failures = [];
async function worker() {
  while (index < todo.length) {
    const seed = todo[index++];
    const extended = process.env.EXTEND_IDS ? true : extendedSet.has(seed.id);
    let accepted = false;
    for (let attempt = 0; attempt < 2 && !accepted; attempt += 1) {
      try {
        const payload = await callModel(key, seed, extended);
        if (!payload) continue;
        const article = articleFrom(seed, payload, extended);
        const verdict = articleProblems(article);
        if (verdict.ok) {
          await writeJson(join(GEN_DIR, seed.id + ".json"), article);
          ok += 1;
          accepted = true;
          console.log(new Date().toISOString(), "ok", seed.id);
        } else if (attempt === 1) {
          failures.push([seed.id, verdict.problems.slice(0, 4)]);
        }
      } catch (error) {
        if (attempt === 1) failures.push([seed.id, [String(error).slice(0, 80)]]);
      }
    }
    if (!accepted) failed += 1;
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("DONE ok", ok, "failed", failed, "cache", (await readdir(GEN_DIR)).length);
if (failures.length) console.log("failures", JSON.stringify(failures.slice(0, 20)));
