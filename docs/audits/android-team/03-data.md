# A3 — Data architecture & persistence audit

Repo: `deep-meaning-translate` · branch `main` at `c897209` plus **uncommitted concurrent work**
(read-only audit; snapshot at 2026-11-16 ~18:24 local, Europe/Berlin).
Report file: this file only. No source, config, doc or other report was modified.

> **Snapshot note.** While this audit ran, the working tree was being changed by other agents /
> the Lead (simultaneously with this report). At first read: `android/gradle.properties`,
> `src/lib/native/plugin.ts`, `src/routes/__root.tsx`, `vite.native.config.ts` modified and
> `src/lib/native/plugin.test.ts` new. Before the report was finalised, more work landed:
> `android/app/build.gradle.kts` and `android/app/src/test/.../MigrationTest.kt` modified,
> the stale Capacitor template tests deleted, and `android/app/src/androidTest/java/today/fluently/app/BridgeInstrumentedTest.kt`
> added (TD20). Line numbers below refer to the working tree **as read**, not to `c897209`.
> Where a finding touches a file that is being edited (`plugin.ts`, `__root.tsx`, `MigrationTest.kt`)
> the text says so and the finding is amended to the actual state. I did not build, install, run Gradle, run Vitest or touch the emulator; the Lead's
> build was in progress. All findings are **source inspection** (VERIFIED per
> `docs/quality/testing.md:48-59`) unless explicitly marked otherwise; on-device behaviour is
> **NOT_VERIFIED** here and is flagged.

---

## 1. Scope and method

Read end-to-end (current working tree):

- TypeScript: `src/lib/persistence/{port,contracts,index,settings,web,native,backup}.ts`,
  `persistence.test.ts`; `src/lib/{history,saved,persist,platform,clearData}.ts` and their tests;
  `src/lib/translation/memory.ts`; `src/lib/stats/{engine,moments,useArchive,search}.ts`;
  `src/routes/{index,__root,stats}.tsx`; `src/components/DataControls.tsx`;
  boot/theme/intro/`persist` paths; backup call-sites.
- Kotlin: `android/app/src/main/java/today/fluently/app/data/*` (entities, DAOs, database,
  repository, mapping, DataStore), `bridge/LinguaStorePlugin.kt`, `bridge/LinguaFilesPlugin.kt`,
  `MainActivity.kt`, `AndroidManifest.xml`, exported Room schema `android/app/schemas/…/2.json`,
  JVM tests `RepositoryTest.kt`, `MigrationTest.kt`.
- Docs checked against code: `docs/android/persistence-and-migrations.md`,
  `docs/android/data-import-export.md`, `docs/android/architecture.md`,
  `docs/architecture/state-and-persistence.md`, `docs/architecture/decisions/0006-*`,
  `docs/quality/testing.md`, `docs/audits/technical-debt.md` (TD17–TD20).

Verdicts use the project's own classifications. "VERIFIED" here therefore means _source
inspection confirms it_; it does not mean a device or JVM test was run by me.

## 2. Summary verdict

**Architecture is sound; the guarantees around _when a store may be rewritten_ are not.**

The design (one owner per store, Room for records + DataStore for scalars, a validated
persistence port, one-transaction imports, a real v1→v2 migration, no destructive fallback,
`allowBackup=false`, bounded archive/phrasebook/memory, digest+optional AES-GCM backups) is
present in code and is better than most Android ports. The web adapter and the merge/replace
engine are readable, tested and consistent with the web product.

The release risk is concentrated in three places:

1. **A whole-table write (phrasebook, translation memory) is issued from an in-memory cache that
   is never proven hydrated.** A boot that fails or times out — or an import that is not followed
   by the manual reload — leaves the cache empty/stale, and the next save issues
   `DELETE FROM saved_phrases` + insert of only what RAM knows. That is silent user-data loss
   (A3-02/A3-03).
2. **The Kotlin bridge serialises nothing but the session.** Every `@PluginMethod` launches an
   independent IO coroutine; whole-document writes can be applied out of order, and an import can
   interleave with a normal save (A3-04).
3. **Several documented guarantees are not enforced by the code** (single-transaction import
   including settings, truthful added/skipped report, import metadata with file name/digest,
   "first paint uses the saved theme", "Device-only preferences stay on the device"). The list is
   in §7.

Additionally, the shipped 1.0.2 APK appears to have had **no working persistence at all on a
device** because of a Capacitor plugin-proxy/thenable defect that another teammate already fixed
in the uncommitted working tree (A3-01). That fix is a prerequisite for every other finding here
being testable, and it must be committed and device-retested.

No P0 crash was found in the data layer; the P0s are data-loss / total-persistence-failure.
TD19 (no SQLCipher) is known and correctly registered; nothing in this audit re-opens it.

## 3. Current state (what the code actually does)

| Data               | Native owner                                                    | Web owner                   | Read back through                                                                                         | Write path                                                                                                           |
| ------------------ | --------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Archive            | Room `history_entries`                                          | `lingua.history.v1`         | `isEntry`+`sanitizeEntry` (`contracts.ts:129-164`), Kotlin `Mapping.historyFromJson` (`Mapping.kt:22-53`) | `history.add/retag/remove/clear` (`history.ts:141-253`)                                                              |
| Saved phrases      | Room `saved_phrases`                                            | `lingua.saved.v1`           | `isPhrase` (`contracts.ts:179-193`)                                                                       | **whole list rewrite**: `saved.write` (`saved.ts:34-43`) → `savedWrite` clear+insert (`LinguaRepository.kt:121-126`) |
| Translation memory | Room `memory_rows`                                              | `lingua.memory.v1`          | `isMemoryRow`+TTL (`contracts.ts:205-214`, `memory.ts:79-98`)                                             | **whole list rewrite** (`memory.ts:61-76`, `LinguaRepository.kt:128-133`)                                            |
| Draft/session      | Room `session_state` (one row, `seq`)                           | `lingua.session.v1`         | `parseSession` (`contracts.ts:72-86`)                                                                     | debounce 400 ms + flush (`routes/index.tsx:312-339`)                                                                 |
| Settings           | DataStore **individual string keys** (`SettingsStore.kt:19-46`) | same keys in `localStorage` | validators in `theme/intro/i18n/voice/feel`                                                               | queued/coalesced (`settings.ts:73-101,128-169`)                                                                      |
| Backup             | file via SAF                                                    | download/upload             | `parseBackup` digest/AES-GCM (`backup.ts:207-248`)                                                        | `replaceAll` (`native.ts:161-176`; `web.ts:266-292`)                                                                 |

Single-source-of-truth holds in code: the records adapters are chosen once (`persistence/index.ts:11`),
`history.ts:36`, `saved.ts:17`, `memory.ts:36` compute `native` at module load, and every web read/write
is behind `if (!native)`. `localStorage` is never written in native mode
(`settings.ts:74-81` is the only writer and it returns early in native mode; `web.ts` is only reached
through the web port). This part of the ADR is implemented.

## 4. Findings — summary

Severity: P0 data loss / total persistence failure · P1 core function/integrity · P2
compatibility/UX/performance/release-blocker-adjacent · P3 justified improvement.

Impact, root cause, proposed fix and required regression test for every finding are in §5
(details for A3-01…A3-12, condensed bullets for A3-13…A3-20); the table below is the index,
the details are the record.

| ID    | Sev    | Area                    | Finding                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                     |
| ----- | ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A3-01 | **P0** | Bridge availability     | As shipped, the Capacitor plugin proxy is treated as a thenable, so every `LinguaStore` call rejects and the Android app runs with no persistence; fix is uncommitted in the working tree                                                                                                  | `src/lib/native/plugin.ts:80-106`, new `plugin.test.ts`; `native.ts:36-40`                                                                   |
| A3-02 | **P0** | Boot/degraded mode      | After a failed or timed-out native boot, the phrasebook cache is empty but native writes are enabled; first save clears and rewrites `saved_phrases` from RAM                                                                                                                              | `platform.ts:78-98`, `saved.ts:22-43`, `LinguaRepository.kt:121-126`                                                                         |
| A3-03 | **P1** | Import/caches           | Import replaces Room/DataStore but no module cache is refreshed; before the offered reload, the next phrasebook/memory save rewrites the imported tables from stale RAM (imported rows lost, replaced rows resurrected)                                                                    | `DataControls.tsx:249-265,397-419`, `saved.ts:22-43`, `memory.ts:51-76`                                                                      |
| A3-04 | **P1** | Concurrency             | Bridge calls are independent IO coroutines (only the session has a Mutex); whole-document writes and import vs. normal saves can be applied out of order                                                                                                                                   | `LinguaStorePlugin.kt:32,71-81`, `LinguaRepository.kt:24,76-87`, `saved.ts:34-43`, `persist.ts:60-65`                                        |
| A3-05 | P2     | Import atomicity        | Room transaction commits before the DataStore write; rollback is best-effort and is skipped when the coroutine is cancelled; `import_meta` insert is outside the transaction and can fail after a successful import                                                                        | `LinguaRepository.kt:196-238`, `docs/android/data-import-export.md:61-65`                                                                    |
| A3-06 | P2     | Session durability      | `seq` guard is wall-clock derived and not seeded from the stored value; a clock rollback (or a backdated import stamp) silently rejects every later draft write; the boolean result is ignored                                                                                             | `native.ts:30-34,81-88`, `LinguaRepository.kt:76-87,205-210`, `routes/index.tsx:319-330`                                                     |
| A3-07 | P2     | Import report           | Android returns a fabricated report (added = whole dataset, skipped = 0, replaced = true), overriding the accurate TS report; `import_meta` file name/digest are never passed and never read                                                                                               | `LinguaRepository.kt:229-245`, `native.ts:168-175`, `native/plugin.ts:58`, `Daos.kt:86-93`                                                   |
| A3-08 | P2     | Forget everything       | Clear is fire-and-forget and silent on failure; a queued setting write can land after the clear; `import_meta` is never cleared                                                                                                                                                            | `stats.tsx:294-297`, `clearData.ts:15-22`, `settings.ts:128-169`, `LinguaRepository.kt:248-257`                                              |
| A3-09 | P2     | Settings read path      | On the Android success boot path the DataStore snapshot is never applied to the document: saved theme is ignored (dark/system every launch) and the intro gate still reads `localStorage`                                                                                                  | `platform.ts:56-69,78-95`, `theme.ts:32-34,62-74`, `intro.ts:7-9,24,27-29`, `index.tsx:261`, `__root.tsx:118-136`                            |
| A3-10 | P2     | Corruption recovery     | No recovery path for corrupt DB / corrupted DataStore: boot degrades permanently for the session, export and reset are unavailable, only uninstall remains; no DataStore corruption handler                                                                                                | `platform.ts:86-101`, `SettingsStore.kt:17`, `LinguaDatabase.kt:74-79`, `DataControls.tsx:277-284`                                           |
| A3-11 | P2     | Backup contract vs docs | "Merge matches by id, newer wins" — code matches by target+normalised text; settings are overwritten unconditionally by an older backup; invalid rows are dropped without being counted; encrypted digest/error semantics differ; envelope example in docs has wrong field names           | `backup.ts:250-357,90-119,236-245`, `contracts.ts:245-263`, `data-import-export.md:12-38,56-77`                                              |
| A3-12 | P2     | Web import integrity    | Web `replaceAll` ignores failed history/`savedWrite`/`writeMemory` (quota errors are swallowed), so an import can report success with the archive not written; rollback only on thrown errors                                                                                              | `web.ts:266-292,99-125,240-253`                                                                                                              |
| A3-13 | P3     | Migration realism       | No exported v1 schema (only `2.json`), test hand-writes v1 (another agent is strengthening it in the working tree), DB was born at v2, backfill normaliser differs from `Mapping.normalize`                                                                                                | `MigrationTest.kt:26-73`, `schemas/…/2.json`, `LinguaDatabase.kt:49-72`, `Mapping.kt:20`, `persistence-and-migrations.md:60-63`              |
| A3-14 | P3     | Validator drift         | TS backup validation accepts rows Kotlin refuses (`createdAt<=0`, blank text, long ids) and the drop is not counted                                                                                                                                                                        | `contracts.ts:114-141`, `Mapping.kt:22-53,72-91`                                                                                             |
| A3-15 | P3     | Bounds at the boundary  | "Memory re-checked in Kotlin" is false: Kotlin caps rows only; `replaceAll`/boot apply no byte/TTL bound; `replaceAll` does not cap `saved` rows                                                                                                                                           | `LinguaRepository.kt:128-133,203,269`, `Mapping.kt:105-115`, `persistence-and-migrations.md:71`                                              |
| A3-16 | P3     | Stats read path         | `history.status` never returns to "ok" after a transient failure (stats keeps the error screen); `reload()` zeroes the native count; full archive is refetched only on mount                                                                                                               | `history.ts:33,110-127`, `stats.tsx:139,313-326`                                                                                             |
| A3-17 | P3     | Cross-device backup     | Web export has no size limit but Android refuses >8 MB; UTF-8 decode per 1 MB chunk can split a code point; PBKDF2/parse run on the WebView main thread; up to ~10 MB of JSON crosses the bridge in one string on full-archive reads/imports (SUSPECTED memory spike on minSdk-24 devices) | `LinguaFilesPlugin.kt:83-93`, `DataControls.tsx:233-247`, `backup.ts:220-238`, `LinguaStorePlugin.kt:184-189`, `LinguaRepository.kt:174-178` |
| A3-18 | P3     | Draft on process death  | Flush is fire-and-forget; `flushPlatform` awaits only settings, so the last ≤400 ms of typing can still be lost when Android kills the process                                                                                                                                             | `routes/index.tsx:312-339`, `platform.ts:140-148`                                                                                            |
| A3-19 | P3     | Failure surfacing       | Phrasebook/memory/prefs write failures are returned but never surfaced where the action happens; only the stats page shows the history flag                                                                                                                                                | `saved.ts:34-43`, `memory.ts:61-76`, `index.tsx:308-309,716-724`, `stats.tsx:396-410`                                                        |
| A3-20 | P3     | Docs/impl drift         | DataStore is **not** "one JSON map"; boot sequence doc says `applyStoredAppearance()` runs (it is only on the failure branch); "web adapter is not imported at runtime" is false (it is imported and guarded)                                                                              | `SettingsStore.kt:19-46`, `architecture.md:46-58,76-82`, `persistence-and-migrations.md:87`, `state-and-persistence.md:110`, `history.ts:11` |

## 5. Finding details

### A3-01 — P0 — the shipped Android build cannot persist anything (fix uncommitted)

**Evidence.** `src/lib/native/plugin.ts:80-106` (working tree, new comment + `asNonThenable`):
Capacitor registers each plugin as a Proxy whose fallback getter manufactures a method for _any_
property. `load()` is an `async` function returning that proxy, so promise resolution calls
`plugin.then()`, which the bridge answers with _`"LinguaStore.then()" is not implemented on
android`_`; the rejection propagates out of `await storePlugin()` (`native.ts:36-40`), `hydrate()`fails, and every later`store()`fails the same way. The new regression test`src/lib/native/plugin.test.ts`reproduces the proxy shape and asserts the`then` call count is 0.

**Impact.** In the APK as built from `c897209`, the installed app runs with **no durable storage at
all** (no Room, no DataStore): drafts, archive, phrasebook and settings are lost on every process
death while the UI otherwise works. The teammate's comment states this was observed on device
("the app booted without Room/DataStore and silently lost persistence"); I did not re-observe it.

**Root cause.** A Capacitor 8 plugin Proxy is not a plain object; returning it from an `async`
function makes it a thenable.

**Fix (in progress, uncommitted).** Keep `asNonThenable`; commit it with the test and add it to
DEFINITION_OF_DONE/evidence. Also add one _call-path_ test (mock `registerPlugin` returning the
throwing thenable proxy, then `port.hydrate()` must fail gracefully, not throw synchronously). The
working tree now also carries `android/app/src/androidTest/java/today/fluently/app/BridgeInstrumentedTest.kt`
(TD20, uncommitted, no device run by me): it launches `MainActivity`, waits for
`Capacitor.Plugins.LinguaStore` and calls the plugin through the real WebView — that is the right
device gate for this exact regression and must be run before shipping.

**Verification.** Source VERIFIED; device behaviour NOT_VERIFIED by me; fix NOT_VERIFIED (uncommitted,
not in an APK).

### A3-02 — P0 — a degraded boot makes the next phrase save delete the phrasebook

**Evidence.** `platform.ts:78` enables native settings mode and `hydratePlatform` then calls
`nativePort.hydrate()` (`platform.ts:80`). On timeout (3 s, `platform.ts:30`) or any bridge error the
`catch` (`platform.ts:86-95`) records the error and marks the app ready, but **only** the failure
branch is entered: `hydratePersist/hydrateHistory/hydrateSaved/hydrateMemory` are never called, so
`saved.ts` keeps `cache === null` (`saved.ts:19`) and `read()` resolves it to `[]` for native
(`saved.ts:22-26`). A later phrase save calls `write([...new, ...read()])` → `port.savedWrite(cache)`
(`saved.ts:34-43`) → Kotlin `savedWrite` **clears the table then inserts only the rows RAM currently knows**
(`LinguaRepository.kt:121-126`). The bridge now works (the boot _call_ failed, not the database), so
the clear succeeds. Same class: `memorySet` flushes the whole memory table (`memory.ts:61-76`).
Reachable triggers: 3 s cold-boot timeout on a low-end API-24 device with a large archive
(boot reads DataStore + session + 400 history rows + all saved + all memory through the bridge,
`LinguaRepository.kt:36-48`), or a corrupted DataStore file (its `CorruptionException` fails
`settings.all()` at the top of `boot()` while Room is fine and later writes succeed — `SettingsStore.kt:17`
has no `corruptionHandler`).

**Impact.** Silent, permanent loss of the entire phrasebook (user-authored, not recoverable from
history) and of translation memory. No error is shown: the write returns `true`.

**Root cause.** No hydration generation/epoch: the persistence layer cannot tell "the user has no
phrases" from "we never read the phrases". The whole-document write assumes the cache is complete.

**Fix.** (a) Add a per-store `hydrated` generation in the port, seeded by `hydratePlatform`; make
`savedWrite`/`memoryWrite` no-ops (and `saved.toggle` fail visibly) until that generation is
published. (b) When boot fails, either disable native record writes for the session or retry
hydration before any write. (c) Better still, make phrasebook writes row-level (`upsert`/`deleteById`)
so a partial view can never erase unseen rows. (d) Add `ReplaceFileCorruptionHandler` for DataStore.

**Regression test.** Vitest: mock native port where `hydrate()` rejects; call `saved.toggle`; assert
`savedWrite` was not called (or was called with a disabled marker). JVM: two Robolectric tests —
`savedWrite` is a clear+insert (document that), and a repository-level guard rejects wholesale writes
before a successful `boot()`.

**Verification.** Source VERIFIED; runtime trigger SUSPECTED (device timing NOT_VERIFIED).

### A3-03 — P1 — after an import, stale RAM rewrites the freshly imported tables

**Evidence.** `DataControls.apply` calls `port.replaceAll(...)` and then shows a report with a
manual "Reload the app" button (`DataControls.tsx:249-265,397-419`). Nothing calls `hydrateSaved`,
`hydrateMemory`, `hydrateHistory` or `hydratePersist` again. So after the import:
`saved.ts` cache is the pre-import list; `saved.toggle`/`mark`/`update` write that **whole list**
(`saved.ts:34-43`) → `savedWrite` clears `saved_phrases` and inserts the stale list — the imported
phrases are deleted and phrases deleted by a "replace" import come back. Same for memory
(`memorySet/memoryDrop → flush → memoryWrite` clears + inserts, `memory.ts:61-76`), for the settings
snapshot (`settings.ts:16-17`: subsequent export/preview/settings reads see pre-import values) and for
`history` (`history.ts:38`: `history.list()`/stats on web show the old archive). The web adapter has
the same cache issue (`saved.ts`/web imports), so this is not Android-only.

**Impact.** A user who imports a backup and keeps using the app _without_ pressing the reload button
loses the imported phrasebook on the next save. The report screen itself invites continued use; the
reload is optional.

**Root cause.** Import updates storage out-of-band and no in-process invalidation/epoch exists.

**Fix.** Make the port expose a `generation` and bump it in `replaceAll`/`clearAll`; after import,
re-run the `hydratePersist/hydrateHistory/hydrateSaved/hydrateMemory` pipeline from a fresh
`port.hydrate()` (and `seedSettings`) before returning, or force a full re-mount instead of a
manual button. Refuse whole-document stores until the post-import hydration has run.

**Regression test.** Vitest: hydrate → import new phrase → `saved.toggle` another phrase → assert the
imported phrase is still in the list passed to `savedWrite` (or that no write is allowed before
rehydration). JVM: repository-level test that `replaceAll` followed by `savedWrite(stale)` is
detectable via a version column.

**Verification.** Source VERIFIED; device NOT_VERIFIED.

### A3-04 — P1 — bridge writes are unordered; whole-document stores can lose the newest state

**Evidence.** Every `@PluginMethod` goes through `run()` which does `scope.launch { block(repository()) }`
on a shared `CoroutineScope(SupervisorJob() + Dispatchers.IO)` (`LinguaStorePlugin.kt:32,71-81`); there
is no queue and no dispatcher confinement. `LinguaRepository` has exactly one `Mutex`, for the session
(`LinguaRepository.kt:24,76-87`). Therefore two phrasebook calls issued back-to-back from JS
(e.g. `void saved.toggle(o1)` then `void saved.toggle(o2)`, or `mark` while a `toggle` is in flight)
each perform `clear(); upsert(rows)` (`LinguaRepository.kt:121-126`) and the _last writer by thread
schedule_ wins, not the last writer by user action. The same applies to `memoryWrite`
(`LinguaRepository.kt:128-133`), `prefsWrite` (whole prefs JSON, `LinguaRepository.kt:64-69`) and
`saveSession` vs. `replaceAll`'s session write (the import does **not** take `sessionMutex`,
`LinguaRepository.kt:205-210`). Import also snapshots via `snapshot()` (`native.ts:161-176`) and then
writes in a separate call, so a translation/phrase saved in that window is dropped by the subsequent
`clear()+upsert(dataset)`; `web.replaceAll` has the same read→write window (`web.ts:266-292`).
In-process only: one WebView, so this is not cross-process, but the web app is genuinely multi-tab and
`replaceAll` there is also snapshot-based.

**Impact.** Newest user action can be silently lost (phrase toggled twice quickly, insight pref +
theme change during import, a phrase saved while the import overlay is open). Hard to notice; no
error.

**Root cause.** Asynchronous bridge dispatch without ordering + whole-document writes + no write
version.

**Fix.** (a) Serialise all mutating bridge methods on a single-threaded dispatcher (or one
`Mutex` per store) so call order is preserved. (b) Add a monotonic revision per record family and
reject stale whole-document writes (or convert saved/memory to row-level writes). (c) Make import
acquire the same lock as normal writes, or hold a "import in progress" flag the JS port respects.

**Regression test.** JVM: start two `savedWrite` calls concurrently with different lists, assert the
second-called one wins / a stale revision is rejected. Vitest: `replaceAll` started while
`history.add` is pending must not drop the new row (fake port with controllable ordering).

**Verification.** Source VERIFIED (concurrency hazard); runtime frequency NOT_VERIFIED.

### A3-05 — P2 — import is not one transaction across Room and DataStore; rollback can be skipped

**Evidence.** `LinguaRepository.replaceAll` captures the previous dataset in memory, runs a Room
`withTransaction` (clear+insert records, session, trim) and **then** calls
`settings.replaceAll(newSettings)` (`LinguaRepository.kt:196-214`). If that call throws, the `catch`
re-runs a second Room transaction and `settings.replaceAll(previousSettings)` inside
`runCatching { ... }` (`LinguaRepository.kt:215-227`) and rethrows. Two problems:

1. the rollback is **best-effort**: if restoring settings or records also fails (disk full, process
   death), the DB is already replaced while settings are old — a mixed state the docs promise cannot
   happen ("The write is one Room transaction. Any failure rolls back, leaving the previous state
   intact", `docs/android/data-import-export.md:61-62`);
2. the `catch (error: Throwable)` also catches `CancellationException`. If the plugin scope is
   cancelled (`handleOnDestroy`, `LinguaStorePlugin.kt:62-67`) during import, the
   `withContext(io)` inside `runCatching` re-throws immediately on the cancelled context and the
   rollback never runs. Process death after the Room commit has the same effect.
   Also, the previous dataset is materialised fully in RAM (`previousHistory = db.history().all()`,
   up to 2000 rows × 5000 chars, `LinguaRepository.kt:175`), and `import_meta` is inserted **after**
   the transaction (`LinguaRepository.kt:229-238`), so a failure there fails an import that succeeded.
   No JVM test covers any rollback path (`RepositoryTest.kt:102-139` only covers the happy path).

**Impact.** Worst case an import failure leaves records replaced with settings old (recoverable by
re-running the import); at minimum the user sees "file could not be read" for an import that actually
applied.

**Root cause.** Two independent stores cannot be one transaction; the compensating action is not
guaranteed to run.

**Fix.** Stage the settings write first (DataStore is a single atomic `edit`), keep the compensating
Room restore under `withContext(NonCancellable)`, treat rollback failure as a fatal storage error
with a clear message, and move `import_meta` inside the transaction or make it non-fatal
(`runCatching`). Cap the in-memory previous dataset / stream the restore.

**Regression test.** Robolectric: force `SettingsStore.replaceAll` to throw, assert records and
settings both equal the pre-import state. Cancellation variant using `coroutineScope { cancel() }`.

**Verification.** Source VERIFIED; failure behaviour NOT_VERIFIED (no test exists).

### A3-06 — P2 — the session `seq` guard is wall-clock based and can wedge draft persistence

**Evidence.** `native.ts:30-34`: `nextSeq = Math.max(seq + 1, Date.now())` — module-local, reset to 0
on every process start, and based on the wall clock, **not** on the session `seq` stored on the
device. Kotlin accepts a write only when `seq > current.seq` (`LinguaRepository.kt:80-81`,
`current.seq` comes from the last session row). Consequence: after a clock rollback (manual change,
NTP correction) a new process's first save gets `Date.now()` < stored `seq` and is rejected; because
the JS `seq` counter keeps using the same values, **every later save in that session is also
rejected** until the wall clock passes the old stamp. Rejection is a `false` return which no caller
reads (`routes/index.tsx:319;325-330` call `void persist.saveSession(...)`), so the draft silently
stops being saved while the UI shows nothing. The import path stamps the row with
`System.currentTimeMillis()` (`LinguaRepository.kt:205-210`), intersecting this with a store that JS
did not observe. (The guard itself is correctly placed inside a `Mutex` and compares against the
stored row, so _ordering within one process_ is protected when the clock behaves.)

**Impact.** Draft durability can be silently lost for a whole session after a clock change; a pending
pre-import session save may be wrongly rejected/overwrite depending on the timing against import.

**Root cause.** A logical monotonic counter implemented with wall time and not bootstrapped from the
stored counter.

**Fix.** At boot, read the stored `seq` (add it to the `boot` payload) and seed the JS counter above
it; use a Lamport-style counter (or a device-install UUID + counter) instead of `Date.now()` alone;
surface `false` from `saveSession` once per session.

**Regression test.** JVM: seed a session row with `seq = now + 3600_000`, then a save at current
`now` must be rejected (documents current behaviour) / after the fix must be accepted because the
boot payload seeds the counter. Vitest: fake a clock rollback and assert the save is queued with a
seq above the hydrated one.

**Verification.** Source VERIFIED; rollback scenario SUSPECTED (plausible, not observed).

### A3-07 — P2 — Android import report and import metadata are fabricated

**Evidence.** `nativePort.replaceAll` returns `applied ?? report`, where `applied` is the Kotlin
report (`native.ts:174-175`). Kotlin always builds
`{added: actual dataset sizes, skipped: 0/0/0, replaced: true}` (`LinguaRepository.kt:240-245`) —
even for a **merge**, where the accurate `mergeData` report (added vs already-present, `backup.ts:346-355`)
was computed in TypeScript and discarded. The UI prints exactly those numbers
(`DataControls.tsx:397-419`). `import_meta.fileName`/`digest` are `call.getString(...)`
(`LinguaStorePlugin.kt:230-231`) but the bridge DTO (`native/plugin.ts:58`) and the call
(`native.ts:168-173`) never send them → always `null`; `ImportDao.recent()` (`Daos.kt:86-89`) has no
caller, so the table is write-only. `added.settings` in the Kotlin report is
`newSettings.size - 1` (prefs key subtraction) and can be wrong/negative-ish in edge cases.

**Impact.** On Android the import result is misleading ("all rows added, none already present,
replaced" even for merge), the documented audit trail (file name, digest, mode, counts,
`docs/android/data-import-export.md:61-63`) does not exist, and `import_meta` becomes dead sensitive
data (see A3-09).

**Root cause.** Two implementations of the report; DTO not extended after Kotlin gained the fields.

**Fix.** Have Kotlin return its computed counts but let `nativePort` prefer the TS report for
added/skipped semantics (it already has it), or compute `skipped` in Kotlin from the merge; pass
`fileName`/`digest` through the DTO and record them; either read `recent()` in the Data screen or
stop persisting it.

**Regression test.** Vitest with a fake bridge: merge import must report `skipped.history > 0`.
Robolectric: `replaceAll` records `mode`, `fileName`, `digest` and non-zero skipped.

**Verification.** Source VERIFIED.

### A3-08 — P2 — "Forget everything" can leave data behind, or complete silently

**Evidence.** `stats.tsx:294-297` calls `clearDeviceData()` with **no await**, no error handling and no
reload. `clearData.ts:15-22` awaits `saved.clear → history.clear → memoryClear → persist.clearAll →
forgetSettingsCache`; each step can reject (`port.clearAll` throws, `saved.clear`/memory flush can
fail), and the unhandled rejection leaves the remaining stores uncleared while the UI has already
closed the confirmation. Settings writes are queued asynchronously (`settings.ts:73-101`); a write
already dispatched/queued when the clear happens can land **after** `clearAll` cleared DataStore
(`forgetSettingsCache` only clears the queue _after_ `persist.clearAll()` returns,
`clearData.ts:20-21`), so a just-changed setting survives "forget everything". `LinguaRepository.clearAll`
clears history/saved/memory/session and `settings.clear()` (`LinguaRepository.kt:248-257`), but
**not `import_meta`** (table stays with backup file names/digests/timestamps; `Entities.kt:80-89`).
After the clear the stats route keeps its already-loaded `entries` state until remount
(`useArchive.ts:16-31`), so the archive still looks present.

**Impact.** Privacy promise ("forget everything") can be partially false: a setting persists, import
metadata persists, and a storage failure is invisible. The stale on-screen archive can make the user
believe the clear failed (or succeeded when data remains on disk).

**Root cause.** No transaction/ordering across the clear path; `import_meta` introduced after the
clear contract was written; results unchecked.

**Fix.** `await` and handle `clearDeviceData()`; clear the settings queue and stop/flush it **before**
`clearAll`; include `import_meta` in `clearAll`; report partial failures; rehydrate/blank module
caches and navigate or reload after success.

**Regression test.** Vitest: queue a `writeDeviceValue`, call `clearDeviceData`, await it, assert no
`lingua.*` value remains afterwards and the queued write did not resurrect one. Robolectric:
`clearAll()` leaves every table (including `import_meta`) empty.

**Verification.** Source VERIFIED; device behaviour NOT_VERIFIED.

### A3-09 — P2 — the Android success boot never applies stored appearance/settings to the document

**Evidence.** `applyStoredAppearance()` (`platform.ts:56-69`) reads the hydrated snapshot and applies
theme, locale, intro release and theme-color. It is called **only in the boot-failure branch**
(`platform.ts:88-95`); the success branch (`platform.ts:79-87`) calls `hydratePersist` /
`hydrateHistory` / `hydrateSaved` / `hydrateMemory` and stops. On Android the pre-paint
`THEME_BOOT` (`theme.ts:31`) reads `localStorage`, which the native app never writes, so it always
resolves `dark`/system; `useTheme` (`theme.ts:62-74`) then takes `current()` from
`document.documentElement.dataset.theme` (`theme.ts:32-34`), never from `readDeviceValue(THEME_KEY)`.
Net effect: a saved `vivid`/`light` theme is ignored on every cold start and reverts to
dark/system after the first toggle-free launch. Likewise `INTRO_BOOT` (`intro.ts:24`) tests
`localStorage`, `shouldShowIntro()` (`intro.ts:7-9`, which _does_ read the snapshot) is never called,
and the translator decides with `introPending()` (`index.tsx:261`): with no draft restored the intro
can be shown on every launch even though `lingua.intro.seen.v1 === "1"` is in DataStore.
`docs/android/architecture.md:46-58` documents `applyStoredAppearance()` as part of the success boot
sequence; `docs/architecture/state-and-persistence.md:115-117` claims the same. (The concurrent
`__root.tsx` hydration-cover change, `__root.tsx:104-136`, does not change this: it keeps the shell
hidden until `hydratePlatform` resolves, but the appearance is still never applied.)

**Impact.** User settings do not survive a restart visually: theme resets each launch; intro can
repeat; direction/locale are only correct because `initLocale()` re-reads the snapshot later
(`i18n.ts:615`, `index.tsx:238`), not through the documented boot path.

**Root cause.** The appearance step was only wired into the degraded branch; the boot script has no
native branch.

**Fix.** Call `applyStoredAppearance()` on the success branch before `ready = true`, and make
`shouldShowIntro()` the single decision with `INTRO_BOOT` released accordingly (the attribute must be
set by the boot script only when it can know; on native set it from the snapshot before first paint,
e.g. keep the cover until then and call `releaseIntroGate` from the success path).

**Regression test.** Vitest `platform.test.ts`: fake a successful hydrate with
`{theme: "light", intro: "1"}` and assert `document.documentElement.dataset.theme === "light"` and the
intro attribute is removed. This is a separate test from the existing degraded-path tests
(`platform.test.ts:40-64`).

**Verification.** Source VERIFIED; on-device NOT_VERIFIED.

### A3-10 — P2 — no recovery path from a corrupt database or DataStore

**Evidence.** `platform.ts:86-101`: any boot error → "unavailable" session; the app opens with empty
records, and nothing retries hydration later (the rejected `nativePort.hydrate()` promise keeps
running but nobody consumes it). `Room` is intentionally opened without a destructive fallback
(`LinguaDatabase.kt:74-79`), which is correct, but there is **no** user-facing "repair/reset storage"
action: `DataControls` only says storage could not be opened (`DataControls.tsx:277-284`) and the
export path would fail too (`port.snapshot()` → bridge → same failure), so the user cannot even save
their data before uninstalling. DataStore has no `corruptionHandler`/replacement policy
(`SettingsStore.kt:17`) — one corrupt settings file fails every `boot()` indefinitely
(`LinguaRepository.kt:37-38`), and every settings write/read after that rejects. `docs/android/architecture.md`'s
failure philosophy ("app still runs; writes report failure") is true, but "Data settings says storage
is unavailable" is the end of the story.

**Impact.** After a corruption (or a boot regression) the user's only recovery is uninstall →
everything is lost; the backup feature is unreachable exactly when it is needed. Also feeds A3-02.

**Root cause.** Fail-safe (don't destroy) was chosen without a corresponding user-consented repair.

**Fix.** Add a Data-settings action that opens the DB with a _quarantine_ path (copy the file aside,
recreate) and restores from an imported backup; add a DataStore `ReplaceFileCorruptionHandler` that
quarantines the corrupt file and starts from defaults (settings are re-importable); make
`platformError()` visible on the Data settings screen with an export attempt that streams the raw
`lingua.db` if the bridge can read it.

**Regression test.** Robolectric: boot with a corrupt `lingua.db` → plugin rejects with the calm
message; a repository `resetStorage()` opens a fresh DB without deleting the quarantined copy.
Vitest: failed boot then a successful export attempt is offered (or explicitly not offered) per the
new contract.

**Verification.** Source VERIFIED (missing path); actual corruption behaviour SUSPECTED/NOT_VERIFIED.

### A3-11 — P2 — documented backup contract differs from the implementation in four places

**Evidence.**

1. `docs/android/data-import-export.md:57-60` says merge matches **by id**, newer `updated_at`/`created_at`
   wins, "existing rows are never deleted". Code: `mergeData` builds `historyByText` keyed by
   `target|normalized(original)` (`backup.ts:255-285`), and a same-id/different-text incoming row is
   assigned over the local row unconditionally (`backup.ts:282-283`) — ids are matched only as a
   fallback collision, and a merge can replace a local row whose id collides.
2. Merge settings are overwritten **unconditionally** by the older file: `settings[k] = v` for every
   incoming key (`backup.ts:329-335`) — a newer local theme/favourites/intro value is replaced by the
   backup's, contrary to "newer wins" and "nothing is deleted".
3. `docs/android/persistence-and-migrations.md:75-76` says "a row that fails validation is skipped,
   counted as skipped during import". `cleanData` silently drops invalid rows (`backup.ts:90-119`) and
   the report's `skipped` counters are duplicate counts from the merge, not validation skips; the
   preview counts only valid rows.
4. The envelope example (`data-import-export.md:12-38`) names `exportedAt`/`payload`/`ciphertext`
   where the code writes `createdAt`/`data`/`cipher.text`, labels the KDF `PBKDF2-SHA256` where the
   code writes `kdf: "PBKDF2"`, says the digest covers "the canonical payload" while encrypted files
   digest the **ciphertext** (`contracts.ts:245-263`, `backup.ts:127-146,236-241`), and the
   encrypted-file error is reported as `password` for _any_ crypto failure (`backup.ts:243-245`).
   `appVersion` is read from `import.meta.env.VITE_APP_VERSION` (`DataControls.tsx:157`) which no
   build defines, so every backup says "1.0.0" (`.output` grep shows no define).

**Impact.** A user restoring an old backup can lose newer settings and be misled about what "merge"
did; the backup format documentation is not usable to write a compatible tool; encrypted-file
diagnostics are misleading. Not data-loss on the archive itself (except the id-collision edge).

**Fix.** Decide and document one merge truth (text-keyed, which matches the archive's own duplicate
rule) and make settings recency explicit (e.g. keep local on conflict, or compare a settings
timestamp). Either count invalid rows or stop claiming to. Correct the envelope doc to the real
DTO; distinguish "wrong password" from "damaged ciphertext" (both return `password` today); define
`VITE_APP_VERSION` in `vite.native.config.ts`/`vite.config.ts`.

**Regression test.** Extend `persistence.test.ts:72-113`: merge with an older backup must not
overwrite a newer setting (or must, per decided contract); a file with one invalid row reports
`skipped: 1`; encrypted file with a corrupted tag reports `damaged`, not `password`.

**Verification.** Source VERIFIED.

### A3-12 — P2 — web import reports success even when the archive was not written

**Evidence.** `webPort.replaceAll` calls `writeHistorySync(data.history)` and **ignores its
`{ok}`** (`web.ts:271-273`; contrast `historyUpsert`, `web.ts:206`, which throws on failure);
`savedWrite` swallows quota/blocked errors (`web.ts:240-249`), `writeMemory` swallows them
(`web.ts:137-141`), and the settings writes return booleans that are ignored. The `catch` rollback
(`web.ts:285-290`) only runs for thrown errors, so the common "quota exceeded" path reports
"Import finished" with the old archive intact (or partially written history + old phrasebook). The
Android adapter is not affected (Kotlin throws and rolls back).

**Impact.** Web users on a full/blocked localStorage can believe a restore succeeded; if a big
import evicted rows, the user has neither the import nor their old data (the eviction in
`writeHistorySync` trims to fit, `web.ts:99-125`). Data loss risk on the web build.

**Root cause.** The port contract ("writes report failure") is not honoured inside this method.

**Fix.** Check `writeHistorySync(...).ok` and throw (→ rollback), return false from
`savedWrite`/`writeMemory` (or throw) and abort before reporting; take the snapshot _after_ a
successful write is impossible, so keep a rollback copy and verify by re-read.

**Regression test.** Vitest: stub `localStorage.setItem` to throw `QuotaExceededError` for the history
key and call `webPort.replaceAll`; must reject and leave the pre-import archive readable.

**Verification.** Source VERIFIED.

### A3-13 … A3-20 — P3 details (condensed)

- **A3-13 Migration realism.** The repo exports only `android/app/schemas/today.fluently.app.data.LinguaDatabase/2.json`;
  v1 was never exported and `git log` shows the whole `android/` tree (including the DB at
  `version = 2`, `LinguaDatabase.kt:18-28`) was added in `e31c6d3`, so no released build ever wrote
  a v1 file. **Amended (working tree changed during the audit):** at first read
  `MigrationTest.kt:26-73/76-92` hand-wrote the v1 schema and checked only one history row, and the
  `saved_phrases.normalized` backfill was unasserted. Another agent then strengthened the test on
  disk (uncommitted, not run by me): it now inserts a `saved_phrases` row with a tab, checks the
  backfilled `normalized`, checks the session row survives, adds a test through the production
  `LinguaDatabase.open()`, and a "missing migration fails loudly without deleting rows" test. That
  closes the backfill/production-open part; the remaining data gaps are that v1 is still a
  hand-written schema (not the exported `1.json` through `MigrationTestHelper`) and the normalisation
  parity gaps below. Docs claim schemas are copied into `androidTest` assets for
  `MigrationTestHelper` (`persistence-and-migrations.md:62-63`) — there is no `androidTest` asset and
  the only instrumented test is the stale Capacitor template. The backfill normaliser
  (`LinguaDatabase.kt:57-62`) does not equal `Mapping.normalize` (`Mapping.kt:20`) for NBSP-style
  whitespace (SQLite `REPLACE`/`TRIM` are ASCII-only; JS `\s` includes U+00A0) and the "four passes
  cover 32 consecutive spaces" comment is arithmetically wrong (each pass halves → 32 → 2, i.e.
  ≥17-space runs stay non-normalised). Data consequence: an upgraded v1 row with such whitespace
  will not match `candidates()` and will be duplicated on re-translation. Cross-ref **A7-04**
  (release-test realism) — this finding is the data-specific part only.
- **A3-14 Validator drift.** `isEntry` accepts negative/zero `createdAt` and empty
  `original`/`translated` (`contracts.ts:114-141`); Kotlin `Mapping` requires `createdAt > 0` and
  non-blank text and caps id length 128 (`Mapping.kt:22-53,72-91`). A backup created/accepted by the
  web or by JSON validation can therefore contain rows that Android silently drops on import with no
  `skipped` count (see A3-11/A3-07). Fix: one shared fixture table and a Kotlin/TS parity test;
  return a "rows refused" count from Kotlin.
- **A3-15 Bounds at the persistence boundary.** `docs/android/persistence-and-migrations.md:71` says
  memory is "re-checked in Kotlin"; Kotlin only caps the row count (`LinguaRepository.kt:131`,
  `MEMORY_LIMIT = 120`, `LinguaRepository.kt:269`) and a per-row JSON size
  (`Mapping.kt:105-115`), while the 200 000-byte budget is TS-only (`memory.ts:61-76`). `replaceAll`
  inserts memory without any byte trim (`LinguaRepository.kt:203`), boot hydrates all rows without TTL
  (`LinguaRepository.kt:46` → `native.ts:66-69`), and `replaceAll` does not `take(SAVED_LIMIT)` for
  `saved` (`LinguaRepository.kt:203` vs `savedWrite` at :124). Trusted-input-only today, but the
  documented bound should be enforced where data crosses the bridge.
- **A3-16 Stats read path.** `history.status` is set to "unavailable" in `history.all()`'s catch
  (`history.ts:123-126`) and never set back to "ok" (initial value only, `history.ts:33`; `reload()`
  at :110-113 does not reset it), so one transient bridge error makes the Statistics screen render
  its error state for the rest of the session even after `all()` succeeds
  (`stats.tsx:139,313-326`). On native, `reload()` sets `cache = null`; `current()` then resolves
  native to `[]` and `total = 0` (`history.ts:46-52`), zeroing the count until the next fetch. Full
  archive is refetched only when `recent?.length` changes on mount (`useArchive.ts:16-31`), so a
  stats screen mounted while the archive grows (or a retried store) can miss rows. Statistics are
  otherwise correctly derived from the archive with no second store (VERIFIED, §6).
- **A3-17 Cross-device backup leg.** `LinguaFilesPlugin.pickBackup` reads in 1 MiB chunks and decodes
  each chunk separately as UTF-8 (`LinguaFilesPlugin.kt:83-93`) — a split multi-byte character
  (Arabic/German) becomes U+FFFD, the digest then fails, and the user is told the file is not a
  backup; no test covers a >1 MiB file. Android refuses >8 MiB but the web upload has no limit
  (`DataControls.tsx:233-247`), while a full archive backup can approach that (2000 rows × up to
  10 000 chars). PBKDF2 (210 000 iterations, `backup.ts:169`) and the whole-file parse/clean run on
  the WebView main thread during "Reading the file…" (`backup.ts:220-238`). Full-archive reads
  (`historyAll`) and import datasets cross the bridge as one JSON string
  (`LinguaStorePlugin.kt:184-189`, `LinguaRepository.kt:174-178`), up to ~10 MB each, with the whole
  previous dataset also retained in RAM during import — plausible OOM/jank on minSdk-24 devices
  (**SUSPECTED**, not measured). Fix: decode with a streaming UTF-8 decoder or `InputStream.readBytes`
  with `String(bytes, UTF_8)`; page the archive backup/restore; run PBKDF2 off the main thread
  (`crypto.subtle` already returns a promise but the parse/clean loop does not).
- **A3-18 Draft on process death.** `routes/index.tsx:315-339`: debounce 400 ms, then
  `void persist.saveSession(...)`; `visibilitychange`/`pagehide`/`lingua:flush` all call it
  fire-and-forget, and `flushPlatform()` awaits only `flushSettings()` (`platform.ts:141-148`).
  Android can kill a background process without a further callback, so the last debounce window is
  still best-effort. Document this honestly or add a small native "pending session write" flush via
  `App.addListener` + a Capacitor `appStateChange` acknowledge (or reduce the debounce on native).
- **A3-19 Failure surfacing.** `saved.write` returns `false` but `saved.toggle/mark/update` ignore it
  and the UI shows the phrase as saved (`saved.ts:34-43,58-95`, `index.tsx:716-724`); `memorySet`'s
  result is dropped at the call sites (`memory.ts:101-111`, `useTranslator.ts:350,369`); prefs writes
  are `void`ed (`index.tsx:308-309`). Only `history.lastWriteOk()` is surfaced, and only on the
  Statistics page (`stats.tsx:396-410`). The port's own contract says "writes report failure instead
  of swallowing it" (`persistence/port.ts:32-37`) — it does report, the callers swallow.
- **A3-20 Docs/impl drift (see §7).** `SettingsStore` stores **one preference per key**
  (`SettingsStore.kt:19-46`), not "one JSON map"; `architecture.md:46-58` describes
  `applyStoredAppearance()` in the success boot; `architecture.md:80-82` says "The web adapter is not
  imported at runtime" but `history.ts:11`, `saved.ts:10`, `memory.ts:10` import it unconditionally
  (guarded by `!native`, so no dual write, but the claim is inaccurate); `persistence-and-migrations.md:73`
  says seq is "compared in SQL" (it is compared in Kotlin under a `Mutex`); the fixed
  test count "9 tests" (`persistence-and-migrations.md:3`) was already stale at first read (8
  `@Test` methods: 1 in `MigrationTest.kt`, 7 in `RepositoryTest.kt`) and the tree
  now carries 10 on-disk JVM tests (MigrationTest expanded to 3 during the audit); the number must
  not be a literal in the doc.

## 6. Verified vs unverified matrix

| Claim / behaviour                                                           | Classification                                                                                                                                                            | Evidence                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One source of truth per platform; no dual write in native mode              | **VERIFIED (source)**                                                                                                                                                     | `persistence/index.ts:11`; `history.ts:36,190-206`; `saved.ts:17,22-26`; `memory.ts:36,51-55`; `settings.ts:45-54,73-86`; only writer of `localStorage` is `web.ts`/`settings.ts` web branch |
| Android records live in Room, settings in DataStore                         | **VERIFIED (source)**                                                                                                                                                     | `LinguaRepository.kt:36-48,102-137`; `SettingsStore.kt`; `Entities.kt`; schema `2.json`                                                                                                      |
| Boot script gets a validated snapshot and degrades safely                   | **VERIFIED (source)**, timing NOT_VERIFIED                                                                                                                                | `platform.ts:71-101`; `platform.test.ts:40-64` (web tests exist; not run by me)                                                                                                              |
| Degraded boot is _safe for existing phrasebook_                             | **FAIL (source)** — see A3-02                                                                                                                                             | `platform.ts:86-98`; `saved.ts:22-43`; `LinguaRepository.kt:121-126`                                                                                                                         |
| Backup create/parse/digest/AES-GCM/version logic                            | **VERIFIED (source)**; executed tests **NOT_VERIFIED by me**                                                                                                              | `backup.ts:44-248`; `persistence.test.ts:115-207` exists                                                                                                                                     |
| Backup merge/replace semantics match docs                                   | **FAIL (source)** — see A3-11                                                                                                                                             | `backup.ts:250-384` vs `data-import-export.md:56-65`                                                                                                                                         |
| Import is one atomic transaction incl. settings                             | **FAIL (source)** — see A3-05                                                                                                                                             | `LinguaRepository.kt:196-227`                                                                                                                                                                |
| Import rollback proven by test                                              | **NOT_VERIFIED** (no such test)                                                                                                                                           | `RepositoryTest.kt:102-139` happy path only                                                                                                                                                  |
| Kotlin JVM tests pass (10 on disk now, 8 at first read; docs say 9)         | **NOT_VERIFIED by me** (not run: Gradle build was owned by the Lead)                                                                                                      | `android/app/src/test/**`; `docs/quality/testing.md:27`                                                                                                                                      |
| Migration v1→v2 tested against a real exported v1 schema                    | **NOT_VERIFIED / SUSPECTED** — no v1 schema exists; test hand-builds one (working tree expands coverage to `saved_phrases`/production open, still not an exported schema) | A3-13, `MigrationTest.kt:26-73`, `schemas/…/2.json`                                                                                                                                          |
| Session stale-write guard correct within one process                        | **VERIFIED (source)** for ordering; clock-robustness **FAIL** (A3-06)                                                                                                     | `LinguaRepository.kt:76-87`; `native.ts:30-34`                                                                                                                                               |
| Session survives force-stop / process death                                 | **NOT_VERIFIED** (no device run)                                                                                                                                          | `platform.ts:150-175`; `routes/index.tsx:312-339`                                                                                                                                            |
| Statistics derived from the archive, no second store                        | **VERIFIED (source)**                                                                                                                                                     | `engine.ts`; `useArchive.ts`; `agreements` in AGENTS.md                                                                                                                                      |
| Statistics read-path recovery (retry/status)                                | **FAIL (source)** — A3-16                                                                                                                                                 | `history.ts:110-127`; `stats.tsx:139,313-326`                                                                                                                                                |
| "Forget everything" removes all device data                                 | **FAIL (source)** — A3-08/A3-09                                                                                                                                           | `clearData.ts`; `LinguaRepository.kt:248-257`; `stats.tsx:294-297`                                                                                                                           |
| Android app persists anything **as shipped** (1.0.2)                        | **NOT_VERIFIED by me / teammate-reported FAIL**, fix uncommitted                                                                                                          | A3-01, `native/plugin.ts:80-106` + `plugin.test.ts`                                                                                                                                          |
| DataStore settings applied before first native frame                        | **FAIL (source)** — A3-09                                                                                                                                                 | `platform.ts:91` only failure branch                                                                                                                                                         |
| Corrupt DB / disk-full behaviour matches docs ("rollback, previous intact") | **SUSPECTED / NOT_VERIFIED**                                                                                                                                              | A3-05/A3-10; no fault-injection test                                                                                                                                                         |
| Backup → restore on device (SAF)                                            | **NOT_VERIFIED**                                                                                                                                                          | TD17; no device run by me                                                                                                                                                                    |
| Encrypted backup round-trip inside the Android WebView                      | **NOT_VERIFIED**                                                                                                                                                          | TD17; Capacitor origin is `https://localhost` so `crypto.subtle` should exist, not tested                                                                                                    |
| Data at rest: Room plaintext, OS backup disabled                            | **VERIFIED (source)** for manifest/known debt; TD19 remains open                                                                                                          | `AndroidManifest.xml:14-16`; `technical-debt.md:24`                                                                                                                                          |

## 7. Documented guarantees that the code does not enforce

| Documented guarantee                                                                                                                   | Where                                                                                    | Actual behaviour                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The write is one Room transaction; any failure rolls back, leaving the previous state intact"                                         | `data-import-export.md:61-62`                                                            | Room records in one transaction; settings written after it; rollback best-effort (A3-05)                                                                                                                         |
| "The UI reports added/skipped per entity and the import is recorded in import_meta with file name, digest, mode, counts and timestamp" | `data-import-export.md:62-65`                                                            | Android report is fabricated (skipped 0, replaced true); file name/digest are `null`; table never read (A3-07)                                                                                                   |
| "Merge matches by id; the newer row wins; existing rows are never deleted"                                                             | `data-import-export.md:57-58`                                                            | Matches by target+normalised text; settings overwritten unconditionally (A3-11)                                                                                                                                  |
| "Rows failing validation are skipped and counted"                                                                                      | `persistence-and-migrations.md:75-76`                                                    | Silently dropped, not counted (A3-11/A3-14)                                                                                                                                                                      |
| "Settings snapshot: one Preferences key containing a JSON object"                                                                      | `persistence-and-migrations.md:87`, `architecture.md:78`, `state-and-persistence.md:110` | One DataStore string preference per key (A3-20)                                                                                                                                                                  |
| "Device-only preferences stay on the device"                                                                                           | `persistence-and-migrations.md:91-93`                                                    | True in that they are not in backups; but a **replace** import clears every DataStore key not in the file, so a future device-only key would be deleted by an import (today every key happens to be whitelisted) |
| "First paint already has the saved theme … `applyStoredAppearance()` runs in the boot sequence"                                        | `architecture.md:46-58`, `state-and-persistence.md:115-117`, `__root.tsx:109-111`        | Only the degraded branch applies it; saved theme/intro are ignored on the success path (A3-09)                                                                                                                   |
| "The session is flushed on visibilitychange/pagehide so the last keystrokes are not lost"                                              | `state-and-persistence.md:55-57`                                                         | Flush is fire-and-forget; `flushPlatform` waits only for settings (A3-18)                                                                                                                                        |
| "Writes report failure instead of swallowing it"                                                                                       | `persistence/port.ts:32-37`                                                              | Port reports; callers for saved/memory/prefs/theme discard the boolean (A3-19)                                                                                                                                   |
| "Memory bounded twice … re-checked in Kotlin"                                                                                          | `persistence-and-migrations.md:71`                                                       | Kotlin checks rows only; byte budget is TS-only (A3-15)                                                                                                                                                          |
| "Migrations are additive and transactional; exportSchema + androidTest assets for MigrationTestHelper"                                 | `persistence-and-migrations.md:56-63`                                                    | v1 schema not exported; no androidTest assets; hand-written v1 test (A3-13)                                                                                                                                      |
| "Every migration ships with a test that opens the previous schema with real rows"                                                      | `persistence-and-migrations.md:60-61`                                                    | Test opens a hand-written schema (not an exported v1 schema); v1 backfill coverage is being expanded in the working tree (A3-13)                                                                                 |
| "clearAll deletes records and settings inside a transaction"                                                                           | `persistence-and-migrations.md:97-98`                                                    | Records in a Room transaction, then `settings.clear()` separately; `import_meta` not cleared (A3-08)                                                                                                             |

## 8. Highest-priority actions (for the Lead)

1. **Commit the bridge fix first (A3-01)** — `asNonThenable` + `plugin.test.ts` — and run the
   new `BridgeInstrumentedTest` (uncommitted, TD20) plus the manual smoke check (boot → save a
   phrase → force-stop → relaunch). Every other data guarantee is untestable until the bridge
   actually works on device.
2. **Introduce a hydration generation (A3-02/A3-03).** No whole-table write (phrasebook, memory)
   until the store has been hydrated successfully, and rehydrate all module caches synchronously as
   part of `port.replaceAll`/`clearAll` (or force a reload). This is the only P0 data-loss item that
   does not require a device.
3. **Serialise the bridge and version whole-document writes (A3-04).** One dispatcher/Mutex for all
   mutations in `LinguaRepository`, plus a per-family revision so a stale list cannot overwrite a
   newer one; make import hold the same lock.
4. **Finish the import contract (A3-05/A3-07/A3-11).** Return a truthful report, pass and record
   `fileName`/`digest`, use `NonCancellable` for the rollback, and reconcile docs/code for merge
   semantics and bounds.
5. **Fix "forget everything" and boot appearance (A3-08/A3-09)** — cheap correctness: await the
   clear, clear `import_meta`, invalidate caches, apply the stored theme/intro on the success path.
6. **Add the missing persistence regression tests** (A3-02/A3-03/A3-04/A3-05) to
   `src/lib/persistence/persistence.test.ts`, `src/lib/platform.test.ts` and
   `android/app/src/test/.../RepositoryTest.kt`, and add the device checks to TD17's checklist
   (force-stop, restore, backup→restore, corrupt-DB start, DataStore cleared setting).

## 9. Appendix — what I actually executed

- Read the files listed in §1 with the read tool (no edits).
- `git status`, `git log --oneline` (last 8), `git show`, directory listings for
  `android/app/schemas`, `android/app/src/androidTest`, `android/app/src/main/assets/public`,
  `wc -l`, and `grep` over source/docs to locate call sites and counts.
- `git diff` of the concurrent uncommitted changes (`gradle.properties`, `native/plugin.ts`,
  `routes/__root.tsx`, `vite.native.config.ts`, `native/plugin.test.ts`, and later
  `android/app/build.gradle.kts`, `MigrationTest.kt`, the deleted template tests and the new
  `BridgeInstrumentedTest.kt`) to make sure I audited the tree as it is now and did not report a
  defect someone is already fixing.
- Inspected Capacitor 8.6.2's `JSInjector.java`/`Bridge.java` in `node_modules` to confirm the
  bridge script is injected in `<head>` before app scripts (so `isNativeApp()` at module load is
  reliable) — that specific worry is **cleared**, not a finding.
- **Not run:** `npm run verify`, `vitest`, `./gradlew`, `adb`, the emulator, or the app. No test
  result in this report is claimed as executed by me; the Lead's baseline (`npm run verify` exit 0)
  and the teammate's device observation are referenced as such.
