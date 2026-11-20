#!/usr/bin/env node
/**
 * Dependency freshness gate (FRONTIER) for this repository.
 *
 * Compares the RESOLVED version of every declared dependency (package-lock.json) with the
 * latest stable version published on the npm registry, writes artifacts/freshness.json and
 * reports RED items. Report mode by default; `--enforce` exits 1 on RED or ERROR.
 *
 * Policy, staging and waivers: docs/quality/freshness.md and docs/quality/freshness-waivers.json
 * Parent policy (global): ~/.dsh/skills/latest-tech-mandate/SKILL.md
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = join(ROOT, "artifacts", "freshness.json");
const PACKAGE_FILE = join(ROOT, "package.json");
const LOCK_FILE = join(ROOT, "package-lock.json");
const WAIVERS_FILE = join(ROOT, "docs", "quality", "freshness-waivers.json");
const REGISTRY = "https://registry.npmjs.org";
const USER_AGENT = "deep-meaning-translate-freshness/1.0";
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 8;
const ENFORCE = process.argv.includes("--enforce");
const PRERELEASE = /-(alpha|beta|rc|dev|preview|canary|next|eap)/i;
const RANK = { RED: 0, ERROR: 1, UNKNOWN: 2, AHEAD: 3, YELLOW: 4, FRONTIER: 5, WAIVED: 6 };

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

function aliasTarget(spec) {
  if (typeof spec !== "string" || !spec.startsWith("npm:")) return null;
  const inner = spec.slice(4);
  const at = inner.lastIndexOf("@");
  return at > 0 ? inner.slice(0, at) : inner;
}

function compare(leftVersion, rightVersion) {
  const left = String(leftVersion).split(/[-+]/)[0].split(".").map(Number);
  const right = String(rightVersion).split(/[-+]/)[0].split(".").map(Number);
  if (!left.length || !right.length || left.some(Number.isNaN) || right.some(Number.isNaN)) {
    return null;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index] ?? 0;
    const y = right[index] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function classify(resolved, latest) {
  if (!resolved) return { status: "UNKNOWN", detail: "not in package-lock.json" };
  if (PRERELEASE.test(resolved)) return { status: "RED", detail: "prerelease resolved" };
  const order = compare(resolved, latest);
  if (order === null) return { status: "UNKNOWN", detail: "unparseable version" };
  if (order === 0) return { status: "FRONTIER", detail: "current" };
  if (order > 0) return { status: "AHEAD", detail: "lockfile newer than registry latest" };
  const [resolvedMajor = 0, resolvedMinor = 0] = String(resolved)
    .split(/[-+]/)[0]
    .split(".")
    .map(Number);
  const [latestMajor = 0, latestMinor = 0] = String(latest).split(/[-+]/)[0].split(".").map(Number);
  if (latestMajor > resolvedMajor) return { status: "RED", detail: "major behind" };
  const minorGap = latestMinor - resolvedMinor;
  if (minorGap >= 2) return { status: "RED", detail: `${minorGap} minors behind` };
  if (minorGap === 1) return { status: "YELLOW", detail: "1 minor behind" };
  return { status: "YELLOW", detail: "patch behind" };
}

const pkg = await readJson(PACKAGE_FILE);
const lock = await readJson(LOCK_FILE);
const waiverDoc = await readJson(WAIVERS_FILE, { waivers: [] });
const waivers = new Map((waiverDoc.waivers ?? []).map((waiver) => [waiver.package, waiver]));
const today = new Date().toISOString().slice(0, 10);

const declared = {
  ...pkg.dependencies,
  ...(pkg.devDependencies ?? {}),
  ...(pkg.optionalDependencies ?? {}),
};
const entries = Object.entries(declared).map(([name, spec]) => {
  const target = aliasTarget(spec) ?? name;
  const resolved = lock.packages?.[`node_modules/${name}`]?.version ?? null;
  return {
    name,
    target,
    display: target === name ? name : `${name} -> ${target}`,
    resolved,
  };
});

const cache = new Map();
async function fetchLatest(name) {
  const response = await fetch(`${REGISTRY}/${name}/latest`, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.version;
}
function latestFor(name) {
  if (!cache.has(name)) cache.set(name, fetchLatest(name));
  return cache.get(name);
}

const items = [];
const queue = [...entries];
async function worker() {
  for (;;) {
    const entry = queue.shift();
    if (!entry) return;
    let latest = null;
    let error = null;
    try {
      latest = await latestFor(entry.target);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    if (error) {
      items.push({
        package: entry.display,
        resolved: entry.resolved,
        latest: null,
        status: "ERROR",
        detail: error,
        waiver: null,
      });
      continue;
    }
    const result = classify(entry.resolved, latest);
    let status = result.status;
    let detail = result.detail;
    let waiver = null;
    if (status === "RED") {
      const candidate = waivers.get(entry.name);
      if (candidate && candidate.expires && candidate.expires >= today) {
        waiver = candidate;
        status = "WAIVED";
        detail = `waived until ${candidate.expires}`;
      } else if (candidate) {
        detail = `waiver expired ${candidate.expires ?? "(no expiry)"}`;
      }
    }
    items.push({
      package: entry.display,
      resolved: entry.resolved,
      latest,
      status,
      detail,
      waiver: waiver ? { reason: waiver.reason, expires: waiver.expires } : null,
    });
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));

items.sort((left, right) => {
  const delta = (RANK[left.status] ?? 9) - (RANK[right.status] ?? 9);
  return delta !== 0 ? delta : left.package.localeCompare(right.package);
});

const count = (status) => items.filter((item) => item.status === status).length;
const summary = {
  frontier: count("FRONTIER"),
  waived: count("WAIVED"),
  yellow: count("YELLOW"),
  red: count("RED"),
  unknown: count("UNKNOWN"),
  error: count("ERROR"),
  ahead: count("AHEAD"),
};
const artifact = {
  project: pkg.name,
  generatedAt: new Date().toISOString(),
  mode: ENFORCE ? "enforce" : "report",
  summary,
  items,
};
await mkdir(dirname(ARTIFACT), { recursive: true });
await writeFile(ARTIFACT, JSON.stringify(artifact, null, 2) + "\n");

const reds = items.filter((item) => item.status === "RED");
const errors = items.filter((item) => item.status === "ERROR");
const label = (item) => `${item.package} ${item.resolved ?? "?"} -> ${item.latest ?? "?"}`;

console.log(`Dependency freshness — ${pkg.name}`);
console.log(`generated ${artifact.generatedAt} (${artifact.mode} mode, ${items.length} packages)`);
console.log(
  `FRONTIER ${summary.frontier} · WAIVED ${summary.waived} · YELLOW ${summary.yellow} · RED ${summary.red}` +
    ` · UNKNOWN ${summary.unknown} · ERROR ${summary.error}`,
);

if (summary.red || summary.unknown || summary.error) {
  console.log("\nNeeds attention:");
  for (const item of [...reds, ...errors])
    console.log(`  - ${item.status}: ${label(item)} (${item.detail})`);
  console.log("  Fix, or record a dated waiver in docs/quality/freshness-waivers.json.");
}
if (summary.yellow) {
  console.log("\nBehind but within budget (upgrade in this work stream):");
  for (const item of items.filter((entry) => entry.status === "YELLOW")) {
    console.log(`  - YELLOW: ${label(item)} (${item.detail})`);
  }
}
console.log(`\nartifact: ${ARTIFACT}`);
console.log(
  ENFORCE
    ? "mode: enforce — RED/ERROR fail the gate"
    : "mode: report — pass --enforce to fail on RED/ERROR",
);

if (ENFORCE && (summary.red > 0 || summary.error > 0)) process.exitCode = 1;
