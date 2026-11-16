# Android Discovery Report — Deep Meaning Translate ("today")

Date: 2026-11-16 · Repository: `alhibi/deep-meaning-translate` · Branch: `main` at `c897209`

This report is Phase 0 evidence: what existed, what the environment actually was, and what the
baseline gates said **before** changes. It is not a plan and not a claim about the final state.

## 1. What the repository already was

The repository was **not** a raw web project waiting for an Android shell. It already contained:

- a complete TanStack Start / React 19 / TypeScript translator (Arabic ⇄ German, meaning-first)
  with the translation engine, prompts, verification, repair pass, device translation memory,
  history, saved phrases, statistics, sentence shadow, device/cloud voice, dictation, themes,
  interface locales, RTL/LTR, draft restoration and privacy/data controls;
- a Capacitor 8 Android project under `android/` with an application id
  `today.fluently.app`, minSdk 24, targetSdk 36;
- a Kotlin bridge (`LinguaStore`, `LinguaFiles`, `LinguaTts`), Room schema version 2 with a
  1→2 migration, Preferences DataStore settings, SAF export/import with optional AES-GCM;
- a versioned native API surface under `/api/native/v1/*` that reuses the web handlers, an
  origin allowlist, and a native transport/voice stack;
- a substantial documentation set (`AGENTS.md`, `PROJECT_CONSTITUTION.md`, `PROJECT_MAP.md`,
  `DEFINITION_OF_DONE.md`, `docs/architecture/`, `docs/android/`, `docs/security/`,
  `docs/quality/`, `docs/audits/`) that already claimed the Capacitor hybrid architecture
  (ADR 0005) and the Room/DataStore split (ADR 0006).

The stated Android debt was TD17 (no device verification), TD18 (debug-key release), TD19 (no
database encryption decision) and TD20 (no bridge instrumentation test). The documentation
described device behaviour that had never been executed.

## 2. Environment discovered (measured, not assumed)

| Item | Actual value |
| --- | --- |
| Node / npm | 26.13.1 / 11.20.0 |
| JDK | OpenJDK 21.0.13 (Homebrew, arm64) |
| Android SDK | platforms android-34/36/36.1/37.0; build-tools 34/35/36/36.1/37; NDK 28.2/30.0 |
| Gradle | wrapper 8.14.3, Android Gradle Plugin 8.13.0, Kotlin 2.1.21 |
| Emulator | **emulator-5554**, Android 15 (API 35), arm64-v8a, 1080×2400 @420 dpi, WebView 124.0.6367.219, software GPU |
| AVDs | `almani` (running), `api37_google_apis`, `vitalis_api35`; **no API 24/29 system image** |
| Host locale | `AppleLocale=ar_DE`, JVM `user.language=ar` — a build hazard (see below) |
| Secrets | no `.env`; no keystore; provider keys only on the deployed Worker |
| Git | clean working tree at `c897209`; no local changes to preserve |

## 3. Baseline gates executed before any change

| Gate | Result |
| --- | --- |
| `npm ci` | pass; `patch-package` applied `@capacitor/android+8.6.2.patch` |
| `npm run verify` | **exit 0** — typecheck, eslint zero warnings, vitest with coverage floors, 51/51 contrast pairs, docs inventory |
| `npm run build` (web/Worker) | pass (baseline run of the repository's production build) |
| Android build `assembleDebug/Release` | **FAILED on this host**: Room/KSP emitted Arabic-Indic digits (`TableInfo.Column(..., ٠, ...)`) because the JVM locale is Arabic; `compileDebugKotlin` / `compileReleaseKotlin` failed |
| Emulator available | yes (API 35); the repository's docs/TD17 claimed none was available |

The locale failure is itself a discovery: the committed tree could not be built on an
Arabic-locale host, and the docs did not mention the requirement.

## 4. First device launch (1.0.2 build, before fixes)

The APK built after pinning the locale and installed on emulator-5554 opened, but logcat showed:

```text
Uncaught (in promise) Error: "LinguaStore.then()" is not implemented on android
Uncaught Error: Minified React error #418 (hydration failed)
```

and `session_state` stayed `{json:null, seq:0}` while history/memory rows were written. That is,
the shipped persistence design was not merely unverified — the bridge was unusable and the app
would have lost every draft and every settings write. This is why Phase 1 audits and Phase 3
implementation were re-ordered around the device evidence.

## 5. Source-of-truth checks

- Authoritative order from `AGENTS.md` (implementation and gates → ADRs → specs) was followed.
- Historical Arabic reports and `AUDIT.md` were treated as historical, not as current state.
- `docs/android/*.md` were compared with the Kotlin/TS code and several claims were false
  (device verification, one-key DataStore, launchAutoHide, privacy storage wording, CORS test
  coverage, import metadata, voice-on-background). Those are listed in the gap analysis.

## 6. What the discovery did NOT establish

- No physical Android device, foldable, OEM keyboard, API 24/29/36 device, real microphone audio
  path or hardware performance measurement was available.
- No provider API keys were present locally; translation was exercised against the deployed
  production endpoints, not a local provider stub.
- The deployment's edge/WAF behaviour and the provider-side data handling were not tested.

Those limits are carried forward into the test evidence and release report; nothing in this
mission claims them as verified.
