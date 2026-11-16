# Android architecture

Status: **Implemented, built and partly device-verified** on 2026-11-16 on emulator-5554
(API 35, WebView 124). Install, cold/warm start, force-stop restore, theme/locale restore,
keyboard, back order, statistics, SAF export/import and permission denial were executed; low-API,
OEM-keyboard, foldable and physical-device behaviour remain **NOT_VERIFIED** (TD17). The exact
runs and their limits are in `docs/audits/android-team/07-qa-release.md` and
`docs/audits/technical-debt.md`.

## Shape

One product, two shells:

```text
Browser / Cloudflare / PWA                    Installed Android app
──────────────────────────                    ─────────────────────
TanStack Start document                       WebView: the same SPA
  ↕ localStorage (single source)                ↕ PersistencePort → LinguaStore bridge
Worker routes /api/*, same-origin               ↕ Room (records) + DataStore (settings)
                                              Network: /api/native/v1/* on the Worker
```

The UI, the translation logic, the prompts, the themes, the fonts, the RTL rules and the
one-screen composition are shared verbatim. Android adds a package, a storage adapter and
a network adapter; it does not fork the product.

Why a hybrid shell rather than a Compose rewrite: see
[ADR 0005](../architecture/decisions/0005-capacitor-hybrid-shell.md). The decision is
reversible at the boundary — `PersistencePort` and the native transport are the only two
contracts the Kotlin layer implements.

## Layers

| Layer            | Files                                                                   | Responsibility                                                  |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| UI               | `src/routes/*`, `src/components/*`                                      | The translator as designed; no Android-specific rendering       |
| Application      | `src/lib/history.ts`, `saved.ts`, `translation/memory.ts`, `persist.ts` | Merge rules, bounds, validation, store caches                   |
| Port             | `src/lib/persistence/port.ts`, `native.ts`, `web.ts`                    | Chooses the adapter once, at boot                               |
| Bridge (JS side) | `src/lib/native/plugin.ts`, `rpc.ts`                                    | Registered Capacitor plugins, typed calls, JSON DTOs            |
| Bridge (native)  | `android/.../bridge/LinguaStorePlugin.kt`                               | One method per port operation; IO dispatcher only               |
| Data             | `android/.../data/*.kt`                                                 | Room entities/DAOs, repository transactions, DataStore, mapping |
| Transport        | `src/lib/native/transport.ts`, `stream.ts`, `voice/cloud.ts`            | Absolute native URLs, error classification                      |
| Server           | `src/routes/api/native/v1/*`, `gate.server.ts`, `handlers.server.ts`    | Origin allowlist, CORS, the same engine and prompts             |

The Kotlin layer never contains a prompt, a provider name, a model name or a translation
rule. Those stay in `src/lib/translation/` and on the server, exactly as the constitution
requires.

## Boot sequence

```text
Android splash (JS hides it; 6 s native ceiling only)
  └─ WebView loads packaged index.html (no network; CSP meta in the shell)
       └─ the native build prerenders the boot cover, matching the client's first render
            └─ hydratePlatform(): boot bridge → settings/draft/archive caches
                 ├─ applyStoredAppearance() (theme, locale, intro gate from DataStore)
                 ├─ hydratePersist/History/Saved/Memory
                 ├─ native writes become allowed only after this complete snapshot
                 ├─ React renders the translator with the restored state
                 ├─ SplashScreen.hide()
                 └─ system bars + window strip colours are applied/reapplied
```

The native build defines `VITE_NATIVE_SHELL`, so the prerendered HTML is the boot cover rather
than the translator. Before that, the server HTML and the client's first render disagreed and
React threw hydration error #418 on every cold start, discarding the prerender.

`src/routes/__root.tsx` holds rendering behind the platform gate, but the gate is bounded:
`hydratePlatform()` races the bridge against a 3-second timeout and always marks the app
ready, and the root route hides the native splash after React commits the first frame —
including the degraded path. A failed or silent bridge therefore cannot leave a black
screen; the translator opens with in-memory defaults and Data settings states that storage
is unavailable. As a last native ceiling, `capacitor.config.ts` auto-hides the splash after
6 seconds even if JavaScript never runs, and an inline boot guard replaces a blank body with a localized retry message after 9 seconds.

On Android 10 (API 29) with WebView 140+, Capacitor 8.6.2's `SystemBars` added the IME
inset as padding even though `adjustResize` had already resized the window. Opening the
keyboard therefore shrank the WebView twice and could blank the whole page, leaving the
composer invisible. `patches/@capacitor+android+8.6.2.patch` (applied by the `postinstall`
script) only adds that padding on API 30+, where `ime()` is the real overlap.

## One source of truth

- Native: Room is the record store. `localStorage` is not used for records and is never
  written in parallel. The web adapter module is imported for its shared storage helpers, but
  every native path guards on `isNativeApp()` and never enters it.
- Web: `localStorage` keeps the same keys as before; the native adapter is never loaded.
- Settings: DataStore holds one string preference per `lingua.*` key (not one JSON map). The
  app reads a snapshot synchronously (hydrated at boot) and queues writes; it does not maintain
  a second authoritative copy in the WebView. Writes are refused until the boot snapshot has
  been applied, so a timed-out bridge cannot rewrite a table from an empty cache.

## Back navigation

The native shell dispatches one cancelable `lingua:back` event and `dispatchBack()` decides when
nobody claimed it:

```text
an overlay that registered useAndroidBack (language/model/voice) → close it, cancel
keyboard visible                    → blur the field, cancel the event
non-root route (/stats, /privacy)   → history.back()
root translator                     → App.exitApp()
```

Overlays own their local state, so the event is the meeting point: the old route-only handler ran
before a freshly mounted sheet's listener and quit the app while closing the sheet. On-device this
was verified both ways (sheet closes and the app stays; next back exits; `/stats` back returns to
the translator with the draft intact).

`android:enableOnBackInvokedCallback="false"` keeps the predictive-back gesture routed to
the same handler on Android 13+, so the order is identical on every API level.

## Failure philosophy

| Failure                                | Behaviour                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Room cannot open (corrupt, disk full)  | App still runs; native reads/writes fail closed; Data settings says storage is unavailable. There is no in-app reset yet (TD26). |
| Bridge does not answer within 3 s      | Boot times out, the app opens with in-memory defaults, and the splash is still hidden after React commits                        |
| Import is malformed or fails mid-write | Transaction rolls back; the previous archive is intact                                                                           |
| No network                             | Translation and cloud voice show the existing calm error; local history, phrasebook and backups keep working                     |
| WebView has no speech synthesis        | `LinguaTts` reads the translation with the Android engine (no word timings)                                                      |

## Related

- [Persistence and migrations](persistence-and-migrations.md)
- [Data import and export](data-import-export.md)
- [Network and security](network-and-security.md)
- [Device compatibility](device-compatibility.md)
- [Build and release](build-and-release.md)
