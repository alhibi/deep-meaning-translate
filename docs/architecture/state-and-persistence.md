# State and Persistence

Status: **Verified** against source on 2026-11-07. Keys below were read from the implementation, not
invented.

## Ownership

| Concern | Owner | Survives route change | Survives reload |
| --- | --- | --- | --- |
| Draft, pair, style, dialect, brain | `src/routes/index.tsx` | Yes (remembered session/prefs) | Yes (validated storage) |
| Translation phase/result/in-flight cache | `lib/translation/useTranslator` | Yes, via primed session result | Settled results via device memory |
| Theme | `lib/theme` store | Yes (root shell) | Yes (boot script) |
| Interface locale / direction | `lib/i18n` store | Yes (root shell) | Yes (boot script) |
| History and saved phrases | `lib/history`, `lib/saved` | Yes | Yes |
| Statistics | derived from history | Yes | Yes |
| Open sheets, toasts, provisional stream | route/components | No, by design | No |

## Storage keys (verified)

| Key | Content | Notes |
| --- | --- | --- |
| `lingua.prefs.v1` | source, target, style, dialect, brain, shadow | validated by `parsePrefs`; `source !== target` |
| `lingua.session.v1` | text, result, source, target, style | validated by `parseSession`; damaged result dropped |
| `lingua.theme.v1` | theme name | validated centrally; legacy names migrated |
| `lingua.ui-locale` | `en` / `de` / `ar` | validated; direction applied before paint |
| `lingua.history.v1` | translation archive | validated entries; drives statistics |
| `lingua.saved.v1` | saved phrases | validated phrase objects |
| `lingua.memory.v1` | settled translation memory | bounded rows/bytes, TTL, validated on read |
| `lingua.stats.v1` | statistics-related local state | see `lib/stats` |
| `lingua.voice.v1`, `lingua.voice.v2` | voice preferences | versioned migration preserves device choice |
| `lingua.feel.v1` | haptics/sound preferences | read at call time |
| `lingua.intro.seen.v1` | first-run gate | pre-paint decision |
| `lingua.install.dismissed` | install offer | UI preference |

All reads pass a validator that mirrors the server's language/style constraints. Invalid JSON,
foreign values and stale shapes are dropped, never sent to the server or rendered.

## Remembered values (why a remount is not empty)

`persist.ts` keeps `rememberedPrefs` and `rememberedSession` in module memory for the lifetime of the
tab. `persist.remembered()` returns them; the translator uses them as **initial state only**:

- on a cold document load they are empty, so server HTML and hydration agree;
- after a route change they hold the last values, so the returning screen paints the draft and the
  translated sentence immediately;
- storage remains the cross-reload and cross-tab source of truth.

`savePrefs` / `saveSession` update both memory and storage; `clearAll()` clears both and removes
every `lingua.*` key.

## Write timing

- Preferences are written after the boot restore completes and whenever a choice changes.
- The session is written on a 400 ms debounce after text/result/pair changes, and flushed on
  `visibilitychange` (hidden) and `pagehide`, so the last keystrokes are not lost to the debounce.
- A provisional result is stored as `null` in the session; provisional text is never treated as a
  permanent translation.
- Device translation memory stores only settled, verified results.

## Restore

`restorePlan(session, prefs)` (pure) decides what a returning screen shows:

- text, source, target and style come from the **session**;
- dialect and brain come from preferences (the brain passes through `effectiveBrain`);
- a strong script mismatch sets only `requestSource = "auto"`, not the visible pair;
- the session's cached result is returned for priming and for `useTranslator`'s `restored` seed.

This prevents the primed cache key and the visible pair from drifting, which previously caused the
draft to return without its translation and a second paid request. See ADR 0002.

## Device memory and archive

- Memory is bounded twice (rows and bytes), has a TTL, and is validated on read. Only settled
  results are stored; a provisional stream never went through verification.
- History is a lightweight archive, not a chat log. Statistics are computed from it; there is no
  second stats store to drift.
- Saved phrases are explicit user actions, not an automatic archive.
- Nothing in this section is uploaded. The translation provider receives the text needed to produce
  the translation; it does not receive the archive, theme, locale or saved phrases.

## Clearing data

The privacy page exposes the local-data controls implemented by the app. `persist.clearAll()` is the
single removal path for `lingua.*` values; a new store must join it, or it will survive "clear all".

## Known limits

- Storage can be blocked or full; writes return `false` and the app continues without persistence.
- The remembered copy is per-tab and is not a cross-tab sync mechanism.
- `requestDurable()` is best-effort; the browser may decline persistent storage.
