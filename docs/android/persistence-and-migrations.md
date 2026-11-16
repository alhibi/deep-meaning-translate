# Persistence and migrations (Android)

Status: **Implemented; JVM tests pass** (`:app:testDebugUnitTest`: 10 tests — 7 repository/contracts
+ 3 migration, plus 3 backup-reader tests). Device behaviour was executed on emulator-5554
(API 35) for draft restore, phrasebook/history/memory persistence, force-stop and import; API
24–29 and physical devices remain **NOT_VERIFIED** (TD17/TD21).

## Two stores, one owner each

| Data | Store | Why |
| --- | --- | --- |
| Archive (translation history), saved phrases, translation memory, session, import metadata | Room (`lingua.db`) | Queryable, bounded, transactional; the archive is the product's memory |
| Small settings (theme, locale, voice, feel, style defaults, install hint) | Preferences DataStore (`lingua.prefs.v1`) | A few dozen scalars; no schema churn |

`localStorage` is not used for records in the installed app. There is no dual write.

## Schema (version 2)

```text
history_entries
  id TEXT PK · source · target · original · translated · normalized
  created_at · updated_at · uses · style? · formality? · situation?
  tags_json? · fix_json? · version
  index (created_at), (updated_at), (target), (target, normalized)

saved_phrases
  id TEXT PK · source · target · original · translated · normalized
  created_at · known · reviewed_at
  index (created_at), (target, normalized)

memory_rows
  cache_key TEXT PK · payload · created_at           -- last 120 entries / 200 KB / 30 days

session_state
  id=1 · json? · seq · updated_at                    -- one row; seq rejects stale writes

import_meta
  id INTEGER PK AUTOINCREMENT · fileName? · digest? · mode · imported_at · added · skipped
```

`normalized` is the merge key: trimmed, one space for every run of whitespace. It is
computed in Kotlin (`Mapping.normalize`) for native writes and in TypeScript for web
writes, with the same rule.

## Migration 1 → 2

Version 1 stored the original text only. Version 2 adds `normalized` to both record
tables plus the composite indexes the archive queries use.

```text
ALTER TABLE history_entries ADD COLUMN normalized TEXT NOT NULL DEFAULT ''
ALTER TABLE saved_phrases   ADD COLUMN normalized TEXT NOT NULL DEFAULT ''
UPDATE … SET normalized = TRIM(REPLACE(…)) with repeated space-collapse passes
CREATE INDEX index_history_entries_target_normalized …
CREATE INDEX index_saved_phrases_target_normalized …
```

Rules that hold for every future migration:

- `fallbackToDestructiveMigration` is forbidden. A missing migration is a build defect.
- Migrations are additive and transactional; no row is re-keyed or deleted.
- Every migration ships with a test that opens the previous schema with real rows and
  reads them through the current DAOs (`MigrationTest.kt`, 3 tests). The v1 schema is
  recreated in the test because no exported `1.json` was kept; the production
  `LinguaDatabase.open()` path is also exercised, and a missing migration is asserted to fail
  loudly without deleting the v1 rows.
- Room schemas are exported to `android/app/schemas/` (version 2 is committed).

## Bounds

| Limit | Value | Enforced by |
| --- | --- | --- |
| Archive | 2000 | TypeScript merge + `historyTrim` |
| Saved phrases | 300 | TypeScript write bound |
| Translation memory | 120 entries / 200 000 bytes / 30 days | TypeScript memory trim; Kotlin caps rows on write |
| Text per field | 5000 chars | `Mapping` and TS validators |
| Session writes | newest `seq` wins | `session_state.seq` compared in SQL |

A row that fails validation is skipped, counted as skipped during import, and never
aborts the rest of the batch.

## Session and draft

The draft is one JSON document (`text`, pair, style, result). It is written on a short
debounce and flushed when the app goes to the background (`platform.ts`). Writes carry a
monotonic `seq`; an older write that arrives late cannot replace a newer one — the same
guard the web store keeps in memory, now durable. The stored `seq` is returned at boot and
seeds the next write, so a device clock rollback cannot make every later save look stale.

Two defects found on hardware are fixed and tested: the epoch-millisecond stamp arrives as a
JSON **Long** (`PluginCall.getDouble` rejects Long, so seq silently became 0 and every draft
save was rejected), and a whole-table write could run from an unhydrated cache when the bridge
timed out. `BridgeInstrumentedTest` covers the Long decode and the stale-write guard on a real
device; native writes are refused until the boot snapshot is applied.

## Settings snapshot

`SettingsStore` keeps one Preferences string per `lingua.*` key (theme, locale, voice, feel,
recent languages, favourites, intro gate, install hint). The bridge returns the whole map at
boot; the app caches it and reads synchronously. Writes are queued and coalesced per key, and
are refused until that snapshot has been applied. Unknown keys and keys outside `lingua.*`
are refused at the Kotlin boundary.

The backup whitelist (`BACKUP_SETTING_KEYS` in `src/lib/persistence/contracts.ts`) is the
only set of settings that can leave or enter a backup; device-only preferences stay on the
device.

## Clearing data

`clearAll` deletes records, `session_state` and `import_meta` in one Room transaction, clears
DataStore, and resets the in-memory feel/voice caches; the statistics screen awaits it, so a
later toggle in the same session cannot resurrect a forgotten value. Uninstalling removes the
database, DataStore files and the WebView cache — the exported backup file is the only
surviving copy, which the UI says explicitly.

A failed or timed-out boot is a **read/write-unavailable** session, not an empty archive: the
app still translates, the data screen says storage is unavailable, and no whole-table write
can run from an unhydrated cache.
