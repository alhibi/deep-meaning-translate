# Android architecture

Status: **Implemented and built** on 2026-11-16. On-device runtime behaviour is
**NOT_VERIFIED** in this environment (no device or emulator was available); everything the
build can prove is recorded in `build-and-release.md`.

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

| Layer | Files | Responsibility |
| --- | --- | --- |
| UI | `src/routes/*`, `src/components/*` | The translator as designed; no Android-specific rendering |
| Application | `src/lib/history.ts`, `saved.ts`, `translation/memory.ts`, `persist.ts` | Merge rules, bounds, validation, store caches |
| Port | `src/lib/persistence/port.ts`, `native.ts`, `web.ts` | Chooses the adapter once, at boot |
| Bridge (JS side) | `src/lib/native/plugin.ts`, `rpc.ts` | Registered Capacitor plugins, typed calls, JSON DTOs |
| Bridge (native) | `android/.../bridge/LinguaStorePlugin.kt` | One method per port operation; IO dispatcher only |
| Data | `android/.../data/*.kt` | Room entities/DAOs, repository transactions, DataStore, mapping |
| Transport | `src/lib/native/transport.ts`, `stream.ts`, `voice/cloud.ts` | Absolute native URLs, error classification |
| Server | `src/routes/api/native/v1/*`, `gate.server.ts`, `handlers.server.ts` | Origin allowlist, CORS, the same engine and prompts |

The Kotlin layer never contains a prompt, a provider name, a model name or a translation
rule. Those stay in `src/lib/translation/` and on the server, exactly as the constitution
requires.

## Boot sequence

```text
Android splash (launchAutoHide: false)
  └─ WebView loads packaged index.html (no network)
       └─ inline boot script paints saved palette + dir/lang before first frame
            └─ hydratePlatform(): boot bridge → settings/draft/archive caches
                 ├─ applyStoredAppearance()
                 ├─ status-bar icon style follows the palette
                 ├─ SplashScreen.hide()   ← only now is the first frame correct
                 └─ React renders the translator with the restored state
```

`src/routes/__root.tsx` holds rendering behind the platform gate, but the gate is bounded:
`hydratePlatform()` races the bridge against a 3-second timeout and always marks the app
ready, and the root route hides the native splash after React commits the first frame —
including the degraded path. A failed or silent bridge therefore cannot leave a black
screen; the translator opens with in-memory defaults and Data settings states that storage
is unavailable. As a last native ceiling, `capacitor.config.ts` auto-hides the splash after
6 seconds even if JavaScript never runs, and an inline boot guard replaces a blank body with a localized retry message after 9 seconds.

## One source of truth

- Native: Room is the record store. `localStorage` is not used for records and is never
  written in parallel. The web adapter is not imported at runtime, only type-shared.
- Web: `localStorage` keeps the same keys as before; the native adapter is never loaded.
- Settings: DataStore holds one JSON map keyed by the same `lingua.*` names. The app reads
  a snapshot synchronously (hydrated at boot) and queues writes; it does not maintain a
  second authoritative copy in the WebView.

## Back navigation

The Android back button is handled in `src/routes/index.tsx`:

```text
open overlay/sheet → close it
keyboard visible   → dismiss it (Capacitor Keyboard)
history available  → previous destination
otherwise          → App.exitApp()
```

`android:enableOnBackInvokedCallback="false"` keeps the predictive-back gesture routed to
the same handler on Android 13+, so the order is identical on every API level.

## Failure philosophy

| Failure | Behaviour |
| --- | --- |
| Room cannot open (corrupt, disk full) | App still runs; writes report failure; Data settings says storage is unavailable |
| Bridge does not answer within 3 s | Boot times out, the app opens with in-memory defaults, and the splash is still hidden after React commits |
| Import is malformed or fails mid-write | Transaction rolls back; the previous archive is intact |
| No network | Translation and cloud voice show the existing calm error; local history, phrasebook and backups keep working |
| WebView has no speech synthesis | `LinguaTts` reads the translation with the Android engine (no word timings) |

## Related

- [Persistence and migrations](persistence-and-migrations.md)
- [Data import and export](data-import-export.md)
- [Network and security](network-and-security.md)
- [Device compatibility](device-compatibility.md)
- [Build and release](build-and-release.md)
