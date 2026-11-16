# Android Release Report — 1.0.4

Date: 2026-11-16 · Build: `versionCode 5`, `versionName 1.0.4` · Base commit `c897209`.

## 1.0.4 — translation-freeze hotfix (why 1.0.3 was replaced)

The 1.0.3 APK could leave the result area on a skeleton forever — a person typed a short
German word (or any text whose translation equalled the input) while the target chip said
**Deutsch**, and no result or error ever appeared. The cause was in the route's re-route
guard, not in the provider: a **provisional** live result carries `sourceLanguage: "auto"`,
and the old rule also treated “translation text equals input text” as “the screen is about
to re-route”. Since the auto-flip effect only fires when a _detected_ source equals the
target, nothing flipped the target and the skeleton never cleared.

1.0.4 fixes it in two ways:

- `shouldHoldForReroute()` (`src/lib/translation/echo.ts`) holds only a **settled** result
  whose `sourceLanguage` explicitly equals the target; a provisional result can never freeze
  the screen. Regression tests cover the exact “Hallo / Deutsch / auto” case.
- A detected echo (translation normalized-equals the input, ignoring case and trailing
  punctuation) tries the other half of the Arabic/German pair once, and an echo is never
  archived as a history row. Further: failures now show a calm line beside a kept result
  instead of only when the panel is empty, and `AbortSignal.timeout` has a manual
  fallback for older WebViews.

Verified on the 1.0.4 **release** APK: fresh install → type “Hallo” with default Deutsch
→ target flips to العربية and shows “مرحبًا”. Arabic→German, full-sentence auto-reroute,
force-stop restore and the previous device matrix still pass.

## Deliverables

| Artefact                                | Path                                                                  | Size        | SHA-256                                                            |
| --------------------------------------- | --------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| Debug (installable, current data model) | `artifacts/android-1.0.4/today-1.0.4-debug.apk`                       | 6 434 755 B | `428a2a5aa78cfad477334a3041a5c27d6ed2cd889f5ecb68d9da97e7fd45c839` |
| Release review (debug-signed)           | `artifacts/android-1.0.4/today-1.0.4-release-review-debug-signed.apk` | 2 177 457 B | `390063556cafc0b45a193e7ebaec35c8fa950bfad9e29bb92c36c63c2a4e1f52` |
| Checksums                               | `artifacts/android-1.0.4/SHA256SUMS.txt`                              | —           | —                                                                  |
| Screenshots                             | `artifacts/android-1.0.4/screenshots/`                                | —           | —                                                                  |

The `artifacts/` directory is gitignored (built output), but the files exist on the machine that
produced this report and are the exact files tested below.

## Package facts

| Fact                            | Debug                                                                              | Release review                       |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| package                         | `today.fluently.app.debug`                                                         | `today.fluently.app`                 |
| versionCode / versionName       | 5 / 1.0.4-debug                                                                    | 5 / 1.0.4                            |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36                                                                       | 24 / 36 / 36                         |
| ABIs                            | arm64-v8a, armeabi-v7a, x86, x86_64                                                | same                                 |
| permissions                     | INTERNET, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, VIBRATE                             | same                                 |
| packaged shell                  | 65 `assets/public` entries, `index.html` with CSP meta, no service worker          | same                                 |
| Capacitor config                | `webContentsDebuggingEnabled=false`, mixed content off, origin `https://localhost` | same                                 |
| R8 / shrink                     | no                                                                                 | yes                                  |
| signer                          | `CN=Android Debug` (expected for debug)                                            | `CN=Android Debug` (**review only**) |

No provider key, keystore, `.env` or debug-flag `true` appears in either package. The APK scans
included `assets/*` and all `classes*.dex` `strings`.

## Verification outputs

```text
apksigner verify --verbose --print-certs today-1.0.4-debug.apk
  Verified using v2 scheme (APK Signature Scheme v2): true
  Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
  Signer #1 certificate SHA-256: 02d5b40c0d3d3da6835511cf24d8b8da40cc0b36f22b97bd055b0a529ee5de9a

apksigner verify --verbose --print-certs today-1.0.4-release-review-debug-signed.apk
  Verified using v2 scheme (APK Signature Scheme v2): true
  Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
  Signer #1 certificate SHA-256: 02d5b40c… (same local debug key)

aapt2 dump badging   → packages/versions/SDK/permissions/ABIs as tabled above
unzip -p … assets/capacitor.config.json → webContentsDebuggingEnabled: false
unzip -p … assets/public/index.html    → Content-Security-Policy present
strings classes*.dex | grep key patterns → no provider key
```

## Installation and run evidence

- **Debug**: installed over the previous debug install (`adb install -r`) — data survived the
  upgrade; cold launch with no uncaught JS/native errors; translated German→Arabic; force-stop
  restore verified; 3 instrumentation tests passed on the same emulator.
- **Release review**: installed clean (`package today.fluently.app`), first-run intro rendered,
  target changed to Arabic, “Guten Tag” → “سعيد نهارك”, force-stop/relaunch restored draft, result
  and target; no errors in logcat. Cold start measured 492–689 ms Displayed on the emulator.
- Uninstall/reinstall semantics: uninstalling removes the database and DataStore; the only surviving
  copy is the user-exported backup (verified earlier through SAF export/import and `pm clear`).

## Signing status — important

This environment has **no upload keystore**. The release APK is therefore signed with the local
**Android Debug** key under an explicit `-PallowDebugSigning=true` opt-out. It is installable for
review but **must not be distributed as the production release**:

- an update signed with a different key is rejected by Android;
- Play Store upload requires an upload key;
- the certificate above is not a product identity.

The release build now **fails closed** if someone forgets signing and the opt-out: that guard was
executed (`BUILD FAILED — Release signing is not configured`). TD18 stays open until a real upload
key is created outside the repository, the four environment variables are set, and the resulting
certificate is verified. See `docs/android/build-and-release.md`.

## How to install (review)

```bash
adb install -r artifacts/android-1.0.4/today-1.0.4-debug.apk
# or the review release (fresh package, cannot coexist with a store install of the same id):
adb install artifacts/android-1.0.4/today-1.0.4-release-review-debug-signed.apk
```

On a phone: copy the APK to the device, allow installation from the file manager, then open “today”.
The debug build installs alongside the release build because of the `.debug` suffix.

## Remaining limits for this release

- No physical-device/API-24–29/foldable verification (TD17, TD21).
- Review APK is debug-signed (TD18).
- Real dictation, TTS voice availability, battery and hardware performance unverified
  (TD23, TD25, TD28).
- The Android CI job is authored but has not run on GitHub yet (TD24).
