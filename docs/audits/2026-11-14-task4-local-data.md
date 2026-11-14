# Task 4 — Local Data Integrity and Migration (started 2026-11-14)

Status: **started; F5, F8 and the clear-all gap fixed with failing tests first.** F9, F13 and F14
remain open and are recorded below. Quota shedding and the older-schema paths are covered by
existing tests and stayed green.

Plan: `docs/superpowers/plans/2026-11-14-deep-audit.md` (Task 4).

## F5 — storage accepted an incomplete translation result (P2)

**RED.** A session row whose `result` contained only `sourceLanguage`, `targetLanguage`,
`translation` and `alternativeTranslations` was accepted:

```
FAIL storage.test.ts > session > drops a cached result missing required result fields
AssertionError: expected { sourceLanguage: 'de', …(3) } to be null
```

`isResult` checked 4 of the 10 fields the result panel and the repair prompt use. The same weak
check guarded translation memory.

**Fix.** New `src/lib/translation/result.ts` validates the full shape (required strings, finite
confidence, boolean ambiguity, at most two alternatives, notes length, optional situation and
tags), mirroring the server limits. `persist.parseSession`, translation memory and the repair server
function now share it; `translate.functions` uses `z.custom<TranslationResult>(isResult)` instead of
a second field list. There is one result validator, not two.

**GREEN.** The new test passes, as do the session/memory/useTranslator suites (43 targeted) and the
full suite.

## F8 — the daily phrase read the clock during render (P2)

**RED.** Two consecutive day keys returned the same phrase:

```
FAIL saved phrases > selects the daily phrase from an explicit day key
AssertionError: expected '…' not to be '…'
```

`saved.ofTheDay()` called `Date.now()` while `src/routes/index.tsx` rendered, so the phrase could not
roll over at midnight without a reload, and the render was impure.

**Fix.** `ofTheDay(dayKey: string)` now derives a UTC day index from a `YYYY-MM-DD` key. The screen
passes `useTodayKey()` — the existing external store that already rolls over at local midnight — and
only calls it on the client after restore. Same key, same phrase; a new day, the next phrase.

**GREEN.** The day-key test and the full suite pass. An overnight browser run is **NOT_VERIFIED**.

## Clear-all left caches alive (P2, privacy)

**RED.** The first `clearDeviceData` only removed storage keys. The test expected every store to be
empty and failed on the saved-phrase cache:

```
FAIL clearing device data > clears every store, including caches that storage removal cannot reach
AssertionError: expected [ Array(1) ] to deeply equal []
```

The same was true for history and translation memory: `persist.clearAll()` removed the keys, but the
modules kept answering from RAM. The statistics "forget everything" action also never called
`memoryClear()`, so a translation could still be served after the user erased the device data.

**Fix.** `src/lib/clearData.ts` is now the single policy: reset saved phrases, history and
translation memory (which also resets their caches), then remove every `lingua.*` key through
`persist.clearAll()`. `routes/stats.tsx` calls it instead of orchestrating three stores and missing a
fourth. Translation memory also drops its cache when another tab clears storage (`storage` event),
so a second tab cannot keep answering from stale RAM.

**GREEN.** The clear test asserts empty stores, `memoryGet` null and **no `lingua.*` keys left**; the
cross-tab test passes.

## Reviewed, not changed

| Item | Evidence | State |
| --- | --- | --- |
| Quota shedding | `history.test.ts` forces `QuotaExceededError`: newest row survives, `lastEvicted() === 1`, `lastWriteOk()` true; a total refusal reports `false` and keeps the row in memory for the session | VERIFIED (tests green) |
| Cross-tab history/phrasebook | both listen to `storage` (key or `null`); existing test clears from another tab and the next save cannot resurrect the cache | VERIFIED (tests green) |
| F9 — two lockfiles | `bun.lock` (199 KB) and `package-lock.json` (407 KB) both exist; CI uses npm | **OPEN** — decide with the owner; Lovable may build with bun |
| F13 — duplicated normalisation/caps | six `trim().replace(/\s+/…)` variants (`saved`, `history`, `engine.server`, `useTranslator`, `useLexicon`, `useShadow`), three 5,000-character caps | **OPEN** — one shared module, behaviour-preserving tests first |
| F14 — shadow fix vs session snapshot | source says the session stores the base translation while history/saved keep the fix | **SUSPECTED**, needs a runtime repro; not touched |

## Commands and gates

```
npx vitest run src/lib/storage.test.ts src/lib/clearData.test.ts \
  src/lib/translation/memory.test.ts src/lib/translation/useTranslator.test.tsx  # RED, then 43 passed
npm run verify     # 0 — 318 passed / 4 skipped, 54 files, coverage 52.47/42.93/43.71/54.53
npm run build      # 0
npm run check:pwa  # 0 — 37 precached files
```

`check:docs` reports 32 documents, all indexed. No browser test was run for midnight rollover or
for the clear action's visible confirmation; both are **NOT_VERIFIED** at the UI level, while their
pure/storage behaviour is covered above.
