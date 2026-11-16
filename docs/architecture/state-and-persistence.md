# State and Persistence

Status: **Verified** against source and tests on 2026-11-16. Keys below were read from the
implementation, not invented. The web session race fix, cross-tab sync and storage-health surface
were added in the web upgrade audit; the native adapter was not changed and is device-NOT_VERIFIED
for those specific behaviours.

## Ownership

| Concern                                  | Owner                           | Survives route change          | Survives reload                   |
| ---------------------------------------- | ------------------------------- | ------------------------------ | --------------------------------- |
| Draft, pair, style, dialect, brain       | `src/routes/index.tsx`          | Yes (remembered session/prefs) | Yes (validated storage)           |
| Translation phase/result/in-flight cache | `lib/translation/useTranslator` | Yes, via primed session result | Settled results via device memory |
| Theme                                    | `lib/theme` store               | Yes (root shell)               | Yes (boot script)                 |
| Interface locale / direction             | `lib/i18n` store                | Yes (root shell)               | Yes (boot script)                 |
| History and saved phrases                | `lib/history`, `lib/saved`      | Yes                            | Yes                               |
| Statistics                               | derived from history            | Yes                            | Yes                               |
| Open sheets, toasts, provisional stream  | route/components                | No, by design                  | No                                |

## Storage keys (verified)

| Key                                  | Content                                                       | Notes                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `lingua.prefs.v1`                    | source, target, style, dialect, brain, shadow                 | validated by `parsePrefs`; `source !== target`                                                                                         |
| `lingua.session.v1`                  | text, result, source, target, style + web-only `at`, `origin` | validated by `parseSession` (extras ignored, legacy bare sessions still read); `at` drives stale-write refusal; damaged result dropped |
| `lingua.theme.v1`                    | theme name                                                    | validated centrally; legacy names migrated                                                                                             |
| `lingua.ui-locale`                   | `en` / `de` / `ar`                                            | validated; direction applied before paint                                                                                              |
| `lingua.history.v1`                  | translation archive                                           | validated entries; drives statistics                                                                                                   |
| `lingua.saved.v1`                    | saved phrases                                                 | validated phrase objects                                                                                                               |
| `lingua.memory.v1`                   | settled translation memory                                    | bounded rows/bytes, TTL, validated on read                                                                                             |
| `lingua.stats.v1`                    | statistics-related local state                                | see `lib/stats`                                                                                                                        |
| `lingua.recent-langs`                | last five languages picked                                    | validated two-letter codes, de-duplicated                                                                                              |
| `lingua.language-favorites.v1`       | pinned languages in the picker                                | validated two-letter codes, at most eight                                                                                              |
| `lingua.voice.v1`, `lingua.voice.v2` | voice preferences                                             | versioned migration preserves device choice                                                                                            |
| `lingua.feel.v1`                     | haptics/sound preferences                                     | read at call time                                                                                                                      |
| `lingua.intro.seen.v1`               | first-run gate                                                | pre-paint decision                                                                                                                     |
| `lingua.install.dismissed`           | install offer                                                 | UI preference                                                                                                                          |

All reads pass a validator that mirrors the server's language/style constraints. Invalid JSON,
foreign values and stale shapes are dropped, never sent to the server or rendered.

## Remembered values (why a remount is not empty)

`persist.ts` keeps `rememberedPrefs` and `rememberedSession` in module memory for the lifetime of the
tab. `persist.remembered()` returns a **stable snapshot** (`useSyncExternalStore`-friendly);
`persist.subscribe(fn)` publishes prefs/session changes from this tab and from other tabs. The
translator uses the values as **initial state only**:

- on a cold document load they are empty, so server HTML and hydration agree;
- after a route change they hold the last values, so the returning screen paints the draft and the
  translated sentence immediately;
- storage remains the cross-reload and cross-tab source of truth. A `storage` event re-reads only
  the changed key and notifies subscribers — no reload and no polling. This module never calls
  React state setters; wiring a view is the consumer's job.

`savePrefs` / `saveSession` update both memory and storage; `clearAll()` clears both, removes every
`lingua.*` key and resets the session recency epoch.

## Write timing

- Preferences are written after the boot restore completes and whenever a choice changes.
- The session is written on a 400 ms debounce after text/result/pair changes, and flushed on
  `visibilitychange` (hidden) and `pagehide`, so the last keystrokes are not lost to the debounce.
- A provisional result is stored as `null` in the session; provisional text is never treated as a
  permanent translation.
- **Session recency (TD14):** each web write records `at` (epoch ms) and a per-tab `origin`. A tab
  that has seen a newer `at` must refuse its own whole-session write (`refused-stale`), so closing
  an old/empty tab cannot erase a draft written since in another tab. The first boot read counts as
  an observation; `clearAll()` starts a fresh epoch. An empty draft is written as an **empty
  record** with a newer `at`, never as a key deletion (a deletion would let an old tab resurrect
  its draft on the next boot).
- Device translation memory stores only settled, verified results.

## Restore

`restorePlan(session, prefs)` (pure) decides what a returning screen shows:

- text, source, target and style come from the **session**;
- dialect and brain come from preferences (the brain passes through `effectiveBrain`);
- a strong script mismatch sets only `requestSource = "auto"`, not the visible pair;
- the session's cached result is returned for priming and for `useTranslator`'s `restored` seed,
  but only when it passes the full result validator (`translation/result.ts`) and its
  `targetLanguage` matches the session's target; an incomplete result, or one written for another
  target, is dropped rather than shown under the wrong pair;
- the request's target, not the model's `targetLanguage` echo, is authoritative for that check.

This prevents the primed cache key and the visible pair from drifting, which previously caused the
draft to return without its translation and a second paid request. See ADR 0002.

## Device memory and archive

- Memory is bounded twice (rows and bytes), has a TTL, and is validated on read. Only settled
  results are stored; a provisional stream never went through verification. Another tab's
  `storage` event (including a clear) drops this tab's in-memory copy.
- History is a lightweight archive, not a chat log. Statistics are computed from it; there is no
  second stats store to drift.
- Saved phrases are explicit user actions, not an automatic archive.
- Nothing in this section is uploaded. The translation provider receives the text needed to produce
  the translation; it does not receive the archive, theme, locale or saved phrases.

## Clearing data

The privacy page exposes the local-data controls implemented by the app. `clearDeviceData()` is the
single removal path: it resets the phrasebook, history and translation-memory caches, then removes
every `lingua.*` value through `persist.clearAll()`. A new store must join it and its test; removing
storage keys alone leaves module caches alive and a cleared translation can still answer from RAM.

## Known limits

- Storage can be blocked or full; writes report failure and the app continues without persistence.
  The privacy page now shows archive/saved counts, `navigator.storage.estimate()` usage/quota,
  persisted status and last-write/trim warnings, with a "make storage durable" action.
- Session recency protects **stale** tabs. Two up-to-date tabs still resolve by last-write-wins:
  the later empty draft intentionally claims the newer state.
- The remembered copy is now cross-tab synced for prefs/session through `storage` events and
  `persist.subscribe`; history/saved/memory already had their own storage listeners.
- `requestDurable()` is best-effort; the browser may decline persistent storage. A decline shows a
  calm note and does not affect saving.
- Native Android reads/writes keep their own adapter rules; the web envelope does not cross the
  bridge, and the recency rule is web-only by design.

## Android adapter

The installed app uses the same store APIs through `PersistencePort`. The web adapter keeps the
keys above and their validators; the native adapter replaces only the transport:

| Concern                                                    | Web                       | Android                                                |
| ---------------------------------------------------------- | ------------------------- | ------------------------------------------------------ |
| Records (archive, saved, memory, session, import metadata) | `localStorage` keys above | Room `lingua.db` v2                                    |
| Settings map (`lingua.prefs.v1` and the individual keys)   | `localStorage`            | one Preferences DataStore JSON map                     |
| Read timing                                                | synchronous               | synchronous cache, hydrated from the bridge at boot    |
| Write timing                                               | synchronous               | queued async bridge call; failure reported, cache kept |
| Backup                                                     | file download/upload      | Storage Access Framework                               |

Boot order (root gate) is: inline palette/dir script → bridge `boot` → caches → appearance →
splash hidden → React render. A failed boot renders in-memory defaults and reports storage as
unavailable; it never blocks translation. Details and migration rules live in
`docs/android/persistence-and-migrations.md`.
