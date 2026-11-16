# Android Implementation Report — 1.0.3

Date: 2026-11-16 · Base commit: `c897209` · Final commit: `c5e70e2` on `main` (local; **not
pushed** — the connected Lovable branch is left in a working state for the owner to review/push).

No capability was removed to make the APK build. The one-screen meaning-first translator, prompts,
verification, repair, memory, history, saved phrases, statistics, shadow, voice and privacy controls
stay where they were; the work is completing the Android shell, the data guarantees and the release
path around them.

## 1. Startup, lifecycle and system integration

- `vite.native.config.ts`: defines `VITE_NATIVE_SHELL` and `VITE_APP_VERSION`; native build still
  emits a client-only SPA with no Worker/service worker. A meta CSP is injected by
  `scripts/prepare-native-web.mjs`.
- `src/routes/__root.tsx`: the native prerender is now the boot cover, matching the client's first
  render; fixes React #418 and keeps the splash-to-first-frame sequence.
- `src/lib/platform.ts`: applies the stored theme/locale/intro after a **successful** hydrate;
  enables native writes only after a complete snapshot; dispatches one cancelable `lingua:back`;
  re-reads the device snapshot after import (`rehydrateDeviceData`); syncs both system bars and
  repaints the native window strip after the splash theme; flushes settings on background.
- `android/.../MainActivity.kt`: registers the new `LinguaChrome` plugin, re-applies the canvas
  window colour on resume, portrait lock for the one-screen composition.
- `android/.../bridge/LinguaChromePlugin.kt` (new): validates a `#rrggbb` colour and paints the
  Activity window background (the strip behind system bars), with a delayed re-apply after the
  Android 12 splash theme.
- `src/routes/index.tsx`: native Keyboard listeners drive the keyboard stage; back handler claims
  only its own overlays/keyboard and no longer exits directly; voice/dictation stop on
  `lingua:flush`; requires `cancelSpeech` as a stable dependency.
- `src/lib/useAndroidBack.ts` (new) + wired in `LanguageSheet` and `VoiceSheet`: an open overlay
  cancels the back event before the root decision runs.
- `android/app/src/main/AndroidManifest.xml`: adds `MODIFY_AUDIO_SETTINGS` (dictation), removes the
  unused over-broad `FileProvider`, portrait lock, keeps `allowBackup=false`, cleartext off and the
  minimal permission set.

## 2. Persistence and data integrity

- `src/lib/native/plugin.ts`: `asNonThenable()` for every Capacitor plugin proxy; typed DTOs now
  include `sessionSeq` and import provenance/report. This is the fix for the shipped 1.0.2 failure.
- `src/lib/persistence/native.ts`: boot is the only read allowed before hydration; every other
  operation fails closed; session seq seeded from the stored row; TS-computed import report returned
  to the UI while provenance is sent to Kotlin.
- `src/lib/persistence/settings.ts`: per-key DataStore view, queued writes refused until the boot
  snapshot is applied; cache reset on "forget everything" without leaving writes disabled.
- `src/lib/persistence/{port,web}.ts`: import provenance is part of the port contract (web ignores
  it); no second store was added.
- `src/lib/platform.ts` + `src/components/DataControls.tsx`: after an import the archive,
  phrasebook, memory, session and settings are re-read; a failed reload is surfaced, not hidden.
- `src/lib/saved.ts`, `src/lib/translation/memory.ts`: explicit cache-reset APIs for that reload.
- `src/lib/clearData.ts`, `src/routes/stats.tsx`: "forget everything" awaits the clear, resets the
  feel/voice caches, and the screen only reports completion after it settles.
- `android/.../bridge/LinguaStorePlugin.kt`: one `Mutex` serialises every bridge operation; Long
  decoding for `seq`/`recentSince`; passes import provenance.
- `android/.../data/LinguaRepository.kt`: `sessionSeq` in the boot payload; rejects seq≤0; import
  rollback runs under `NonCancellable`; `clearAll` also clears `import_meta`; import log stores the
  TS counts, real file name and digest.
- `android/.../data/SettingsStore.kt`, `Daos.kt`: unchanged per-key storage; import log gets a clear
  operation.
- `android/.../bridge/BackupReader.kt` (new): one bounded UTF-8 decode for a picked backup, with a
  JVM test that splits every character boundary.
- `src/lib/native/tts.ts`: `asNonThenable` + guarded engine call, so a missing engine reaches
  `onFail` instead of an unhandled rejection.

## 3. Security, privacy and release

- Native request bodies on `repair`/`lexicon`/`shadow` are bounded before schema and admission
  (`src/lib/native/handlers.server.ts`); tests prove oversized input returns 400 without provider
  work.
- `src/lib/native/gate.server.ts`: the browser-only `http://localhost` origin is enabled only when
  `NODE_ENV` is explicitly development/test; `gate.server.test.ts` covers exact allowlist,
  look-alike origins, preflight, wildcard absence and generic 502.
- `scripts/prepare-native-web.mjs`: meta CSP for the packaged shell (self, inline boot scripts,
  fluently.today, AssemblyAI WebSocket, blob AudioWorklet) and a build-time assertion.
- `src/routes/privacy.tsx` + `src/components/DataControls.tsx`: storage/erase/voice/auth copy is
  platform-correct; backup integrity wording says "damaged", not "tampered".
- `android/app/build.gradle.kts`: release signing fails closed; `-PallowDebugSigning=true` is the
  warned, non-publishable review opt-out; logs the chosen keystore.
- `android/gradle.properties`: pins Gradle + Kotlin-daemon JVM locale to English for reproducible
  Room/KSP output.
- `.github/workflows/ci.yml`: adds an Android job (SDK/platform setup, Room tests, debug APK,
  signature/badging/permissions, debug-flag and secret assertions). Authored, not yet executed on
  GitHub (TD24).
- `docs/architecture/decisions/0008-android-data-at-rest.md`: explicit TD19 decision (no SQLCipher
  in 1.0.3; OS FBE + sandbox + explicit encrypted backups; revisit conditions).
- Docs updated to match reality: `AGENTS.md` (Android hard rules), `DOCUMENTATION_INDEX.md`,
  `docs/android/{architecture,persistence-and-migrations,data-import-export,network-and-security,
device-compatibility,build-and-release}.md`, `docs/quality/testing.md`,
  `docs/audits/technical-debt.md` (TD17/18 updated, TD19/20 closed, TD21–TD29 added, 24 closures
  recorded).

## 4. Tests added or strengthened

- `src/lib/native/plugin.test.ts` — thenable assimilation regression (2).
- `src/lib/native/gate.server.test.ts` — origin/preflight/error confidentiality (10).
- `src/lib/native/handlers.server.test.ts` — oversized bodies bounded, zero admission (3, node env).
- `src/lib/useAndroidBack.test.ts` — cancel/claim/unmount (3).
- `android/app/src/test/.../MigrationTest.kt` — history+saved+session survive, production `open()`,
  missing migration fails without deleting rows (3 total).
- `android/app/src/test/.../BackupReaderTest.kt` — multi-byte/every-split decoding + cap (3).
- `android/app/src/test/.../RepositoryTest.kt` — import provenance/digest/counts now asserted
  (7 total, existing cases kept).
- `android/app/src/androidTest/.../BridgeInstrumentedTest.kt` (new) — packaged shell origin/title,
  storage round trip, namespace refusal, session draft + stale-write guard (3); placeholders that
  asserted the wrong package id were deleted.
- Device-level evidence is recorded in `ANDROID_TEST_EVIDENCE.md`.
- An independent A8 review (`docs/audits/android-team/08-final-review.md`) re-checked the final
  diff; its P1 late-hydrate race and P2 signing-guard placement/docs findings were fixed before
  the final commit (late-hydrate regression test, guard attached to `packageRelease`, doc
  corrections).

## 5. Versioning

- `package.json` 1.0.2 → **1.0.3**; `android/app/build.gradle.kts` `versionCode` 3 → **4**,
  `versionName` 1.0.2 → **1.0.3**. Debug suffix remains `.debug` / `-debug` so both can coexist.
- Backups now report the build that wrote them (`VITE_APP_VERSION`).

## 5b. 1.0.4 — translation-freeze hotfix

- `src/lib/translation/echo.ts` (new): `isEcho`, `languagePartner` and
  `shouldHoldForReroute`; the route now holds the canvas only for a settled result that
  detected the target language. Regression tests cover the “Hallo / Deutsch / auto” freeze.
- `src/routes/index.tsx`: uses the helper; when a settled result is an echo, tries the
  Arabic/German partner once; echoes are not archived.
- `src/lib/native/transport.ts`: `AbortSignal.timeout` fallback for older WebViews (an
  older WebView would otherwise throw before sending the request).
- `src/components/translator/ResultPanel.tsx`: a failure is shown next to a kept result.
- Version 1.0.4 / versionCode 5; fresh 1.0.4 APKs attached to release v1.0.4.

## 5c. 1.0.5 — device-only DeepSeek key (BYOK)

- `src/lib/translation/providerKey.ts` (new): validated device-only key, excluded from backups.
- `src/lib/translation/direct.ts` (new): streaming direct calls to api.deepseek.com using
  `deepseek-flash` (DeepSeek V4.1 Flash), with SSE parsing, error classification and the same
  prompts/parsers/verifiers; `directRepair.ts` adds the deterministic second pass.
- `src/lib/translation/stream.ts`: uses direct mode on Android when a key is present, falls back
  to the deployed service on network/provider errors; auth/quota/rate answers are surfaced.
- `src/components/ProviderKey.tsx` (new) + `src/routes/privacy.tsx`: the key field under
  **Privacy → Advanced**, with active/inactive status and removal.
- CSP allows `https://api.deepseek.com` in the APK; ADR 0009 records the security boundary
  (device-only, not in the APK, not on the server, app-private storage).
- Version 1.0.5 / versionCode 6; release diagnostic verified the direct request end-to-end.

## 6. What was deliberately not changed

- No Compose/Flutter rewrite, no second translation engine, no prompts or provider keys in Kotlin.
- No second persistence system and no dual write; Room stays the record store, DataStore the scalar
  store, the TS port the single choice of adapter.
- No landscape/tablet design: the one-screen portrait composition is locked instead of shipping a
  squeezed broken layout (documented in the device compatibility doc).
- No SQLCipher: decision recorded in ADR 0008.
- No mass refactor of the 1,100-line route file or the React component tree; only the lifecycle and
  data paths that the defects proved necessary.
