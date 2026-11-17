# Cultural corpus pipeline (A09, task-17)

Real, rights-cleared cultural content for the Phase II discovery surface. This phase uses
**one source only**: The Metropolitan Museum of Art Open Access, whose public-domain object
metadata and images are dedicated to **CC0 1.0**. No other source is used; taxonomy gaps are
reported instead of filled.

```text
Met Open Access API (v1.1 search + v1 object details)
        |
        v
scripts/culture/ingest.mjs     polite, resumable fetch -> artifacts/phase2/task-17/snapshot.json
        |                      and the committed source registry data/culture/met-source.json
        v
scripts/culture/translate.mjs  bounded DeepSeek JSON batches -> ar/de title+summary
        |                      (cached by sha256; a warm rebuild costs zero model calls)
        v
scripts/culture/build.mjs      deterministic modules -> src/lib/culture/data/{index,chunk-N,manifest}.ts
        |                      + data/culture/corpus-stats.json
        v
scripts/culture/validate.mjs   the gate (exit 1 on any contract/rights/integrity violation)
scripts/culture/selftest.mjs   proves the gate is not vacuous (mutates a real record per rule)
```

## Commands

```sh
node scripts/culture/ingest.mjs                  # resume the polite Met fetch (cache-aware)
node scripts/culture/ingest.mjs --refresh        # ignore the detail cache and refetch
node scripts/culture/translate.mjs               # fill/verify ar+de for every accepted record
node scripts/culture/translate.mjs --dry-run     # report coverage without model calls
node scripts/culture/build.mjs                   # regenerate src/lib/culture/data + stats
node scripts/culture/validate.mjs                # the gate; PASS/FAIL + exact counts
node scripts/culture/selftest.mjs                # validator regression checks
```

Caches: `artifacts/phase2/task-17/met-cache.json` (raw responses, gitignored) and
`artifacts/phase2/task-17/translation-cache.json` (sha256 -> translated string). Re-running
`build.mjs` after a mapping change is deterministic and offline.

The Met API is behind an edge WAF: a burst got a temporary 403 during development. Ingestion
is sequential at ~1 request/second with a long backoff and a resumable cache, never parallel.
`DEEPSEEK_API_KEY` is read from the repository `.env` inside the batch script and is never
printed or written to the corpus.

## What is accepted (selection rules)

A record is included only when every one of these is true in the Met object detail:
`isPublicDomain === true`; `primaryImage` and `primaryImageSmall` are https URLs on
`images.metmuseum.org`; a real title; a culture or country label; a date or medium; and the
place resolves to a documented continent/ISO country through the deterministic table in
`lib.mjs` (an unmapped label is a rejection, never a guess). See
`data/culture/met-source.json` for the exact department targets, candidate/rejection counts
and the category-rule evidence table.

English copy: `title.en` is the institution's title verbatim (also kept as `title.original`
with `originalLanguage: "en"`); `summary.en` is a deterministic template over documented
fields (object name, place, date, medium). Arabic and German are machine translations, and
every record's provenance is `machine-translated` - no record claims institutional wording for
translated copy.

## Loader contract (for A10/A11)

`src/lib/culture/data/index.ts` default-exports `{ version, chunkSize, entries }` where
`entries: CultureIndexEntry[]` includes the optional feed media block (Met `primaryImageSmall`,
credit, CC0-1.0 licence). `src/lib/culture/data/chunk-<k>.ts` default-exports
`{ version, items: CultureItem[] }`; chunk `k` holds index positions
`[k*chunkSize, (k+1)*chunkSize)` in the same order, so position -> chunk is
`floor(position / chunkSize)` with no id map. `manifest.ts` carries `TOTAL_ITEMS`,
`CHUNK_COUNT`, counts and per-file sha256 values. Consumers compare `index.version` (and
`manifest.CULTURE_DATA_VERSION`) with `CULTURE_SCHEMA_VERSION` from `../types.ts` and must load
the index statically but chunks on demand.
