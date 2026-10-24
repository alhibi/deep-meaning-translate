/**
 * Bundle budget: the production JS/CSS payload may not silently grow.
 *
 * A premium-feeling app is a fast app on a mid-range phone and a slow network;
 * bundle creep is how that quietly dies. This check runs in CI after the build
 * and fails when the gzipped payload crosses the budget, so any growth must be
 * a deliberate, reviewed decision (raise the number here, in the same commit
 * that explains why) instead of an accident nobody noticed.
 *
 * Budgets are set ~7% above the measured payload at introduction
 * (2026-10-24: JS 229.8 KB gzip total, largest chunk 128.7 KB, CSS 12.7 KB).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET = {
  jsTotalKb: 245,
  jsLargestChunkKb: 140,
  cssTotalKb: 16,
};

const assetsDir = join(new URL("../.output/public/assets/", import.meta.url).pathname);

let jsTotal = 0;
let jsLargest = { kb: 0, file: "" };
let cssTotal = 0;

for (const file of await readdir(assetsDir)) {
  if (!file.endsWith(".js") && !file.endsWith(".css")) continue;
  const gzKb = gzipSync(await readFile(join(assetsDir, file))).length / 1024;
  if (file.endsWith(".js")) {
    jsTotal += gzKb;
    if (gzKb > jsLargest.kb) jsLargest = { kb: gzKb, file };
  } else {
    cssTotal += gzKb;
  }
}

const rows = [
  ["JS total (gzip)", jsTotal, BUDGET.jsTotalKb],
  [`JS largest chunk (gzip) — ${jsLargest.file}`, jsLargest.kb, BUDGET.jsLargestChunkKb],
  ["CSS total (gzip)", cssTotal, BUDGET.cssTotalKb],
];

let failed = false;
for (const [label, actual, budget] of rows) {
  const ok = actual <= budget;
  if (!ok) failed = true;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual.toFixed(1)} KB / ${budget} KB budget`);
}

if (failed) {
  console.error(
    "\nBundle budget exceeded. Either shrink the payload or raise the budget in " +
      "scripts/check-bundle.mjs in this same commit, with the reason in the commit message.",
  );
  process.exit(1);
}
console.log("Bundle budget OK.");
