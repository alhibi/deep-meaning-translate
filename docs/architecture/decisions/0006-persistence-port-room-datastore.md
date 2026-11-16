# ADR 0006 — PersistencePort with Room and DataStore on Android

Status: accepted · 2026-11-16

## Context

The web app used `localStorage` directly. Android needs durable, queryable, bounded
records that survive process death and can be imported transactionally. Copying writes to
both `localStorage` and Room would create two truths and a class of drift bugs that are
invisible until a restore.

## Decision

Introduce `PersistencePort` with two adapters chosen once at boot:

- **web**: the existing `localStorage` keys and validators, unchanged behaviour;
- **native**: `LinguaStore` bridge → `LinguaRepository` → Room (`lingua.db`, v2) for
  records, Preferences DataStore for settings and prefs.

Stores keep a synchronous read cache hydrated at boot; writes are async. On the web the
write still completes before the next read in practice, so existing synchronous
assumptions and tests hold. On Android, a failed write is reported and the cache remains
the last known good state.

Migrations are additive, transactional and tested; `fallbackToDestructiveMigration` is
forbidden. Session writes carry a `seq` so a late write cannot overwrite a newer draft.

## Consequences

- One source of truth per platform; no dual write.
- Backup import can run in one transaction and roll back on failure.
- The bridge is versioned by JSON DTOs; the Kotlin layer validates independently of the
  TS validators (defence in depth).
- Added cost: a native build step and tests in two languages, both kept small and focused
  on the storage contract.
