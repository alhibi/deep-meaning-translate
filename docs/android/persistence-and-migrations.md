# Persistence and migrations (Android)

Status: **Implemented; migration and DAO tests pass** (`:app:testDebugUnitTest`, 9 tests).
Device behaviour is **NOT_VERIFIED** (no device/emulator).

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
  reads them through the current DAOs (`MigrationTest.kt`).
- Room schemas are exported to `android/app/schemas/` and copied into
  `androidTest` assets for `MigrationTestHelper` on devices.

## Bounds

| Limit | Value | Enforced by |
| --- | --- | --- |
| Archive | 2000 | TypeScript merge + `historyTrim` |
| Saved phrases | 300 | TypeScript write bound |
| Translation memory | 120 entries / 200 000 bytes / 30 days | TypeScript memory trim, re-checked in Kotlin |
| Text per field | 5000 chars | `Mapping` and TS validators |
| Session writes | newest `seq` wins | `session_state.seq` compared in SQL |

A row that fails validation is skipped, counted as skipped during import, and never
aborts the rest of the batch.

## Session and draft

The draft is one JSON document (`text`, pair, style, result). It is written on a short
debounce and flushed when the app goes to the background (`platform.ts`). Writes carry a
monotonic `seq`; an older write that arrives late cannot replace a newer one — the same
guard the web store keeps in memory, now durable.

## Settings snapshot

`SettingsStore` keeps one Preferences key containing a JSON object. The bridge returns it
at boot; the app caches it and reads synchronously. Writes are queued and coalesced per
key. Unknown keys and keys outside `lingua.*` are refused at the Kotlin boundary.

The backup whitelist (`BACKUP_SETTING_KEYS` in `src/lib/persistence/contracts.ts`) is the
only set of settings that can leave or enter a backup; device-only preferences stay on the
device.

## Clearing data

`clearAll` deletes records and settings inside a transaction. The app then reloads, so no
stale in-memory row survives. Uninstalling removes the database, DataStore files and the
WebView cache — the exported backup file is the only surviving copy, which the UI says
explicitly.
