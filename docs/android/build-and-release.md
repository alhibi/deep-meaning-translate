# Build and release (Android)

Status: **Built, signature-verified and device-smoke-tested** on 2026-11-16 (emulator API 35).
The review release APK is **debug-signed** because no upload keystore exists in this environment;
TD18 therefore remains open for a publishable build.

## Toolchain actually used

| Tool         | Version                                          | Location                                                                   |
| ------------ | ------------------------------------------------ | -------------------------------------------------------------------------- |
| JDK          | OpenJDK 21.0.13 (arm64)                          | `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` |
| Android SDK  | platforms 34/36/36.1/37.0, build-tools 36.0.0    | `ANDROID_HOME=~/Library/Android/sdk`                                       |
| Gradle       | wrapper 8.14.3 (AGP 8.13.0)                      | `android/gradlew`                                                          |
| Kotlin / KSP | 2.1.21 / 2.1.21-2.0.1                            | `android/app/build.gradle.kts`                                             |
| Node         | 26.13.1                                          | —                                                                          |
| Emulator     | API 35, arm64, 1080×2400, WebView 124.0.6367.219 | AVD `almani`                                                               |

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
./gradlew :app:testDebugUnitTest    # 13 JVM tests (Robolectric + backup reader)
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
- This environment has no upload keystore, so the 1.0.3 release artefact is debug-signed.

## Outputs (this build, 2026-11-16)

| File                                          | Size        | SHA-256                                                            |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `today-1.0.3-debug.apk`                       | 6 550 037 B | `325aa64426024f2ea87909b5948f8d427339df45c9fc765020de886a27852500` |
| `today-1.0.3-release-review-debug-signed.apk` | 2 173 437 B | `bc89ac7d95de1a96aeca3d84c44265bc7752ebe6aab2d5bcdd2d06219d359c19` |

Both verify with the v2 APK signature scheme. The review release certificate is
`C=US, O=Android, CN=Android Debug`, SHA-256
`02d5b40c0d3d3da6835511cf24d8b8da40cc0b36f22b97bd055b0a529ee5de9a`. The debug APK uses the same
debug certificate (normal for a debug build). Nothing in the packages contains a provider key.

Manifest facts (`aapt2 dump badging` / merged manifest):

```text
package: today.fluently.app           versionCode 4  versionName 1.0.3
package: today.fluently.app.debug     versionCode 4  versionName 1.0.3-debug
minSdk 24 · targetSdk 36 · compileSdk 36
permissions: INTERNET, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, VIBRATE
native-code: arm64-v8a, armeabi-v7a, x86, x86_64
assets/public/index.html present (65 packaged public assets)
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

Device smoke (API 35 emulator): debug APK installed over previous data and launched; release APK
installed clean, first-run intro shown, translated German→Arabic (“سعيد نهارك”), and restored the
draft/result/target after force-stop. Room/DataStore, SAF, keyboard, back, theme and stats were
exercised in the debug build; the evidence and limits are in `ANDROID_TEST_EVIDENCE.md`.

## Distribution note

The review release APK is installable on a device with “unknown sources”. It is **not** a Play
Store or upgrade-safe production artefact: before distributing, create an upload keystore outside
the repository, set the four environment variables, rebuild without `allowDebugSigning`, verify the
certificate DN and publish the new hashes. TD18 stays open until then.
