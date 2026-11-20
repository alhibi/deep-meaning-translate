# Android stack upgrade — 1.1.0 (2026-11-20)

Status: **executed and verified on the physical device** (HONOR PNM-N49, Android 17 / API 37).
Base commit before the upgrade: the `1.0.9` dependency-freshness commit. App: `versionCode 11`,
`versionName 1.1.0` (debug suffix `-debug`; release-review build debug-signed).

## What changed (before -> after)

| Component                               | Before                         | After                                                                                                                       |
| --------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Android Gradle Plugin                   | 8.13.2                         | **9.5.2**                                                                                                                   |
| Gradle wrapper                          | 8.14.7                         | **9.8.1** (AGP 9.5 minimum is 9.6.0; newest 9.9.2 is one minor ahead and not yet exercised with this AGP)                   |
| Kotlin                                  | 2.3.21 (kotlin-android plugin) | **2.4.21 via AGP 9 built-in Kotlin** (KGP 2.4.21 on the root buildscript classpath; the `kotlin-android` plugin is removed) |
| KSP                                     | 2.3.14                         | 2.3.14 (already current; independent version line)                                                                          |
| compileSdk / targetSdk                  | 36 / 36                        | **37 / 37** (Android 17)                                                                                                    |
| minSdk                                  | 24                             | 24                                                                                                                          |
| JDK / JVM target                        | 21                             | 21                                                                                                                          |
| Room                                    | 2.7.2                          | **2.8.5**                                                                                                                   |
| DataStore                               | 1.1.7                          | **1.3.0**                                                                                                                   |
| lifecycle-runtime-ktx                   | 2.9.1                          | **2.11.1**                                                                                                                  |
| kotlinx-coroutines                      | 1.10.2                         | **1.11.0**                                                                                                                  |
| appcompat / activity / core-ktx         | 1.7.1 / 1.11.0 / 1.17.0        | **1.8.0 / 1.13.0 / 1.19.1**                                                                                                 |
| webkit / fragment / splashscreen        | 1.14.0 / 1.8.9 / 1.2.0         | **1.18.0 / 1.9.1 / 1.2.0**                                                                                                  |
| Robolectric                             | 4.14.1                         | **4.18.1**                                                                                                                  |
| androidx.test core / runner / ext.junit | 1.6.1 / 1.6.2 / 1.3.0          | **1.7.0 / 1.7.0 / 1.3.0**                                                                                                   |
| Truth                                   | 1.4.4                          | **1.4.5**                                                                                                                   |

Build-file migrations required by AGP 9:

- `kotlin-android` plugin removed; Kotlin compiler options moved into `android { kotlin {
compilerOptions { jvmTarget } } }` (built-in Kotlin), with KGP 2.4.21 on the root classpath.
- `aaptOptions { ignoreAssetsPattern }` and `resourceConfigurations` replaced by
  `androidResources { ignoreAssetsPattern; localeFilters }`.
- `variables.gradle` now carries SDK 37 and the upgraded AndroidX/test versions.

## Build and gate evidence

| Gate                                                      | Result                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `./gradlew :app:testDebugUnitTest`                        | **18 tests, 0 failures, 0 errors** (Repository, migration 1->2, BackupReader and the bridge guard set) |
| `./gradlew :app:assembleDebug`                            | PASS in 3s incremental / 1m04s clean; APK 8.6 MB                                                       |
| `./gradlew :app:assembleRelease -PallowDebugSigning=true` | PASS in 30s; R8 shrink ran; APK 3.7 MB (debug-signed review build, not publishable)                    |
| `aapt2 dump badging`                                      | `compileSdkVersion=37`, `targetSdkVersion=37`, `versionCode=11`, `versionName=1.1.0-debug`             |
| Kotlin classpath                                          | `kotlin-gradle-plugin:2.2.10 -> 2.4.21` (built-in Kotlin compiles with 2.4.21)                         |
| Debug APK cold start (`am start -W -S`)                   | **1451 ms** TotalTime (first run after install)                                                        |
| Release APK cold start                                    | **688 ms** TotalTime                                                                                   |
| Crashes / ANRs across the session                         | **0 FATAL EXCEPTION, 0 ANR**                                                                           |
| Jank (debug, `dumpsys gfxinfo`)                           | 36/1053 frames janky (**3.42%**, legacy 0.95%); 90th percentile 9 ms, 95th 12 ms                       |
| Memory                                                    | debug PSS ~117 MB, release PSS ~110 MB                                                                 |

## Device matrix (HONOR PNM-N49, Android 17 / API 37)

| Journey                                     | Result                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install 1.1.0 over 1.0.9 (`adb install -r`) | Success; `versionCode 11`; previous session preserved on the debug package                                                                                                         |
| Launch + restored session                   | PASS ("Hallo" -> "مرحبا" restored)                                                                                                                                                 |
| Translate DE -> AR                          | PASS: "Hallo" -> "مرحبا", "Guten morgen" -> "صباح الخير", "Guten Abend" -> "مساء الخير"                                                                                            |
| Save/bookmark the result                    | PASS (bookmark control toggles saved state)                                                                                                                                        |
| Statistics screen                           | PASS (19 words, 9 translations, 3 active days, 2 language pairs, 30-day window)                                                                                                    |
| About screen                                | PASS (`/about` content, review date, section links)                                                                                                                                |
| Theme cycle                                 | PASS (palette control cycles dark -> light -> vivid -> dark without a crash)                                                                                                       |
| Offline behavior                            | PASS: calm Arabic error "انقطع الاتصال قبل اكتمال الترجمة" + "إعادة" retry, draft and previous result preserved                                                                    |
| Reconnect and translate again               | PASS ("Guten Abend" -> "مساء الخير")                                                                                                                                               |
| Release-review build (R8 minified)          | PASS: launches, default direction is Arabic -> German (expected on a fresh install), swapping direction then translates "Guten Abend" -> "مساء الخير"                              |
| Share (`ACTION_SEND`)                       | **NOT_APPLICABLE / NOT_VERIFIED**: the native activity declares no `SEND` intent filter, so there is nothing to resolve; sharing is a web/paste journey, not a native share target |
| Rotation                                    | **NOT_VERIFIED**: the automated `user_rotation` change did not produce a landscape frame on this foldable posture; needs a manual rotation/fold check                              |
| Foldable posture / outer-inner display      | **NOT_VERIFIED** in this run; the app was exercised on the default display only                                                                                                    |
| Voice/TTS, dictation, cloud read-along      | **NOT_VERIFIED**: needs provider keys and audio verification; taps on the speaker control caused no crash                                                                          |

Screenshots and APKs: `artifacts/android-1.1.0/` (gitignored). SHA-256 checksums are in
`artifacts/android-1.1.0/SHA256SUMS.txt`.

## Known debt recorded

- Release signing remains fail-closed; the 1.1.0 release-review APK is debug-signed and is not
  publishable until an upload keystore is configured (TD18).
- Gradle 9.9.2 exists; this upgrade uses 9.8.1 because it is the newest cached version exercised
  with AGP 9.5.2. Move the wrapper when the AGP/Gradle pair is validated together.
- The Android dependency set is outside `scripts/freshness.mjs` (which audits npm). Extending the
  freshness gate to Gradle/AndroidX would close that blind spot.
