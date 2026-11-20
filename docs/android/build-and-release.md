# Build and release (Android)

Status: **Built, signature-verified and device-smoke-tested** on 2026-11-20 (HONOR PNM-N49,
Android 17 / API 37). The review release APK is **debug-signed** because no upload keystore exists
in this environment; TD18 therefore remains open for a publishable build.

## Toolchain actually used

| Tool         | Version                                         | Location                                                                   |
| ------------ | ----------------------------------------------- | -------------------------------------------------------------------------- |
| JDK          | OpenJDK 21.0.13 (arm64)                         | `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` |
| Android SDK  | platforms 37.0, build-tools 37.0.0              | `ANDROID_HOME=~/Library/Android/sdk`                                       |
| Gradle       | wrapper 9.8.1 (AGP 9.5.2)                       | `android/gradlew`                                                          |
| Kotlin / KSP | 2.4.21 (built-in Kotlin) / 2.3.14               | `android/build.gradle.kts` + `app/build.gradle.kts`                        |
| Node         | 26.13.1                                         | —                                                                          |
| Device       | HONOR PNM-N49, Android 17 / API 37, WebView A17 | physical device                                                            |

**Locale pin (required):** `android/gradle.properties` sets
`-Duser.language=en -Duser.country=US` for both the Gradle daemon and the Kotlin daemon. On an
Arabic-locale host (this machine is `ar_DE`) Room's KSP generator otherwise writes Arabic-Indic
digits into `LinguaDatabase_Impl.kt` and the Kotlin compile fails.

## Commands

```bash
npm ci                              # postinstall applies the Capacitor IME patch
npm run build:native:web            # SPA → android-web/ (CSP injected, no service worker)
npx cap sync android                # copies assets + writes capacitor.config.json (debugging false)
cd android
./gradlew :app:testDebugUnitTest    # 18 JVM tests (Room/repository/migration/backup + bridge guard)
./gradlew :app:connectedDebugAndroidTest   # 3 bridge tests on a device/emulator
./gradlew :app:assembleDebug

# A release artefact requires signing env vars, or the explicit non-publishable opt-out:
./gradlew :app:assembleRelease -PallowDebugSigning=true
```

Without `ANDROID_KEYSTORE_PATH`/`ANDROID_KEYSTORE_PASSWORD`/`ANDROID_KEY_ALIAS`/`ANDROID_KEY_PASSWORD`
(or `-PallowDebugSigning=true`) `:app:assembleRelease` **fails before packaging**; that behaviour was
executed and is evidence for A5-02/TD18.

## Release signing

- A real upload build reads only environment variables; the build log prints the keystore path.
- `-PallowDebugSigning=true` produces an installable review APK signed with the local debug key and
  logs a warning. It is **not publishable** (an upgrade signed with another key would be rejected).
- This environment has no upload keystore, so the 1.1.1 release artefact is debug-signed.

## Outputs (this build, 2026-11-20)

| File                                          | Size        | SHA-256                                                            |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `today-1.1.1-debug.apk`                       | 8 977 836 B | `fb9f929e519ef56bb123ac18f3bb5060ee75a082e5ba45deb28b3f8177ee2f16` |
| `today-1.1.1-release-review-debug-signed.apk` | 3 860 035 B | `4d022b156dd358f01cafea6f6e7dbf81a22776faeba790f8ac007ba016b29f04` |

Both verify with the v2 APK signature scheme. The review release certificate is
`C=US, O=Android, CN=Android Debug`, SHA-256
`02d5b40c0d3d3da6835511cf24d8b8da40cc0b36f22b97bd055b0a529ee5de9a`. The debug APK uses the same
debug certificate (normal for a debug build). Nothing in the packages contains a provider key.

Manifest facts (`aapt2 dump badging` / merged manifest):

```text
package: today.fluently.app           versionCode 12  versionName 1.1.1
package: today.fluently.app.debug     versionCode 12  versionName 1.1.1-debug
minSdk 24 · targetSdk 37 · compileSdk 37
permissions: INTERNET, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, VIBRATE, ACCESS_COARSE_LOCATION
native-code: arm64-v8a, armeabi-v7a, x86, x86_64
assets/public/index.html present (83 packaged public assets)
capacitor.config.json: webContentsDebuggingEnabled=false, mixed content off, origin https://localhost
```

## Verification performed

```bash
apksigner verify --verbose --print-certs app-debug.apk        # v2 true
apksigner verify --verbose --print-certs app-release.apk      # v2 true, debug DN
aapt2 dump badging …                                          # package/sdk/permissions/ABI
unzip -p … assets/capacitor.config.json                       # debugging false
unzip -p … assets/public/index.html                           # CSP meta present
strings classes*.dex | grep -E "sk-|AIza|…_API_KEY"            # no provider keys
sha256sum                                                     # values above
adb install + launch + translate + force-stop + relaunch      # see below
```

Device smoke (HONOR PNM-N49, API 37): the 1.1.1 debug APK installed over the previous data and
launched with the session restored; release-review APK installed clean and translated after the
source was switched; German→Arabic translations (“Hallo” → “مرحبا”, “Guten morgen” → “صباح الخير”,
“Guten Abend” → “مساء الخير”), save, statistics, about and the theme cycle all passed; cold start
was 1451 ms (debug) / 688 ms (release); jank 3.42 %; 0 fatal exceptions / 0 ANR. Rendering fixes are
recorded in `ANDROID_RENDERING_FIX_1_1_1.md`; evidence and limits are in `ANDROID_TEST_EVIDENCE.md`.

## Distribution note

Installable builds are attached to the repository's GitHub releases:
**[latest Android release](https://github.com/alhibi/deep-meaning-translate/releases/latest)**.
Each release carries both APKs and their SHA-256 checksums (also in
`artifacts/android-1.1.1/SHA256SUMS.txt` in the build workspace).

The review release APK is installable on a device with “unknown sources”. It is **not** a Play
Store or upgrade-safe production artefact: before distributing, create an upload keystore outside
the repository, set the four environment variables, rebuild without `allowDebugSigning`, verify the
certificate DN and publish the new hashes. TD18 stays open until then.
