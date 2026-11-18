# Project Audit — Phase 02 (Android)

Audited: 2026-11-18, local clone at `deep-meaning-translate/`, commit `3cf511e` (branch `main`,
working tree clean). This audit is read-only: no project setting was changed.

## What kind of project this is

A production PWA (TanStack Start / React 19) wrapped in a **Capacitor 8 WebView shell**. The
translator UI is compiled into the APK (`android/app/src/main/assets/public`, ~6.8 MB after
`cap sync`), served from `https://localhost` inside the WebView, and never loaded from the
network. Kotlin owns what the WebView cannot do durably: Room database, DataStore settings, SAF
backups, TTS, system-bar colour, and the Android back pipeline.

- Web app: `src/` (359 TS/TSX files, 69,931 lines, 140 test files)
- Native shell: 13 Kotlin files under `android/app/src/main/java/today/fluently/app/`
- Native unit tests: 4 files (`BackupReaderTest`, `UtteranceTrackerTest`, `MigrationTest`,
  `RepositoryTest`); instrumented bridge/storage tests under `android/app/src/androidTest/`

## Identity and build toolchain

| Property | Value | Source |
| --- | --- | --- |
| Application ID | `today.fluently.app` (debug: `today.fluently.app.debug`) | `android/app/build.gradle.kts` |
| Version | `1.0.8` (versionCode 9) | same |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36 | `android/variables.gradle` |
| AGP | 8.13.0 | `android/build.gradle.kts` |
| Gradle wrapper | 8.14.3 | `gradle-wrapper.properties` |
| Kotlin / KSP | 2.1.21 / 2.1.21-2.0.1 | `app/build.gradle.kts` |
| JDK | 21 (source/target 21) | same |
| ABIs | arm64-v8a, armeabi-v7a, x86, x86_64 — universal APK, no native translator code | docs/android/device-compatibility.md |
| Locales | `en`, `ar`, `de` (`resourceConfigurations`) | `app/build.gradle.kts` |
| Capacitor | 8.6.2 core/android; plugins: app, clipboard, haptics, keyboard, splash-screen, status-bar | `package.json`, `capacitor.plugins.json` |
| JS build for the shell | `npm run build:native:web` (`vite.native.config.ts`) + `npx cap sync android` | `package.json` |

## Manifest and component model

- **One activity**: `.MainActivity` (`BridgeActivity`), `exported=true`, only `MAIN`/`LAUNCHER`
  intent filter. No deep links, no custom schemes, no file providers, no services, no receivers.
- `launchMode="singleTask"`, `screenOrientation="portrait"`, `windowSoftInputMode="adjustResize"`.
- `configChanges` covers orientation/keyboard/screenSize/smallestScreenSize/screenLayout/uiMode/
  navigation/density/locale — the WebView survives those changes.
- `allowBackup="false"`, `fullBackupContent="false"`, and `data_extraction_rules` exclude
  database/sharedpref/files from cloud backup and device transfer (the archive is personal).
- `usesCleartextTraffic="false"` + `network_security_config` with system trust anchors only.
- `enableOnBackInvokedCallback="false"` — legacy back dispatch used deliberately.
- `supportsRtl="true"`; `applicationIdSuffix` only for debug.

## Permissions

| Permission | Type | Needed by |
| --- | --- | --- |
| `INTERNET` | normal | translation, voice, dictation tokens |
| `ACCESS_COARSE_LOCATION` | runtime (dangerous) | weather strip — **switched off in this release** (`SHOW_WEATHER=false`), so it should never be requested in normal use |
| `RECORD_AUDIO` | runtime (dangerous) | dictation (AssemblyAI streaming) |
| `MODIFY_AUDIO_SETTINGS` | normal | Capacitor WebView audio-capture gate |

`uses-feature android.hardware.microphone required="false"` keeps the app installable without a
mic. No storage permission: backups use the Storage Access Framework.

## Native bridge (the part Gradle cannot prove)

| Plugin | Responsibility | Contract |
| --- | --- | --- |
| `LinguaStore` | Room (`lingua.db`) + Preferences DataStore; JSON-string DTOs; lazy DB open on IO; one Mutex serialising whole-document writes; irreversible teardown | short error codes ("storage-init"), never text |
| `LinguaFiles` | SAF export (`ACTION_CREATE_DOCUMENT`) / import (`ACTION_OPEN_DOCUMENT`); one bounded UTF-8 decode via `BackupReader` (multi-byte split guard) | calm rejects; source file never deleted |
| `LinguaTts` | Android TTS fallback; one utterance tracker, stop reported once, engine released with the bridge | late events dropped after destroy |
| `LinguaChrome` | status/navigation strip painted from the web theme colour (`#rrggbb` validated); repaint after splash; cancelled on destroy | never hard-codes a theme colour |

## Network

- The APK does not fetch its UI. `nativeApiBase()` resolves `VITE_NATIVE_API_BASE` or
  `https://fluently.today`, HTTPS-only, no path/query/hash.
- Endpoints: `/api/native/v1/{translate-stream, repair, lexicon, shadow, speak, eleven-speak,
  dictation-token, weather, weather/place}`.
- Server gate: exact origin allowlist `https://localhost`, `capacitor://localhost`;
  `http://localhost` only when `NODE_ENV` is explicitly development/test. Preflight → 204 without
  touching provider budget; wrong origin → 403.
- **Live check from the Mac (2026-11-18):** `OPTIONS /api/native/v1/translate-stream` with
  `Origin: https://localhost` → **204** with CORS headers; `Origin: https://evil.example` →
  **403**; `GET /api/native/v1/shadow` → 200. The native gate is live in production.
- Every request shares the web route's body limits, Zod schemas, admission buckets and no-store
  headers. Errors never leak provider text or keys.

## Storage model

| Store | What | Where |
| --- | --- | --- |
| `lingua.db` (Room) | history archive, phrasebook, translation memory, session state, import metadata | app-private |
| Preferences DataStore | prefs, theme, locale, intro gate, voice settings | app-private |
| Backup | user-exported JSON envelope (digest-verified) through SAF | user-chosen file |

Nothing goes to Android backup; "forget everything" clears caches before storage keys.

## Release configuration and build differences

- **Debug**: package `.debug`, `versionNameSuffix "-debug"`, WebView remote debugging enabled.
- **Release**: R8 `isMinifyEnabled=true` + `isShrinkResources=true`; ProGuard keeps the Capacitor
  reflection surface (`com.getcapacitor.**`, plugin classes, `@PluginMethod`, `org.json.**`), all
  app classes, and `-dontwarn org.robolectric.**`; Room/DataStore ship consumer rules.
- **Signing is fail-closed**: release refuses to package without `ANDROID_KEYSTORE_PATH` + the
  three credentials; `-PallowDebugSigning=true` is the explicit non-publishable review path
  (TD18 — no upload keystore exists here).
- The web shell receives its own CSP from `scripts/prepare-native-web.mjs`; it does not depend on
  the hosting platform's `_headers`.

## Lifecycle and UX architecture

- Splash is hidden by the web layer after theme/locale/draft/archive restore, not by a timer.
- Back is one cancelable `lingua:back` event owned by `dispatchBack()`: sheets close first, the
  keyboard before navigation, `/stats` returns to the translator, only the root exits.
- Session is an envelope with cross-tab recency; native store hydrates before writes open.
- Weather/culture surfaces are compiled but switched off (`src/lib/features.ts`).

## Risks the real-device pass must target

1. **R8 release build vs debug** — reflection/plugin wiring is the classic regression site; test
   the release-review APK, not only debug.
2. **Device network to `https://fluently.today`** — CORS is verified, provider keys are not; a
   translation on the device is the only proof.
3. **WebView version on the device** — the shell targets modern Chromium; MagicOS WebView may lag.
4. **Honor/MagicOS power management** — aggressive background killing can break draft restore.
5. **Arabic TTS availability** — known TD23: silent failure on images without an Arabic voice.
6. **Dictation** — needs a real microphone (emulator could not record); this phone can.
7. **Portrait lock and edge-to-edge** — max-width canvas, system bars, cutout, keyboard insets.
8. **No upload keystore** — any release APK here is debug-signed and must be labelled as a
   non-publishable review build.

## Gate verdict

Project audit: **PASS** (read-only; every claim traced to a file above). Installation/testing gates
remain **BLOCKED/NOT TESTED** until ADB reaches the phone (see `reports/device-fingerprint.md`).

## Built-artefact verification (added after the build)

The merged manifest of the built release APK was inspected with `aapt dump permissions` and
`apkanalyzer`: the source manifest's 4 permissions become **6** in the artefact —
`android.permission.VIBRATE` (from `@capacitor/haptics`) and
`today.fluently.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (from AndroidX core). Both are
normal, non-dangerous permissions; the difference is recorded rather than hidden.

Also verified on the artefact: R8 kept all four bridge plugins (`LinguaStorePlugin`,
`LinguaFilesPlugin`, `LinguaTtsPlugin`, `LinguaChromePlugin`) and 725 app classes; the bundled web
shell is byte-identical to `android-web/` (79 files, plus two empty Capacitor cordova shims); the
boot HTML is the native cover (`data-boot-cover="native"`) with its CSP injected; no provider key
or secret literal is embedded. Evidence: `logs/apk-static-verification.txt`.
