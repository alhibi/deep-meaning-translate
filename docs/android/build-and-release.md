# Build and release (Android)

Status: **Built and signature-verified** on 2026-11-16. Device install/run is
**NOT_VERIFIED** (no device or emulator in this environment).

## Toolchain

| Tool | Version | Location in this workspace |
| --- | --- | --- |
| JDK | 21 (required by Capacitor's `JavaVersion.VERSION_21`) | `.android-toolchain/jdk-21` |
| Android SDK | platform 36, build-tools 36.0.0 | `~/android-sdk` |
| Gradle | 8.14.3 (wrapper) | `android/gradlew` |
| Kotlin / KSP | 2.1.21 / 2.1.21-2.0.1 | `android/app/build.gradle.kts` |
| Node | per `.nvmrc` / CI | — |

The toolchain directories are generated and ignored by Git. The project itself only needs
a machine with JDK 21 and the Android SDK.

## Commands

```bash
npm ci                              # one package manager: npm + package-lock.json
                                    # postinstall applies patches/@capacitor+android+8.6.2.patch
npm run build:native:web            # SPA → android-web/ (no service worker)
npx cap sync android                # copy assets + plugin config into android/
export JAVA_HOME=$PWD/.android-toolchain/jdk-21
export ANDROID_HOME=$HOME/android-sdk
cd android
./gradlew :app:testDebugUnitTest    # Room, migration, repository tests (Robolectric)
./gradlew :app:assembleDebug
./gradlew :app:assembleRelease
```

`npm run android:assembleDebug|assembleRelease|test` wrap the same Gradle tasks.

## Outputs (this build)

| File | Size | SHA-256 |
| --- | --- | --- |
| `android/app/build/outputs/apk/debug/app-debug.apk` | 6 391 079 B | `edcca1a50edb1736dc4f5c4a0d656a41a62644f1d143a1f90e899603196ad367` |
| `android/app/build/outputs/apk/release/app-release.apk` | 2 171 156 B | `842019bf89a44607a3271974aba7f2d6e6fcdd01e6a9898151590a3f9326076d` |

Manifest facts (from `aapt2 dump badging`):

```text
package: today.fluently.app.debug  versionCode 3  versionName 1.0.2-debug
targetSdkVersion 36
uses-permission: INTERNET, RECORD_AUDIO, VIBRATE
native-code: arm64-v8a armeabi-v7a x86 x86_64
assets/public/index.html present
```

## Signing

Release signing reads only environment variables:

```text
ANDROID_KEYSTORE_PATH
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Without them the release build is signed with the local **debug key** so the APK stays
installable for review. That is what this workspace produced:

```text
Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
SHA-256: 937327930160d71abc45e471f882c00ba912a3d1225913c28dd41f58eccbf631
Verified using v2 scheme: true   (v1/v3/v4: false)
```

**This release APK is not a Play Store artefact.** Before any distribution:

1. create an upload keystore outside the repository;
2. set the four variables above and rebuild;
3. confirm `apksigner verify --print-certs` shows the release certificate;
4. keep the keystore and passwords in a secret manager, never in Git.

Version bumps happen in `android/app/build.gradle.kts` (`versionCode`, `versionName`) and
in `package.json`; the debug build appends `.debug` / `-debug` so both can be installed
side by side.

## Verification performed

```bash
apksigner verify --verbose --print-certs app-debug.apk        # Verifies; v2 true
apksigner verify --verbose --print-certs app-release.apk      # Verifies; v2 true
aapt2 dump badging app-debug.apk                              # package, sdk, permissions
unzip -l app-release.apk | grep assets/public/index.html      # packaged UI present
unzip -p ... | grep -E "sk-ant-|sk-proj-|AIza"                # no provider key in assets
sha256sum app-debug.apk app-release.apk
adb devices                                                   # empty: no target
```

Not performed, and therefore not claimed: `adb install`, launch, first-run restore,
keyboard, RTL, dictation permission, SAF export/import on a device. See
[device-compatibility.md](device-compatibility.md) for the manual checklist.

## CI note

CI keeps building only the web/PWA target. The Android job is separate because it needs
JDK 21, the SDK and (for a real release) the keystore secret. Do not let an Android build
change the web deploy: `vite.config.ts` and `wrangler.jsonc` are untouched by
`vite.native.config.ts`.
