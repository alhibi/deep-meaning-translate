# Android Test Evidence — 2026-11-16

Commit tested: `c5e70e2` (local `main`, not pushed). Classifications follow
`docs/quality/testing.md`: **VERIFIED** (executed/observed), **OBSERVED** (seen in a running
system), **SUSPECTED**, **NOT_VERIFIED**. No result below is inferred from a successful build.

## Environment

| Item             | Value                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| Device           | emulator-5554, AVD `almani`, Android 15 (API 35), arm64-v8a, 1080×2400 @420 dpi         |
| WebView          | 124.0.6367.219, software GPU (SwiftShader)                                              |
| Host             | macOS arm64, JDK 21.0.13, Node 26.13.1, Android SDK build-tools 36.0.0                  |
| Artifacts tested | `artifacts/android-1.0.3/today-1.0.3-debug.apk` and `…-release-review-debug-signed.apk` |
| Screenshots      | `artifacts/android-1.0.3/screenshots/`                                                  |

## Web/PWA gates (executed)

```text
npm run verify
  typecheck        PASS, 0 errors
  lint             PASS, 0 warnings
  vitest           378 passed, 4 skipped (382 total), 65 test files, coverage floors enforced
  contrast         51/51 pairs pass
  check:docs       51 documents, 15 links, all indexed
```

The web production build and PWA checks were run in the baseline and after the final source changes
(the Android work does not touch the Worker bundle; `npm run build` was exercised during the pass).

## Android JVM tests (executed)

```text
./gradlew :app:testDebugUnitTest            BUILD SUCCESSFUL
  today.fluently.app.bridge.BackupReaderTest   3 passed
  today.fluently.app.data.MigrationTest        3 passed
  today.fluently.app.data.RepositoryTest       7 passed
  total 13, failures 0, errors 0, skipped 0
```

## Android instrumentation (executed on API 35)

```text
./gradlew :app:connectedDebugAndroidTest    BUILD SUCCESSFUL
  today.fluently.app.BridgeInstrumentedTest   3 tests, 0 failures, 8.7 s
    packagedShellLoadsFromTheLocalOrigin
    storagePluginRoundTripsThroughTheRealBridge
    sessionDraftRoundTripsAndAStaleWriteIsRejected
```

## Release-signing guard (executed)

```text
./gradlew :app:assembleRelease               (no signing env, no opt-out)
  > Release signing is not configured. … pass -PallowDebugSigning=true …
  BUILD FAILED in 14s                        ← the intended fail-closed behaviour
./gradlew :app:assembleRelease -PallowDebugSigning=true
  BUILD SUCCESSFUL (release APK signed with the debug key; review only)
```

## Device matrix (executed on API 35)

| Scenario                                          | Result                                                                                                                   | Evidence                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Clean install / first run                         | **VERIFIED** intro renders, dismisses to translator                                                                      | screenshot 01                                       |
| Cold start (final debug)                          | **VERIFIED** ~1.9 s Displayed after fixes (SwiftShader)                                                                  | `am start -W`, logcat                               |
| Cold start (review release)                       | **VERIFIED** 492–689 ms Displayed                                                                                        | ActivityTaskManager logcat                          |
| Translate German→Arabic (debug, online)           | **VERIFIED** “طاب يومك، كيف حالك؟” + quality badge                                                                       | screenshot 02                                       |
| Translate German→Arabic (review release)          | **VERIFIED** “سعيد نهارك”                                                                                                | screenshot 11                                       |
| Translation quality feedback                      | **VERIFIED** “Nothing essential lost” shown; unknown/damaged state not shown as truth                                    | screenshot 02                                       |
| Offline error state                               | **VERIFIED** calm “connection dropped” + Try again, draft intact                                                         | screenshots 24                                      |
| Draft + result + pair survive force-stop          | **VERIFIED** restored after restart, no re-request observed                                                              | screenshots 05/16/40                                |
| Process killed in background (`am kill`) + return | **VERIFIED** draft/theme restored                                                                                        | emulator run                                        |
| Room: history/saved/memory/session rows           | **VERIFIED** pulled `lingua.db`: 1 history, 1 saved, 2 memory, session seq > 0                                           | sqlite output                                       |
| Theme persistence                                 | **VERIFIED** light and vivid restored after restart; bars/window strip match                                             | screenshots 04/05/13/14/16                          |
| Intro gate                                        | **VERIFIED** seen flag in DataStore; intro did not replay after restart (and did show on fresh install)                  | screenshots 01/22                                   |
| Keyboard open/close                               | **VERIFIED** composer + result remain visible, stage class flips, back closes keyboard                                   | screenshot 03/09, DOM class log                     |
| Back order                                        | **VERIFIED** sheet→close (app stays), next back→exit; `/stats`→translator draft intact                                   | emulator + UI tree                                  |
| Statistics                                        | **VERIFIED** 1 translation / 9 words / 1 pair / streak 1 matches the archive                                             | stats page text                                     |
| Save phrase + Saved sheet                         | **VERIFIED** saved row and filled bookmark restored after restart                                                        | screenshots/DB                                      |
| SAF export                                        | **VERIFIED** `ACTION_CREATE_DOCUMENT` produced a 3.7 KB valid envelope in Downloads                                      | screenshot 06, JSON/digest check                    |
| SAF import (merge)                                | **VERIFIED** preview + “0 added · 1 already present” report; DB `import_meta` has file name/digest/mode/counts           | screenshot 18, sqlite                               |
| Full restore after `pm clear`                     | **VERIFIED** history, saved, memory, session, theme restored from the backup                                             | screenshot 07, DB                                   |
| Tampered backup                                   | **VERIFIED** edited payload + stale digest refused before any write                                                      | emulator                                            |
| Mic permission grant/deny                         | **VERIFIED** Android prompt appears; denial shows calm copy; app continues                                               | screenshot 08                                       |
| TTS path                                          | **OBSERVED** native `LinguaTts` reached; Google TTS reports no Arabic voice on this image; no user-facing message (TD23) | logcat                                              |
| System bars / edge-to-edge                        | **VERIFIED** light theme → light bars/dark icons; vivid → dark bars                                                      | screenshots 04/13/16                                |
| Orientation                                       | **VERIFIED (policy)** portrait lock keeps the one-screen layout intact; rotation ignored by design                       | emulator + screenshot 21 (pre-lock defect evidence) |
| Review-release R8/minification                    | **VERIFIED** first-run intro, translation, force-stop restore work in the minified APK                                   | screenshots 10–12                                   |
| APK identity/signing/secrets                      | **VERIFIED** see release report; v2 signatures, expected packages, no provider-key strings                               | aapt2/apksigner/strings                             |

## Explicitly NOT_VERIFIED

- API 24–29 (the IME legacy branch), API 36 device, physical OEM keyboards, screen readers, font
  scaling, cutouts — no such image/device here (TD17, TD21).
- Foldables / Honor Magic V6 fold-unfold continuity — no device.
- Real dictation transcription (emulator audio HAL fails); only permission/denial is verified (TD28).
- Real TLS observation, edge WAF, provider-side handling and dependency vulnerabilities (TD6).
- Battery/doze, long-session memory, hardware frame timings (TD25); the emulator uses a software GPU.
- The GitHub Actions Android job (TD24) — authored and YAML-validated, never executed on GitHub.
- Arabic **interface locale** on device: document direction/RTL content was verified, but the
  interface-locale switch was not exercised in the final device pass.

## Artifact verification

```text
debug  today-1.0.3-debug.apk                     6,549,963 B
       sha256 325aa64426024f2ea87909b5948f8d427339df45c9fc765020de886a27852500
release today-1.0.3-release-review-debug-signed.apk  2,173,393 B
       sha256 bc89ac7d95de1a96aeca3d84c44265bc7752ebe6aab2d5bcdd2d06219d359c19
both: verify via APK Signature Scheme v2; package/versionCode/versionName/minSdk/targetSdk as
documented in ANDROID_RELEASE_REPORT.md; no provider key material in assets or dex strings.
```
