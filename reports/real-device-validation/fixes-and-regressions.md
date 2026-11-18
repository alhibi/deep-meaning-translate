# Fixes and Regressions

Loop: REPRODUCE -> EVIDENCE -> ROOT CAUSE -> PATCH -> BUILD -> INSTALL -> VERIFY -> REGRESSION.

## BUG-01 (critical for a shipped feature): dictation always failed on the Android app

**Reproduced:** tap the composer microphone on the HONOR phone -> after ~1 s the UI showed
`تعذّر بدء التسجيل — نصك محفوظ.` with `أعد المحاولة` (`screenshots/28-dictation.png`). Android had already
granted `RECORD_AUDIO` (`granted=true`), so the message was misleading.

**Evidence collected**

- `dumpsys appops --op RECORD_AUDIO`: the app opened the microphone for only **136 ms** before failing.
- Server side was healthy: `POST /api/native/v1/dictation-token` returned a valid AssemblyAI token, and a
  fresh token opened `wss://streaming.assemblyai.com/v3/ws` from the Mac (received the `Begin` frame).
- Logcat is blocked on this OEM build, so the **debug build** (WebView debugging enabled) was attached over
  CDP. The WebView console showed:

```
Loading the script 'blob:https://localhost/...' violates the following Content Security Policy
directive: "script-src 'self' 'unsafe-inline'". The action has been blocked.
Failed to load worklet module script: blob:... (CORS or access check error)
```

**Root cause:** dictation's PCM processor is an `AudioWorklet` module created from a Blob URL
(`src/lib/useAssemblySpeech.ts` -> `context.audioWorklet.addModule(blob)`). Worklet modules are governed
by **script-src** (not `worker-src`), and the native shell's CSP allowed only `'self' 'unsafe-inline'`,
so the module load was blocked after the microphone had already been opened. The web `_headers` CSP had
the same gap.

**Patch (minimal, two files)**

| File | Change |
| --- | --- |
| `scripts/prepare-native-web.mjs` | `script-src 'self' 'unsafe-inline' blob:` + comment explaining worklets use script-src |
| `scripts/build-headers.mjs` | same CSP change for the web deployment |

No product behaviour was changed; no exception is swallowed; no permission was added.

**Rebuild + install**

- `npm run build:native:web` -> `npx cap sync android` -> `./gradlew :app:assembleDebug :app:assembleRelease -PallowDebugSigning=true`
- `install -r` over the existing package: `firstInstallTime` unchanged, user data preserved.
- New artifact: `artifacts/today-1.0.8-review-r8-candidate2-cspfix.apk`, SHA-256
  `607b500f58036614e06e159e9cb22b9d6e8d900ce572413f762602b41e236e52`; the CSP inside the APK now reads
  `script-src 'self' 'unsafe-inline' blob:`.

**Verification (same phone)**

- Microphone access duration **20.9 s** instead of 136 ms, and a live Arabic transcript appeared in the
  composer (`screenshots/30-dictation-fixed.png`); stopping dictation restored the editable field.
- Regression: a normal translation after the fix still worked (`Danke sehr` -> `تسلم كتير`,
  `screenshots/33-regression-translation.png`).

## BUILD-ENV-01 (not an app defect): Gradle failed on duplicated files inside node_modules

**Symptom:** `assembleRelease` failed with `Duplicate resources` for Capacitor plugin values and
`Failed file name validation ... values 3.xml`.

**Cause:** 832 duplicate macOS cloud-sync files of the form `name 3.xml`/`name 3.tar.gz` inside
`node_modules/@capacitor` and generated intermediate directories.

**Fix:** removed the duplicated `* [0-9].*` files and the stale Capacitor plugin `build/` directories,
then rebuilt: **BUILD SUCCESSFUL in 48 s**. No project configuration was changed to force a build.

## Regressions

- No regression observed after BUG-01: installation, cold start, translation DE->AR and AR->DE, persistence,
  theme/locale switching and stats were re-exercised on the fixed build (see `functional-test-results.md`).
- No other code change was made during the pass.