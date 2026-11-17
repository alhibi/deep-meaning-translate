#!/usr/bin/env node
/**
 * Zero-tolerance gate for the cultural knowledge library's content product.
 *
 * The library is a written, text-first cultural encyclopedia: no imported photographs, no
 * museum-object catalogue, no external image hosts, no media field. This gate fails the build
 * if the product drifts back toward an image catalogue or if the corpus carries object records.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const problems = [];
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");
const list = (relative) =>
  existsSync(join(ROOT, relative)) ? readdirSync(join(ROOT, relative)) : [];

const UI_DIR = "src/components/culture";
if (!existsSync(join(ROOT, UI_DIR))) problems.push(UI_DIR + ": missing");
for (const file of list(UI_DIR)) {
  if (!/\.(tsx?|css)$/.test(file)) continue;
  const source = read(join(UI_DIR, file));
  if (/<img\b/i.test(source)) problems.push(UI_DIR + "/" + file + ": contains an img element");
  if (/media\s*[:=]/.test(source))
    problems.push(UI_DIR + "/" + file + ": references a media field");
  if (/https?:\/\/[^"\s]+\/(jpe?g|png|webp|gif|avif)/i.test(source))
    problems.push(UI_DIR + "/" + file + ": contains a remote image URL");
}

const DATA_DIR = "src/lib/culture/data";
const dataFiles = list(DATA_DIR).filter((file) => file.endsWith(".ts"));
if (dataFiles.length === 0) problems.push(DATA_DIR + ": corpus is missing");
for (const file of dataFiles) {
  const source = read(join(DATA_DIR, file));
  if (/\bmedia\s*:/.test(source)) problems.push(DATA_DIR + "/" + file + ": contains a media field");
  if (/images\.metmuseum|metmuseum\.org|collectionapi\.metmuseum/.test(source))
    problems.push(DATA_DIR + "/" + file + ": museum host");
  const urls = [...source.matchAll(/https?:\/\/[^"\\\s]+/g)].map((m) => m[0]);
  for (const url of urls) {
    if (!url.startsWith("https://")) problems.push(DATA_DIR + "/" + file + ": non-https reference");
    if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url))
      problems.push(DATA_DIR + "/" + file + ": image reference");
  }
}

if (problems.length) {
  console.error("FAIL - cultural content gate");
  for (const problem of problems.slice(0, 40)) console.error(" - " + problem);
  process.exit(1);
}
console.log(
  "PASS - cultural library is text-first, image-free and free of museum-object content (" +
    dataFiles.length +
    " corpus modules, " +
    list(UI_DIR).length +
    " UI files)",
);
