/**
 * Met Open Access ingestion (A09, task-17).
 *
 * Enumerates public-domain objects with images across 14 Met departments through the
 * v1.1 search endpoint (v1 /search was retired on 2026-10-01), fetches each object detail
 * politely and sequentially, and keeps every fetched detail in a resumable cache. Selection
 * is re-runnable offline: --refresh only clears the cache, a normal run resumes from it.
 *
 * Usage:
 *   node scripts/culture/ingest.mjs                 # resume; fetch until targets are met
 *   node scripts/culture/ingest.mjs --refresh       # ignore the cache and fetch again
 *   node scripts/culture/ingest.mjs --gap-ms=1500   # be even slower
 *
 * Outputs (all in-scope files):
 *   artifacts/phase2/task-17/met-cache.json   raw detail cache (gitignored, resumable)
 *   artifacts/phase2/task-17/snapshot.json    selected records + fetch/selection report
 *   data/culture/met-source.json              committed source registry (provenance + rules)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ARTIFACT_DIR,
  CATEGORY_RULES,
  DEFAULT_GAP_MS,
  DEPARTMENTS,
  MAX_SEARCH_PAGES,
  MET,
  REGISTRY_PATH,
  SEARCH_PAGE_SIZE,
  createLimiter,
  fetchJson,
  log,
  normalizeDetail,
  snapshotDetail,
} from "./lib.mjs";

const CACHE_PATH = join(ARTIFACT_DIR, "met-cache.json");
const SNAPSHOT_PATH = join(ARTIFACT_DIR, "snapshot.json");

function parseArgs(argv) {
  const args = {
    refresh: false,
    offline: false,
    gapMs: DEFAULT_GAP_MS,
    target: null,
    maxFetch: null,
  };
  for (const raw of argv) {
    if (raw === "--refresh") args.refresh = true;
    else if (raw === "--offline") args.offline = true;
    else if (raw.startsWith("--gap-ms="))
      args.gapMs = Math.max(300, Number(raw.slice(9)) || DEFAULT_GAP_MS);
    else if (raw.startsWith("--target=")) args.target = Math.max(1, Number(raw.slice(9)) || 0);
    else if (raw.startsWith("--max-fetch="))
      args.maxFetch = Math.max(1, Number(raw.slice(12)) || 0);
    else throw new Error("Unknown argument: " + raw);
  }
  return args;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(path, value, pretty = false) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, pretty ? 2 : 0) + "\n");
}

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(ARTIFACT_DIR, { recursive: true });

  let cache = args.refresh ? null : await readJson(CACHE_PATH);
  if (!cache || !cache.details || !cache.searchPages) {
    cache = { fetchedAt: null, searchPages: {}, details: {} };
  }
  const fetchedAt = cache.fetchedAt || new Date().toISOString();
  cache.fetchedAt = fetchedAt;

  const limiter = createLimiter(args.gapMs);
  const targetTotal =
    args.target || DEPARTMENTS.reduce((sum, department) => sum + department.target, 0);
  const selected = [];
  const selectedIds = new Set();
  const rejects = new Map();
  const unmappedPlaces = new Map();
  const deptStats = [];
  let detailsFetched = 0;
  let candidatesConsidered = 0;
  let cacheWrites = 0;

  async function saveCache(force = false) {
    cacheWrites += 1;
    if (!force && cacheWrites % 10 !== 0) return;
    await writeJson(CACHE_PATH, cache);
  }

  async function fetchDetail(objectID) {
    const key = String(objectID);
    if (Object.prototype.hasOwnProperty.call(cache.details, key)) return cache.details[key];
    const result = await fetchJson(MET.apiBase + "/objects/" + key, {
      limit: limiter,
      label: "object " + key,
    });
    if (result.status === 404 || !result.json) {
      cache.details[key] = null;
      await saveCache();
      return null;
    }
    const detail = snapshotDetail(result.json);
    cache.details[key] = detail;
    detailsFetched += 1;
    if (detailsFetched % 5 === 0) await saveCache();
    return detail;
  }

  for (const department of DEPARTMENTS) {
    const stats = {
      id: department.id,
      name: department.name,
      target: department.target,
      pagesFetched: 0,
      candidates: 0,
      accepted: 0,
    };
    let acceptedForDepartment = 0;

    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      if (acceptedForDepartment >= department.target) break;
      if (selected.length >= targetTotal) break;
      if (args.maxFetch !== null && detailsFetched >= args.maxFetch) break;
      const offset = page * SEARCH_PAGE_SIZE;
      const pageKey = String(department.id) + ":" + String(offset);
      let pageData = cache.searchPages[pageKey];
      if (!pageData) {
        if (args.offline) break;
        const url =
          MET.searchBase +
          "?q=*&departmentId=" +
          String(department.id) +
          "&hasImages=true&isPublicDomain=true&limit=" +
          String(SEARCH_PAGE_SIZE) +
          "&offset=" +
          String(offset);
        const response = await fetchJson(url, {
          limit: limiter,
          label: "search dept " + String(department.id) + " offset " + String(offset),
        });
        pageData = response.json || { total: 0, objectIDs: [] };
        cache.searchPages[pageKey] = pageData;
        stats.pagesFetched += 1;
        await saveCache(true);
      }
      const ids = Array.isArray(pageData.objectIDs) ? pageData.objectIDs : [];
      if (ids.length === 0) break;
      stats.candidates += ids.length;

      for (const rawID of ids) {
        if (acceptedForDepartment >= department.target) break;
        if (selected.length >= targetTotal) break;
        if (args.maxFetch !== null && detailsFetched >= args.maxFetch) break;
        const objectID = Number(rawID);
        if (!Number.isInteger(objectID) || objectID <= 0 || selectedIds.has(objectID)) continue;
        if (
          args.offline &&
          !Object.prototype.hasOwnProperty.call(cache.details, String(objectID))
        ) {
          bump(rejects, "not_cached_offline");
          continue;
        }
        candidatesConsidered += 1;
        const detail = await fetchDetail(objectID);
        if (!detail) {
          bump(rejects, "not_found");
          continue;
        }
        if (selectedIds.has(objectID)) continue;
        const result = normalizeDetail(detail, fetchedAt);
        if (result.ok) {
          selected.push({ item: result.item, weight: result.weight, detail });
          selectedIds.add(objectID);
          acceptedForDepartment += 1;
        } else if (result.reason.startsWith("place_unmapped:")) {
          bump(rejects, "place_unmapped");
          bump(unmappedPlaces, result.reason.slice("place_unmapped:".length));
        } else {
          bump(rejects, result.reason);
        }
      }
    }
    stats.accepted = acceptedForDepartment;
    deptStats.push(stats);
    await saveCache(true);
    log(
      "dept " +
        String(department.id).padStart(2) +
        " " +
        department.name +
        ": accepted " +
        String(stats.accepted) +
        "/" +
        String(department.target) +
        " of " +
        String(stats.candidates) +
        " candidates (total " +
        String(selected.length) +
        ")",
    );
  }

  // Deterministic order: numeric Met object id. Stable across rebuilds.
  const ordered = selected
    .slice()
    .sort((a, b) => a.item.id.localeCompare(b.item.id, "en", { numeric: true }));
  const items = ordered.map((entry) => entry.item);
  const details = ordered.map((entry) => entry.detail);

  const snapshot = {
    snapshotVersion: 1,
    fetchedAt,
    source: {
      organization: MET.organization,
      apiBase: MET.apiBase,
      searchBase: MET.searchBase,
      apiDocs: MET.apiDocs,
      openAccessPolicy: MET.openAccessPolicy,
      license: MET.license,
      licenseUrl: MET.licenseUrl,
      imageHosts: MET.imageHosts,
      enumeration:
        "GET " +
        MET.searchBase +
        "?q=*&departmentId=<id>&hasImages=true&isPublicDomain=true&limit=100&offset=N, then GET " +
        MET.apiBase +
        "/objects/<objectID>",
    },
    query: {
      pageSize: SEARCH_PAGE_SIZE,
      maxSearchPages: MAX_SEARCH_PAGES,
      targetTotal,
      gapMs: args.gapMs,
      mode: args.offline ? "offline-cache-rebuild" : "network",
      departments: DEPARTMENTS,
    },
    departments: deptStats,
    rejects: sortedObject(rejects),
    unmappedPlaces: sortedObject(unmappedPlaces),
    totals: {
      candidatesConsidered,
      detailsFetched,
      selected: items.length,
      cachedDetails: Object.keys(cache.details).length,
    },
    items,
    details,
  };
  await writeJson(SNAPSHOT_PATH, snapshot, true);

  const registry = {
    schemaVersion: 1,
    task: "A09 cultural corpus - Met Open Access source registry",
    institution: {
      organization: MET.organization,
      apiDocs: MET.apiDocs,
      openAccessPolicy: MET.openAccessPolicy,
      license: MET.license,
      licenseUrl: MET.licenseUrl,
      rightsStatement:
        "The Met Open Access policy dedicates its public-domain object metadata to CC0 1.0; each record here carries isPublicDomain: true and an images.metmuseum.org image.",
    },
    enumeration: snapshot.source.enumeration,
    query: snapshot.query,
    fetchedAt,
    snapshotNote:
      "fetchedAt is the epoch of the resumable raw-detail cache (first polite fetch). The final published corpus was rebuilt from that cache with --offline after the lead's gate deadline; rejectedReasons therefore include not_cached_offline for candidate ids whose details were never fetched.",
    totals: {
      ...snapshot.totals,
      acceptedRecords: items.length,
      publishedRecords: items.length,
      rawDetailsInCache: Object.keys(cache.details).length,
      detailsFetchedThisRun: detailsFetched,
    },
    departments: deptStats,
    rejectedReasons: snapshot.rejects,
    unmappedPlaces: snapshot.unmappedPlaces,
    categoryRules: CATEGORY_RULES.map((candidate) => ({
      category: candidate.category,
      evidence: candidate.evidence,
    })),
    definitionOfDoneForData: {
      selectionRequires: [
        "isPublicDomain === true",
        "primaryImage and primaryImageSmall are https URLs on images.metmuseum.org",
        "a non-empty institutional title",
        "a non-empty culture or country label",
        "a non-empty objectDate or medium",
        "country/culture resolves to a documented continent (unmapped labels are rejected, not guessed)",
      ],
      englishCopy:
        "title.en is the institution's title verbatim (also copied to title.original with originalLanguage 'en'); the English summary is a deterministic template over documented fields (object name, place, date, medium).",
      translation:
        "title.ar/de and summary.ar/de are machine translations produced by scripts/culture/translate.mjs (DeepSeek, JSON batches) and the record provenance is machine-translated; no data record claims institutional wording for translated copy.",
      weight:
        "0.4 base + 0.15 date + 0.10 culture&country + 0.10 medium + 0.10 source tags + 0.15 Met isHighlight (curatorial flag). Documented richness only; never rarity.",
    },
  };
  await writeJson(REGISTRY_PATH, registry, true);

  log("");
  log(
    "selected " +
      String(items.length) +
      " records from " +
      String(deptStats.filter((entry) => entry.accepted > 0).length) +
      " departments; details fetched this session " +
      String(detailsFetched) +
      "; cache " +
      String(Object.keys(cache.details).length) +
      " details",
  );
  log("rejections: " + JSON.stringify(snapshot.rejects));
  log("snapshot: " + SNAPSHOT_PATH);
  log("registry: " + REGISTRY_PATH);
  console.log(JSON.stringify({ ok: true, selected: items.length, totals: snapshot.totals }));
}

main().catch((error) => {
  console.error("ingest failed: " + error.message);
  process.exit(1);
});
