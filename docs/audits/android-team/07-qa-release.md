# A7 — QA, Automation & Release Engineering Audit

Status: **Executed read-only audit**, 2026-11-16, commit `c897209` (`main`). Audited by the QA/release
workstream of the Android completion mission. Build/test execution was owned centrally by the Lead; this
audit read source, gates, docs, existing build outputs and the connected emulator, and ran only
read-only tooling (`git`, `adb shell dumpsys/getprop`, `apksigner`, `aapt2`, `shasum`, `unzip`).

Evidence convention: **VERIFIED** = read from source/an executed command; **OBSERVED** = seen in a running
runtime; **SUSPECTED** = plausible, not confirmed; **NOT_VERIFIED** = could not be exercised in this audit.
Classifications follow `docs/quality/testing.md:48-56`.

> Working-tree note (transparency): at audit time `git status` showed `M android/gradle.properties` and
> `?? android/.kotlin/`; later during the audit other workstreams were also editing `src/lib/native/plugin.ts`,
> `src/routes/__root.tsx`, `vite.native.config.ts` and adding `src/lib/native/plugin.test.ts` (not this
> audit's changes). The APK evidence in §4 was produced by the Lead's build from this tree (the modified
> `gradle.properties` is itself a finding — A7-06). All other evidence is from `c897209`.

---

## 1. Scope

Docs read: `docs/quality/testing.md`, `docs/quality/navigation-regression.md`, `DEFINITION_OF_DONE.md`,
`docs/android/build-and-release.md`, `docs/android/device-compatibility.md`,
`docs/android/network-and-security.md`, `docs/android/architecture.md`, `docs/audits/technical-debt.md`,
`docs/audits/2026-11-14-baseline.md`, `DOCUMENTATION_INDEX.md`, `docs/operations/development-and-release.md`.

Code/gates read: `package.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `scripts/check-docs.mjs`,
all `scripts/*.mjs`, `android/app/build.gradle.kts`, `android/build.gradle.kts`, `android/variables.gradle`,
`android/gradle/wrapper/*`, `AndroidManifest.xml`, res XML, `MainActivity.kt`, `LinguaDatabase.kt`,
`android/app/src/test/**`, `android/app/src/androidTest/**`, `tests/e2e/**`, `tests/eval/**`,
`patches/@capacitor+android+8.6.2.patch`, `capacitor.config.ts`, `vite.native.config.ts`,
`src/lib/native/config.ts`, `src/test/setup.ts`.

Not done by this audit (deliberately): `npm run verify`, `npx vitest run`, any `./gradlew` task, any
`adb install`/launch, any emulator mutation. The Lead's baseline `npm run verify` EXIT 0 (2026-11-16)
is used as the web-gate evidence and is marked accordingly.

---

## 2. Summary verdict

| Dimension                                               | Verdict                                                                                                                                                                                                                                                       | Basis                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Web quality gates (typecheck/lint/vitest/contrast/docs) | **READY** — strong, automated, zero-warning, coverage floors genuinely enforced                                                                                                                                                                               | `vitest.config.ts:22-27`, `package.json:12,21`, `.github/workflows/ci.yml:34-49`; Lead baseline EXIT 0 |
| Android unit tests                                      | **PARTIAL** — 8 meaningful Robolectric tests exist and are good, but nothing runs them in CI                                                                                                                                                                  | `RepositoryTest.kt:63-171`, `MigrationTest.kt:75-93`, `.github/workflows/ci.yml:18-55`                 |
| Android instrumentation / device automation             | **FAIL** — the only instrumented test is the stale Capacitor template and it would fail; no bridge/device automation exists (TD20 understated)                                                                                                                | `androidTest/.../ExampleInstrumentedTest.java:17,24` vs `build.gradle.kts:23,41`                       |
| Release artifact verification                           | **PARTIAL / NOT REPRODUCIBLE** — this build's APKs verify (v2, expected package/permissions, no secrets), but the documented SHA-256/certificate evidence cannot be reproduced and the release is debug-signed                                                | §4, `docs/android/build-and-release.md:38-42,64-71`, TD18                                              |
| Reproducible build from a clean checkout                | **FAIL on this host** — committed `android/gradle.properties` has no JVM-locale pin; on an Arabic-locale host (this machine: `AppleLocale=ar_DE`) Room/KSP writes Arabic-Indic digits and `compileDebugKotlin` fails; the fix exists only in the working tree | `git show HEAD:android/gradle.properties:26`, `git diff android/gradle.properties`                     |
| Device verification                                     | **NOT_VERIFIED, but now executable** — an emulator is running (`emulator-5554`, AVD `almani`, **API 35**, WebView 124) and the Lead installed the debug APK at 18:17:31; docs still claim "no device/emulator"                                                | §7, `docs/android/build-and-release.md:3-4`, `device-compatibility.md:3-5`, TD17                       |

**Release recommendation: do not sign off a stable daily-use Android release yet.** The blocking gaps are
release-engineering gaps, not product-code gaps: no Android CI, a broken/no device test layer, an unproven
headline fix, an unguarded patch to Capacitor, and a non-reproducible build from the committed tree on the
project's own primary locale. The web/PWA release gate is in good shape.

---

## 3. Gate inventory vs reality

Reality of what `npm run verify` and CI actually execute:

| Gate                                          | Declared in                                             | Actually wired                                                                              | CI             | This audit                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck` (`tsc --noEmit`)                  | AGENTS.md:38-43                                         | `package.json:17`                                                                           | ci.yml:34-35   | NOT run here; Lead baseline EXIT 0                                                                                                                               |
| `lint --max-warnings 0`                       | `package.json:12,21`                                    | `package.json:11`                                                                           | ci.yml:37-38   | NOT run; baseline EXIT 0                                                                                                                                         |
| `test` = `vitest run --coverage`              | `package.json:12`                                       | thresholds `vitest.config.ts:22-27` (lines 48 / statements 46 / functions 39 / branches 39) | ci.yml:43-46   | NOT run; floors are enforced because `--coverage` is in the script (fixed in 2026-11-14 baseline)                                                                |
| `check:contrast`                              | AGENTS.md:88                                            | `package.json:19`, `scripts/check-contrast.mjs`                                             | ci.yml:48-49   | baseline 51/51                                                                                                                                                   |
| `check:docs`                                  | AGENTS.md:26                                            | `package.json:20`, `scripts/check-docs.mjs`                                                 | ci.yml:40-41   | **Executed: FAILS** on the unindexed audit report (`docs check failed: not listed in DOCUMENTATION_INDEX.md: docs/audits/android-team/07-qa-release.md`) — A7-16 |
| `build` (+headers)                            | `DEFINITION_OF_DONE.md:15-16,62-63`                     | `package.json:8`                                                                            | ci.yml:51-52   | NOT run here (web build unchanged by mission)                                                                                                                    |
| `check:pwa`                                   | `package.json:18`                                       | `scripts/check-pwa.mjs`                                                                     | ci.yml:54-55   | NOT run here                                                                                                                                                     |
| `verify` aggregate                            | AGENTS.md:39 ("typecheck + lint + tests + contrast")    | `package.json:21` — also runs `check:docs`, but **not** build/PWA                           | via CI steps   | see A7-17 for the doc drift                                                                                                                                      |
| Android unit tests                            | `DEFINITION_OF_DONE.md:48`                              | `package.json:28`, `android/app/src/test`                                                   | **none**       | NOT run here (A7-01)                                                                                                                                             |
| Android assemble (debug/release)              | `DEFINITION_OF_DONE.md:49-50`                           | `package.json:26-27`                                                                        | **none**       | Lead produced both APKs (§4)                                                                                                                                     |
| `apksigner` / `aapt2` / SHA-256 / secret scan | `docs/android/build-and-release.md:84-94`               | **prose only; no script**                                                                   | **none**       | executed manually by this audit (§4) — A7-09                                                                                                                     |
| Instrumented tests                            | `build.gradle.kts:28,121-124` (runner + Espresso wired) | only stale template                                                                         | **none**       | would fail — A7-02                                                                                                                                               |
| Device/emulator run                           | `DEFINITION_OF_DONE.md:56-57`                           | manual only                                                                                 | **none**       | Lead installed debug APK; RUN not exercised by this audit                                                                                                        |
| E2E Playwright (13 scripts)                   | `docs/quality/testing.md:61-70`                         | `tests/e2e/*.py`; no runner/deps lock                                                       | **none** (TD3) | cannot run: `python3 -c "import playwright"` fails                                                                                                               |
| `npm audit` / dependency scan                 | TD6                                                     | **none**                                                                                    | **none**       | —                                                                                                                                                                |
| Android Lint                                  | —                                                       | **no `lint*` task wired anywhere**                                                          | **none**       | A7-13                                                                                                                                                            |
| Gradle dependency verification                | —                                                       | **no `verification-metadata.xml`**                                                          | **none**       | A7-14                                                                                                                                                            |

Key structural fact: **`npm run verify` is not the release gate.** The release gate in
`DEFINITION_OF_DONE.md:59-71` adds `build` + `check:pwa` + a served-preview journey; only CI runs those.
And **no gate in the repository builds, runs or signs an APK** — the entire Android half of the release
is manual prose.

---

## 4. Release-artifact verification that was actually executed

Both APKs from the Lead's 2026-11-16 build were verified read-only with SDK build-tools 36.0.0:

| Artifact          | Size (B)  | SHA-256 (actual)                                                   | Signature               | Certificate                                        | Badging                                                                                     |
| ----------------- | --------- | ------------------------------------------------------------------ | ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `app-debug.apk`   | 6 391 079 | `3da04c5eeb00757ecc071a889bf203639ccd036d2749241926b3fa2eb9d8bbdc` | v2 true; v1/v3/v4 false | `CN=Android Debug`, cert SHA-256 `02d5b40c…e5de9a` | `today.fluently.app.debug`, versionCode 3, versionName 1.0.2-debug, minSdk 24, targetSdk 36 |
| `app-release.apk` | 2 171 156 | `9f139d7db5ee993b143a633fd6c2996ea37b15e79938605a0bc96025ce2017a7` | v2 true; v1/v3/v4 false | `CN=Android Debug`, cert SHA-256 `02d5b40c…e5de9a` | `today.fluently.app`, versionCode 3, versionName 1.0.2, minSdk 24, targetSdk 36             |

What this **VERIFIES** for this build:

- `apksigner verify` passes for both; v2 scheme present (Play-compatible signature scheme for target 36).
- Package ids and version fields match the source (`build.gradle.kts:23,26-27,41-43`).
- Permissions are exactly `INTERNET`, `RECORD_AUDIO`, `VIBRATE` (+ the AndroidX
  `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`), matching `AndroidManifest.xml:9-11` and docs.
- 62 files under `assets/public` are packaged, including `index.html` (8 970 B); the release is R8-shrunk
  (1 `classes.dex`, 2.17 MB vs 6.39 MB debug).
- No source maps, no `sw.js`, no `offline.html`, no keystore/`.jks`/`local.properties`/`.env` entry.
- Manual secret scan of the packaged web assets found no provider-key pattern (see §10 commands).

What it **does not** verify / contradicts the docs:

- `docs/android/build-and-release.md:38-42` pins hashes `edcca1a5…` (debug) and `842019bf…` (release).
  **Sizes match exactly (6 391 079 / 2 171 156 B) but the digests do not.** The documented evidence is
  stale/wrong for any rebuild; builds are not byte-reproducible across hosts.
- `docs/android/build-and-release.md:64-71` documents release cert `937327930160d71abc45e471f882c00ba912a3d1225913c28dd41f58eccbf631`,
  but the release APK here is signed with this machine's debug keystore (`02d5b40c…`), i.e. **TD18 is
  confirmed on the current build**. Two different debug keystores also mean the documented 1.0.1 artifact
  and this 1.0.2 build are signature-incompatible for in-place upgrade (A7-05).
- `docs/android/build-and-release.md:12` states Gradle 8.14.3 — matches `gradle-wrapper.properties:3`;
  `android/build.gradle.kts:8` pins AGP 8.13.0. The mission brief said "wrapper 8.13"; the parenthetical
  confusion is AGP vs wrapper, not a risk.
- `docs/android/build-and-release.md:10-11,26-27` claim toolchain locations `.android-toolchain/jdk-21`
  and `~/android-sdk`. **Neither exists on this host**: actual JDK is `/opt/homebrew/opt/openjdk@21/…` and
  `ANDROID_HOME=/Users/amer/Library/Android/sdk`. The documented "reproducible" toolchain layout is not
  the one that produced this release (A7-06/A7-10).

---

## 5. Findings

### 5.1 Summary table

| ID    | Sev | Area                | Finding                                                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                                              |
| ----- | --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A7-01 | P1  | CI                  | No Android job at all: unit tests, native web bundle, `cap sync`, Gradle assembly and instrumentation never run in CI                                                                                                                                    | `.github/workflows/ci.yml:18-55`; `package.json:26-28`                                                                                                                                                                |
| A7-02 | P1  | Instrumentation     | The only instrumented test is the Capacitor template and asserts the wrong package; `connectedDebugAndroidTest` fails immediately; zero bridge coverage (TD20)                                                                                           | `androidTest/.../ExampleInstrumentedTest.java:17,24`; `build.gradle.kts:23,41`; `technical-debt.md:25`                                                                                                                |
| A7-03 | P1  | Release testing     | Device checklist installs the **debug** APK only; the R8-minified release APK (2.17 MB vs 6.39 MB) is never executed                                                                                                                                     | `device-compatibility.md:44-50`; `build.gradle.kts:44-47`; `build-and-release.md:96-98`                                                                                                                               |
| A7-04 | P1  | Migrations          | Migration test hand-builds v1 (no exported v1 schema), never inserts a `saved_phrases` row (the `normalized` backfill there is untested), and bypasses the production `LinguaDatabase.open()`; nothing forces a migration test when schema version bumps | `MigrationTest.kt:26-73,67-69,79-82`; `LinguaDatabase.kt:74-79`; `android/app/schemas/…/2.json` (only v2)                                                                                                             |
| A7-05 | P1  | Upgrade path        | 1.0.1 vs 1.0.2 are debug-signed with different per-machine debug keystores; no retained 1.0.1 APK, no tags, no release notes → the 1.0.1→1.0.2 Room migration and rollback path cannot be verified on a device                                           | §4; `build-and-release.md:38-42,64-71`; `git tag` empty; `.gitignore:47` (`artifacts/` absent)                                                                                                                        |
| A7-06 | P1  | Reproducibility     | Committed `android/gradle.properties` does not pin the JVM locale; on the project's own Arabic-locale host (`ar_DE`) Room/KSP generates Arabic-Indic digits and `:app:compileDebugKotlin` fails; the fix is uncommitted and undocumented                 | `git show HEAD:android/gradle.properties:26`; `git diff android/gradle.properties`; `docs/android/build-and-release.md:6-18` (no requirement)                                                                         |
| A7-07 | P2  | Dependency patch    | The only shipped fix for the black-screen/keyboard regression is a `patch-package` patch against a caret dependency; `postinstall` lacks `--error-on-warn`, so a version bump can silently drop the patch                                                | `package.json:29,32`; `patches/@capacitor+android+8.6.2.patch:1-20`; `node_modules/patch-package/dist/applyPatches.js:97,327-330`                                                                                     |
| A7-08 | P1  | Regression test     | The 1.0.2 headline fix (keyboard/blank composer) has no regression test, and its target environment (Android 10/API 29 + WebView 140+) is not representable here (running AVD is API 35, WebView 124; no API 29 image)                                   | `git show c897209 --stat` (no test files); `docs/android/architecture.md:67-71`; `DEFINITION_OF_DONE.md:11-12`; §7                                                                                                    |
| A7-09 | P2  | Release gate        | APK verification is prose, not code: no script for `apksigner`/`aapt2`/badging/SHA-256/secret scan, nothing in CI; debug-key signing is not even printed by the build (the comment claiming the log states the key is false)                             | `build-and-release.md:84-94`; `build.gradle.kts:12-13` vs `:48-58` (no logging)                                                                                                                                       |
| A7-10 | P2  | Evidence integrity  | Documented APK hashes/certificate are stale and not reproducible (same sizes, different SHA/cert); docs still assert "Built and signature-verified" for artifacts that no longer exist                                                                   | `build-and-release.md:3-4,38-42,64-71`; §4                                                                                                                                                                            |
| A7-11 | P2  | Signing (TD18)      | Release build silently falls back to the debug key; no gate refuses a debug-signed artifact intended for distribution                                                                                                                                    | `build.gradle.kts:55-58`; `build-and-release.md:73-78`; §4                                                                                                                                                            |
| A7-12 | P2  | Device testability  | The documented emulator escape hatch `http://10.0.2.2` is blocked in **all** variants: manifest forbids cleartext, no debug source set overrides it — the packaged app cannot be pointed at a local server                                               | `src/lib/native/config.ts:37`; `vite.native.config.ts:11`; `AndroidManifest.xml:21-22`; `res/xml/network_security_config.xml:5`; `docs/android/network-and-security.md:41-46`; ADR 0007:30                            |
| A7-13 | P2  | Static analysis     | No Android Lint gate anywhere; manifest/resources/Kotlin API-level issues cannot fail a build                                                                                                                                                            | no `lint` task in `android/app/build.gradle.kts` or scripts/CI                                                                                                                                                        |
| A7-14 | P2  | Supply chain        | Gradle dependency resolution is unpinned: no `verification-metadata.xml`, no dependency locking (npm is locked; Gradle is not)                                                                                                                           | `android/build.gradle.kts:1-24`; absence of `android/gradle/verification-metadata.xml`                                                                                                                                |
| A7-15 | P2  | Process/evidence    | Docs and TD17 still claim "no device or emulator", but `emulator-5554` is running and the debug APK was installed at 18:17:31 — the verification matrix is executable and must be run/updated; the brief's "API 37" is wrong for the running AVD         | `build-and-release.md:3-4`; `device-compatibility.md:3-5`; `testing.md:29-30`; `technical-debt.md:22`; §7                                                                                                             |
| A7-16 | P2  | Docs gate           | Writing the 7 `docs/audits/android-team/*.md` reports makes `npm run check:docs` (and therefore `npm run verify`) fail until `DOCUMENTATION_INDEX.md` lists them — **executed and confirmed**                                                            | `scripts/check-docs.mjs:84-88`; `DOCUMENTATION_INDEX.md:76-92`; `package.json:21`; executed `node scripts/check-docs.mjs` → exit 1, "not listed in DOCUMENTATION_INDEX.md: docs/audits/android-team/07-qa-release.md" |
| A7-17 | P3  | Gate/evidence drift | Three different unit-test counts across docs (300/50, 302/51, 345/59) and 61 test files on disk; testing.md's coverage-floor metric mapping contradicts `vitest.config.ts`; `verify` description omits `check:docs`                                      | `README.md:66-67`; `docs/audits/2026-11-14-baseline.md:42-45`; `testing.md:11,18`; `vitest.config.ts:22-27`; `AGENTS.md:39`; `package.json:21`                                                                        |
| A7-18 | P3  | E2E reproducibility | 13 Playwright scripts, no dependency lock/requirements file, Playwright not installed, not in CI; `tests/eval/shadow_eval.ts` is dead (outside vitest include, no npm script)                                                                            | `tests/e2e/*.py` (13); `vitest.config.ts:9`; `package.json:6-29`; `python3 -c "import playwright"` fails                                                                                                              |
| A7-19 | P3  | Build hygiene       | `android/.kotlin/` is not gitignored; committed `gradle.properties` has a duplicate `org.gradle.jvmargs` (line 12 overridden by line 26)                                                                                                                 | `git status`; `.gitignore:40-47`; `HEAD:android/gradle.properties:12,26`                                                                                                                                              |
| A7-20 | P3  | Versioning          | `versionCode`/`versionName` are consistent and monotonic (1.0.1→2, 1.0.2→3; `package.json` synced) but bound only by manual convention; no check ties `package.json` ↔ `versionName` or forces a bump before a release                                   | `build.gradle.kts:26-27`; `package.json:94`; `git show e31c6d3/c897209 -- …build.gradle.kts`                                                                                                                          |

### 5.2 P1 detail

**A7-01 — Android is absent from CI (release blocker).**
`.github/workflows/ci.yml:18-55` is one `verify` job: checkout, Node 22, `npm ci`, typecheck, lint,
`check:docs`, `npm run test`, contrast, `npm run build`, `check-pwa`. Nothing runs `build:native:web`,
`cap sync`, `./gradlew`, `apksigner` or `aapt2`. Every Kotlin/Room/bridge change and every packaged-asset
regression is invisible to CI; the 2026-11-14 baseline already showed this class of blind spot for the web
gates (lockfile mismatch found only by a full audit). `DEFINITION_OF_DONE.md:46-57` makes those Android
commands part of "done", so the contract and the executable gates disagree.
_Fix:_ add a second CI job (`ubuntu-latest`, `actions/setup-java@v4` Temurin 21, `android-actions/setup-android`,
SDK platform 36 + build-tools 36.0.0, Gradle cache) running
`npm ci && npm run build:native:web && npx cap sync android && cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease`,
uploading the test XML and both APKs; add `./gradlew :app:connectedDebugAndroidTest` on a macOS/Linux
emulator runner in a scheduled/release job (or gate it on a label).
_Regression test:_ the job itself, plus a PR that breaks a Kotlin assertion and must go red.

**A7-02 — The only instrumented test is broken (TD20 is worse than recorded).**
`android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java:17,24` asserts
`assertEquals("com.getcapacitor.app", appContext.getPackageName())`, but the application id is
`today.fluently.app` (`build.gradle.kts:23`) and the debug variant appends `.debug` (`:41`). Any
`connectedDebugAndroidTest` fails 100% of the time; the Espresso/runner/androidx-test dependencies
(`build.gradle.kts:121-124`) and `androidTest` schema assets (`:79-81`) are wired but unused. There is
**no** test that boots the Capacitor bridge and calls `boot`/`settingsWrite` (TD20: bridge mistakes surface
only on a device).
_Fix:_ delete the template; add an instrumented test that (a) launches `MainActivity`, (b) asserts the
package, (c) calls each custom plugin method over the real bridge against an on-device Room DB, (d) asserts
`allowBackup=false`/cleartext-off manifest facts; add a 3-5 step Espresso/UI-Automator smoke for first paint
and back order.
_Regression test:_ `./gradlew :app:connectedDebugAndroidTest` green on `emulator-5554`.

**A7-03 — The verified artifact is not the shipped artifact.**
`docs/android/device-compatibility.md:44-50` instals only `app-debug.apk`. The release APK enables
`isMinifyEnabled` and `isShrinkResources` (`build.gradle.kts:44-47`) with a hand-written
`proguard-rules.pro`; Capacitor's plugin loading is reflective (kept via `-keep`), but R8/resource shrinking
can still remove classes, resources or annotations used only at runtime (`getIdentifier` for resources,
reflection in custom plugins, Room generated code). None of that is exercised if the device only ever sees
the debug APK. The two APKs differ by ~4.2 MB and by code shape; "debug runs" is not evidence that "release
runs".
_Fix:_ make the device matrix install **both** variants (different application ids are side-by-side by
design) and run the same journeys on the release APK; add `adb logcat -d | grep -i AndroidRuntime` crash
assertion after each journey.
_Regression test:_ release-APK smoke script (see `scripts/verify-apk.mjs` proposal, A7-09) + device checklist.

**A7-04 — Migration test quality does not protect user data.**
Current test: builds a v1 SQLite DB by hand (`MigrationTest.kt:26-73`), inserts one `history_entries` row
(`:67-69`), opens Room v2 with `addMigrations(MIGRATION_1_2)` (`:79-82`), asserts the row and the
`normalized` merge key (`:84-91`). Gaps:

1. `MIGRATION_1_2` also backfills `saved_phrases` (`LinguaDatabase.kt:54-62`) — **no `saved_phrases` row is
   inserted, so that UPDATE/backfill and index are never exercised with data**. A bad expression there would
   ship and only surface on real users' saved phrases.
2. The v1 schema exists only as hand-written DDL inside the test — the repo has **no `1.json`** schema export
   (`android/app/schemas/…/` contains `2.json` only), so nothing proves the test's v1 shape matches what v1
   actually shipped. If the hand-written DDL drifts, the test can stay green while real upgrades break.
3. The test builds its own `Room.databaseBuilder` instead of the production `LinguaDatabase.open()`
   (`LinguaDatabase.kt:74-79`), so a regression in `open()` (dropped migration, added
   `fallbackToDestructiveMigration`) would not fail this test. (Current source has no destructive fallback —
   VERIFIED at `:77-78`.)
4. Only one migration exists; nothing in CI fails when `@Database(version)` changes without a matching
   `Migration`/test (the v1→v2 rule relies on convention only).
   _Fix:_ export `1.json` (check it in; `exportSchema=true` already set at `LinguaDatabase.kt:27`) and use
   `MigrationTestHelper` with `createDatabase(TEST_DB, 1)`; insert rows into **both** history and saved tables;
   open through `LinguaDatabase.open()`; add a CI check that a `version = N` bump has `N-1→N` migration +
   test; add a failed-migration rollback test (wrong DDL must leave the old DB intact, not wipe it).
   _Regression test:_ the new migration tests, including `saved_phrases` normalized backfill with whitespace.

**A7-05 — The upgrade path is untestable and likely broken across build machines.**
Release 1.0.1 and 1.0.2 were built on different hosts (the docs were produced on a Linux worktree, this build
on macOS), each with its own `~/.android/debug.keystore`. Evidence: documented cert `93732793…`
(`build-and-release.md:68-70`) vs the current cert `02d5b40c…` (§4). Android refuses to update an installed
app when the signer changes, so a device that has 1.0.1 cannot accept this 1.0.2 build
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). There is also no retained 1.0.1 APK (`artifacts/` is gitignored and
absent, `.gitignore:47`) and no git tag (`git tag` empty, one commit per "ship" message), so the actual
user-risk transition — v2 Room migration over real 1.0.1 data — **cannot be exercised at all** on this host.
_Fix:_ (a) stop shipping debug-signed builds (A7-11/TD18); (b) retain every release artifact + SHA-256 +
cert + release notes under `artifacts/<version>/` (outside git) or as CI release assets; (c) tag releases
(`android-1.0.1`, `android-1.0.2`) and keep one installable previous build for upgrade testing; (d) before
release, install N-1, seed data, install N with `adb install -r`, assert rows survive.
_Regression test:_ scripted 1.0.1→1.0.2 upgrade check in the device matrix.

**A7-06 — The release cannot be built from the committed tree on this host (verified failure).**
Committed `android/gradle.properties` (HEAD) has only
`org.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8` at line 26 (and a duplicate `-Xmx1536m` at line 12
that is silently overridden). No `user.language` pin exists. The host's `AppleLocale` is `ar_DE`
(`AppleLanguages = ar-DE, de-DE`), so the JVM default locale is Arabic; Room's KSP generator formats schema
integers through the default locale and writes Arabic-Indic digits into generated Kotlin
(`TableInfo.Column(..., ٠, ...)`), which does not compile. The working tree carries the fix
(`org.gradle.jvmargs=… -Duser.language=en -Duser.country=US` and `kotlin.daemon.jvmargs=…`), with comments
stating "without this, `:app:compileDebugKotlin` fails". That fix is **uncommitted and undocumented** in
`docs/android/build-and-release.md`, whose toolchain section (`:6-18`) also names non-existent paths
(`.android-toolchain/jdk-21`, `~/android-sdk`). A fresh checkout on the project's primary language host
cannot reproduce the release.
_Fix:_ commit the `gradle.properties` fix (keep one `org.gradle.jvmargs` key, add `kotlin.daemon.jvmargs`),
document it in `docs/android/build-and-release.md` ("host locale must be pinned; JDK 21 + SDK paths as
installed"), and add a CI job with `-Duser.language=ar` that still compiles to prove the pin works.
_Regression test:_ CI compile with `user.language=ar` (or a JVM flag override) on a clean checkout.

**A7-08 — The headline 1.0.2 fix is unproven and untestable here.**
`c897209` ("Fix the Android 10 keyboard resize that blanked the composer in 1.0.2") changes
`android/app/build.gradle.kts`, docs, lockfile/package.json and the Capacitor patch — **no test file**
(`git show --stat c897209`). `DEFINITION_OF_DONE.md:11-12` requires a regression test for a bug fix. The
condition is API 29 + WebView 140+ (`docs/android/architecture.md:67-71`). The only running emulator is
API 35 with WebView 124.0.6367.219 (§7); `system-images` contains only `android-35` and `android-37.0` — no
API 29 image. So the fix is a compiled patch that no executed check in this repository has ever validated,
and the next Capacitor bump can silently remove it (A7-07).
_Fix:_ add an API 29 AVD to the release matrix (download `system-images;android-29;google_apis;arm64-v8a`),
script: open composer → `adb shell input text` → show IME → assert `dumpsys window` focused window height
did not collapse and `logcat` has no crash/reload; also assert the patched marker in the CI build
(A7-07). Keep a screenshot/video as evidence.
_Regression test:_ the scripted IME check on API 29; a unit-level assertion that
`SystemBars` contains the API-30 guard after `npm ci`.

### 5.3 P2 detail (condensed)

- **A7-07 patch fragility.** `patches/@capacitor+android+8.6.2.patch:1-20` targets
  `node_modules/@capacitor/android/…/SystemBars.java` and _is_ applied in the current
  `node_modules` (verified: `padForIme` at `SystemBars.java:207-210`). But `package.json:32` uses
  `^8.6.2`, the patch filename pins 8.6.2, and `postinstall` is plain `patch-package` (`:29`):
  `applyPatches.js:97` only fails on warnings with `--error-on-warn`, and a version mismatch is a
  **warning** (`:327-330`). Fix: pin `"@capacitor/android": "8.6.2"`, use
  `patch-package --error-on-warn`, and add a CI step asserting the patched lines exist after `npm ci`.
- **A7-09 release gate not code.** `docs/android/build-and-release.md:84-94` lists the commands a human
  should run. There is no `scripts/verify-apk.*` and no npm script (scripts are `build-headers`,
  `check-contrast`, `check-docs`, `check-pwa`, `make-og`, `prepare-native-web`, `serve-build`). The
  build comment at `build.gradle.kts:12-13` says "the build log states which key was used" but no logging
  exists in `:15-16,48-58` — so a debug-signed release is indistinguishable from a real one in the log.
  Fix: add `scripts/verify-apk.mjs` (signature scheme + cert DN + SHA-256 of both APKs + `aapt2` badging
  assertions: package/versionCode/versionName/min/target/permissions/asset presence + secret regex scan)
  and make it exit 0 only for expected values; print/record the signer; fail when release is debug-signed
  unless `--allow-debug-signing` is explicit; run it in CI and attach a checksum manifest to the release.
- **A7-10 evidence integrity.** Same APK sizes, different SHA/cert vs docs (§4). Fix: stop putting volatile
  digests in durable docs; emit a per-build `SHA256SUMS` + signer report as an artifact and attach it to
  the release note; or make builds reproducible (fixed toolchain, `SOURCE_DATE_EPOCH`, pinned SDK) and then
  keep digests. Also update the "Built and signature-verified on 2026-11-16" status with the actual build.
- **A7-11 debug signing (TD18).** `build.gradle.kts:55-58` silently substitutes the debug config; docs
  already say "not a Play artifact" (`build-and-release.md:73-78`) but nothing enforces it. Fix as A7-09:
  refuse to produce/verify a release when `releaseReady == false` unless explicitly allowed.
- **A7-12 local-server testing is impossible.** JS allows `http://10.0.2.2`
  (`src/lib/native/config.ts:37`, compiled via `vite.native.config.ts:11`); docs claim it is the only
  cleartext exception "compiled out of release builds" (`docs/android/network-and-security.md:41-46`,
  ADR 0007:30), but `AndroidManifest.xml:21-22` sets `usesCleartextTraffic="false"` +
  `networkSecurityConfig`, `res/xml/network_security_config.xml:5` refuses cleartext, and there is **no
  `android/app/src/debug/`** source set (only `main`, `test`, `androidTest`) to override it. Result: a
  debug APK cannot talk to a local emulator server over HTTP (also mixed content from
  `https://localhost`), so device E2E must hit production. Fix: add
  `android/app/src/debug/res/xml/network_security_config.xml` allowing cleartext only to `10.0.2.2`
  (or a debug manifest `usesCleartextTraffic` override), document it, and add a check that release builds
  still refuse cleartext.
- **A7-13 no Android Lint.** No `lint` configuration in `android/app/build.gradle.kts`, no `gradlew lint`
  in any script or workflow. AGP's lint catches API-level misuse, missing permission checks,
  untranslated/duplicated resources, manifest problems — all relevant to a device release. Fix: add
  `lint { abortOnError = true; warningsAsErrors = true }` (with a baseline for known noise) and run
  `./gradlew :app:lintDebug` in CI.
- **A7-14 Gradle deps unpinned.** No `android/gradle/verification-metadata.xml` and no dependency locking;
  `variables.gradle` and `build.gradle.kts:5,98-124` resolve ranges. npm is locked; the APK's dependency
  graph is not. Fix: generate `verification-metadata.xml` (`./gradlew --write-verification-metadata sha256`)
  and enable it in CI; pin plugin versions exactly.
- **A7-15 stale verification premise.** `docs/android/build-and-release.md:3-4`,
  `device-compatibility.md:3-5`, `testing.md:29-30` and `technical-debt.md:22` (TD17) all say there is no
  device/emulator. Reality (§7): `emulator-5554` is running and the debug build is installed. TD17 is no
  longer a P1 "cannot test" item; it is now an unrunnable-work item. Fix: run §7's matrix, record it in
  `docs/audits/` (device model, API 35, WebView 124.0.6367.219), then downgrade/close TD17 with evidence,
  and correct the docs' status lines.
- **A7-16 docs gate self-break (executed).** `scripts/check-docs.mjs:84-88` fails for **any** `.md` under
  `docs/` not listed in `DOCUMENTATION_INDEX.md`; `npm run verify` includes `check:docs` (`package.json:21`).
  The `docs/audits/android-team/*.md` deliverables are not in the index (`DOCUMENTATION_INDEX.md:76-92`
  lists only the existing audit set). **This was executed during the audit:** `node scripts/check-docs.mjs`
  exits 1 with `docs check failed: - not listed in DOCUMENTATION_INDEX.md:
docs/audits/android-team/07-qa-release.md`. So after the seven reports are written, `npm run verify` fails
  on its last gate until the index is updated. Fix (Lead-owned, outside this read-only scope): add the seven
  reports to the "Audits and debt" table (and optionally to `REQUIRED`); re-run `npm run check:docs`.

### 5.4 P3 detail

- **A7-17 evidence drift.** `README.md:66-67` says 300 tests/50 files (2026-11-07 audit);
  `docs/audits/2026-11-14-baseline.md:42` measured 302/51; `docs/quality/testing.md:11` claims 345/59 while
  its status says "Verified on 2026-11-07" (chronologically inconsistent). Disk has **61** test files
  (`find src -name '*.test.*' | wc -l`), one `it.skipIf` (`src/lib/translation/engine.test.ts:6`).
  `docs/quality/testing.md:18` maps floors as "statements/branches/functions/lines: 48/46/39/39", but
  `vitest.config.ts:22-27` is lines 48, statements 46, functions 39, branches 39 — under testing.md's
  mapping the documented 41.86 branch baseline would fail the documented 46 branch floor, so the doc mapping
  is the error. AGENTS.md:39 describes `verify` without `check:docs` although `package.json:21` runs it.
  Fix: generate these numbers from a scripted run and either remove volatile counts or mark the date of the
  last run; do not hand-edit.
- **A7-18 e2e not runnable.** 13 Playwright scripts exist and are useful, but no
  `requirements.txt`/`pyproject.toml`, Playwright is absent from this environment, and none run in CI
  (TD3). `tests/eval/shadow_eval.ts` is outside `vitest.config.ts:9` (`src/**/*.test.{ts,tsx}`) and no npm
  script names it → dead. Fix: pin Python deps, add an e2e job against `npm run preview`, wire the eval
  script as `npm run eval:shadow`.
- **A7-19 build hygiene.** `git status` shows `?? android/.kotlin/`; `.gitignore:40-47` covers
  `.android-toolchain/`, `android-web/`, `android/.gradle/`, `android/app/build/` but not
  `android/.kotlin/` (nor Kotlin daemon logs). HEAD `gradle.properties:12` and `:26` both define
  `org.gradle.jvmargs`; the first is dead. Fix: add `android/.kotlin/`, merge the duplicate key.
- **A7-20 versioning.** Verified consistent: `e31c6d3` → versionCode 2/versionName 1.0.1 and
  `package.json` 1.0.1; `c897209` → versionCode 3/versionName 1.0.2 and `package.json` 1.0.2
  (`build.gradle.kts:26-27`, `package.json:94`). Debug suffix appends `.debug`/`-debug` so both install
  side by side. Risk is only that the pairing is manual and unreleased versions are indistinguishable. Fix:
  a release script that edits both files atomically and refuses a versionCode that is not greater than the
  last tag.

---

## 6. Verified vs NOT_VERIFIED matrix

| Claim                                                                                                            | Classification                                                                                                                               | Evidence                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Branch `main` at `c897209`; repo clean at start                                                                  | VERIFIED                                                                                                                                     | `git log`, `git status` at session start                                    |
| Web gates exist with the declared commands and coverage floors are enforced                                      | VERIFIED                                                                                                                                     | `package.json:12,21`; `vitest.config.ts:9,22-27`; CI `ci.yml:34-49`         |
| `npm run verify` EXIT 0 (2026-11-16)                                                                             | VERIFIED by Lead (not re-run here)                                                                                                           | mission baseline; not executed by this audit                                |
| 61 vitest test files, 13 e2e scripts, 9 Kotlin unit `@Test` (8 meaningful + 1 template), 1 instrumented template | VERIFIED (static)                                                                                                                            | `find`/`grep -c` counts                                                     |
| Android unit test run "9 passed, 0 failed"                                                                       | NOT_VERIFIED (not re-run; no retained test report in `android/app/build`)                                                                    | `docs/quality/testing.md:27` claims it; all 9 tests exist statically        |
| Migration 1→2 preserves `history_entries` row + normalized key                                                   | VERIFIED (source: test asserts it) — execution NOT_VERIFIED                                                                                  | `MigrationTest.kt:75-93`                                                    |
| Migration 1→2 preserves `saved_phrases` rows                                                                     | **NOT_VERIFIED / untested**                                                                                                                  | `LinguaDatabase.kt:54-62` vs `MigrationTest.kt:67-69` (no saved row insert) |
| No `fallbackToDestructiveMigration` in production builder                                                        | VERIFIED                                                                                                                                     | `LinguaDatabase.kt:74-79`                                                   |
| The one instrumented test fails                                                                                  | VERIFIED (static, deterministic: wrong expected package) — not executed                                                                      | §5.2 A7-02                                                                  |
| No Android/Lint/gradle gate in CI                                                                                | VERIFIED                                                                                                                                     | `ci.yml` full file; grep for `lint`                                         |
| Capacitor patch is applied in `node_modules`                                                                     | VERIFIED                                                                                                                                     | `SystemBars.java:207-210` contains `padForIme`                              |
| Debug APK: v2 signature, package/version/permissions/assets, no secrets                                          | VERIFIED (executed `apksigner`/`aapt2`/`unzip`/grep)                                                                                         | §4                                                                          |
| Release APK: v2 signature, R8-shrunk, package/version/permissions/assets, no secrets                             | VERIFIED (executed)                                                                                                                          | §4                                                                          |
| Release APK is debug-signed (TD18 still open)                                                                    | VERIFIED                                                                                                                                     | `apksigner --print-certs` → `CN=Android Debug`                              |
| Documented APK SHA-256/cert reproducible                                                                         | **VERIFIED FALSE**                                                                                                                           | sizes equal, digests differ; §4                                             |
| Release builds byte-reproducible across hosts                                                                    | SUSPECTED NOT (sizes equal, digests differ)                                                                                                  | §4                                                                          |
| Build succeeds from committed tree on this host                                                                  | **VERIFIED FAILURE** without the uncommitted locale fix                                                                                      | host `AppleLocale=ar_DE`; `git diff android/gradle.properties`              |
| Emulator available; `emulator-5554` = AVD `almani`, API 35 (Android 15), arm64-v8a, WebView 124.0.6367.219       | VERIFIED (executed `adb`)                                                                                                                    | §7; **brief's "API 37" is wrong for the running AVD**                       |
| API 37 AVD `api37_google_apis` and `android-37.0` image exist but are not running                                | VERIFIED                                                                                                                                     | `~/.android/avd`, `system-images/`                                          |
| Debug APK installed at 18:17:31, versionCode 3/1.0.2-debug, MainActivity resumed                                 | VERIFIED (executed `dumpsys`)                                                                                                                | §7                                                                          |
| Release APK installed/run on a device                                                                            | NOT_VERIFIED                                                                                                                                 | only `today.fluently.app.debug` is installed                                |
| First-run restore, keyboard, RTL, SAF export/import, dictation permission, TTS, airplane mode                    | NOT_VERIFIED (Lead-owned device run)                                                                                                         | `device-compatibility.md:52-57` checklist                                   |
| 1.0.1→1.0.2 in-place upgrade (signature + Room migration on device)                                              | NOT_VERIFIABLE here (no 1.0.1 artifact; different debug keystores)                                                                           | A7-05                                                                       |
| E2E Playwright suite passes                                                                                      | NOT_VERIFIED (Playwright not installed; not in CI)                                                                                           | §3; TD3                                                                     |
| `check:docs` fails after audit reports are added                                                                 | VERIFIED (executed: `node scripts/check-docs.mjs` exit 1, "not listed in DOCUMENTATION_INDEX.md: docs/audits/android-team/07-qa-release.md") | `check-docs.mjs:84-88`, `DOCUMENTATION_INDEX.md:76-92`                      |
| Physical devices/OEMs/foldables, Android 7–9, real TTS voices, Play upload                                       | NOT_VERIFIED / out of environment                                                                                                            | §7                                                                          |

---

## 7. Device verification matrix for the available emulator

Environment facts measured during this audit (read-only `adb`):

| Fact          | Value                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Serial        | `emulator-5554`, AVD **`almani`**                                                                       |
| OS            | **API 35 / Android 15** (`ro.build.version.sdk=35`, `ro.build.version.release=15`)                      |
| ABI           | `arm64-v8a` (`sdk_gphone64_arm64`)                                                                      |
| WebView       | `com.google.android.webview 124.0.6367.219`                                                             |
| Image extras  | `com.google.android.tts` present, Play Store (`com.android.vending`) present, Google APIs image         |
| Installed app | `today.fluently.app.debug` v1.0.2-debug (versionCode 3), first install 18:17:31, `MainActivity` resumed |
| Other AVDs    | `api37_google_apis` (android-37.0 image) exists but **not running**; `vitalis_api35`                    |
| System images | only `android-35`, `android-37.0` — **no API 24 and no API 29 image**                                   |

**Correction to the mission brief:** the running emulator is **API 35, not API 37**. API 37 can be used only
by starting the `api37_google_apis` AVD (not done by this audit; the Lead owns emulator state).

### 7.1 What this environment CAN verify (executable now)

| #   | Check                                                                                    | How                                                                              |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Install/launch/first paint crash-free, splash → translator                               | `adb install -r` both APKs; `adb logcat -d                                       | grep -iE 'AndroidRuntime | FATAL'` |
| 2   | First-run restore: theme, direction, draft, archive survive force-stop                   | seed via UI, `adb shell am force-stop`, relaunch, assert                         |
| 3   | Rotation keeps WebView alive (configChanges)                                             | `adb shell settings put system user_rotation 1` + back                           |
| 4   | RTL layout with Arabic UI (dir/lang before paint)                                        | UI locale switch + `dumpsys`/screenshot                                          |
| 5   | Keyboard/IME resize regression **on API 35** (not the API-29 condition of the 1.0.2 fix) | open composer, `adb shell input text`, `dumpsys window` height + no reload/crash |
| 6   | Back order: overlay → keyboard → destination → exit                                      | `adb shell input keyevent 4` sequence                                            |
| 7   | SAF export/import round-trip (DocumentsUI)                                               | UI flow, then `run-as` DB row count                                              |
| 8   | Dictation permission grant/deny and graceful denial                                      | `adb shell pm grant/revoke` + UI                                                 |
| 9   | Device TTS path (Google TTS on image)                                                    | speak a settled result; check no silent failure                                  |
| 10  | Airplane mode → calm error, no data loss                                                 | `adb shell svc wifi disable` / `cmd connectivity airplane-mode enable`           |
| 11  | **Release APK** (R8) install and same journeys as debug                                  | §7.1 #1-10 on `app-release.apk`                                                  |
| 12  | No backup leak (allowBackup=false / dataExtractionRules)                                 | `adb backup` attempt refused / `dumpsys` flags                                   |
| 13  | API 37 forward-compat (after starting that AVD)                                          | repeat #1-6 on `api37_google_apis`                                               |

### 7.2 What CANNOT be verified here

| Not verifiable                                                                      | Why                                                                        |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| The 1.0.2 keyboard fix's actual condition (Android 10/API 29 + WebView 140+)        | No API 29 system image; running emulator is API 35 with WebView 124        |
| minSdk 24 floor (Android 7.0) and Android 7–9 WebView behaviour                     | No API 24 image; docs' own risk list (`device-compatibility.md:37-42`)     |
| Physical OEM devices, Samsung/Xiaomi IMEs, cutouts/safe-area, foldables/tablets     | Emulator only                                                              |
| Real device TTS voices per OEM, missing-engine behaviour, Arabic voice availability | Emulator has Google TTS only                                               |
| 1.0.1→1.0.2 in-place upgrade and Room migration on real user data                   | No retained 1.0.1 APK; different debug keystores (A7-05)                   |
| Play Store upload/update/signing, Play App Signing, staged rollout                  | Debug-signed artifact; not publishable (TD18)                              |
| Performance/battery/memory on 2 GB devices, doze, 10-minute runs                    | No physical device/profiling (TD9/TD12)                                    |
| Provider quality/latency/failure in production                                      | No keys, external service; device path depends on `https://fluently.today` |
| Local-server E2E (deterministic backend)                                            | Manifest/network config blocks cleartext in all variants (A7-12)           |
| Byte-reproducible APK match to documented hashes                                    | Different host; digests differ (§4)                                        |

---

## 8. Reproducible release checklist (proposed, replaces the prose in `build-and-release.md:84-94`)

1. **Commit** the `gradle.properties` locale pin (A7-06), the toolchain-path correction and the
   `@capacitor/android` exact pin + `patch-package --error-on-warn` (A7-07); merge duplicate
   `org.gradle.jvmargs`.
2. `npm ci` (asserts the patch applies; now fails loudly), then
   `npm run verify` (typecheck, lint 0 warnings, vitest 4 floors, contrast, docs).
3. `npm run build` + `node scripts/check-pwa.mjs` (web release only) and
   `npm run build:native:web` + `npx cap sync android`.
4. `cd android && ./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleRelease`.
5. Run `node scripts/verify-apk.mjs` (new): apksigner v2/v3 + signer DN, SHA-256, aapt2 badging assertions
   (package ids, versionCode/versionName, min/target SDK, permission set, `assets/public/index.html`),
   packaged-asset secret scan, and **refuse debug-signed release** unless explicitly allowed.
6. Publish `SHA256SUMS` + signer report + release notes (risks/unverified list) with the artifact; keep both
   APKs for the next upgrade test; tag the commit (`android-<versionName>`).
7. Device matrix (§7.1) on **both** debug and release APKs, plus §7.2 items recorded as NOT_VERIFIED.
8. Upgrade test: install previous release, seed data, install this one with `adb install -r`, assert data
   survives (requires step 6 to have retained N-1).
9. `npm run check:docs` green _after_ updating `DOCUMENTATION_INDEX.md` for new audit docs (A7-16).
10. Leave the connected branch working; no history rewrite (AGENTS.md:64).

---

## 9. Highest-priority actions (for the Lead)

1. **Unblock the build from a clean checkout (P1):** commit the `android/gradle.properties` locale fix
   (`-Duser.language=en -Duser.country=US` on both Gradle and Kotlin daemons), correct the toolchain paths
   in `docs/android/build-and-release.md:8-32`, and add an Arabic-locale CI compile check. Without this the
   release is not reproducible on this machine.
2. **Run and record the device matrix now (P1):** emulator `emulator-5554` is API 35 with the debug build
   already installed; verify debug **and release** APKs (§7.1), run the upgrade test if a 1.0.1 artifact can
   be recovered, then update `docs/android/build-and-release.md:3-4`, `device-compatibility.md:3-5`,
   `testing.md:29-30` and close/re-scope **TD17** with model/API/WebView evidence.
3. **Add the Android CI job and fix the instrumented layer (P1):** rewrite/delete
   `ExampleInstrumentedTest.java` (it asserts `com.getcapacitor.app`), add a real bridge/DB instrumented
   test and an Espresso smoke; run `testDebugUnitTest`, `assembleDebug/Release`, `lintDebug` and the APK
   verifier in CI (A7-01/A7-02/A7-03/A7-13).
4. **Make release verification executable and honest (P1/P2):** add `scripts/verify-apk.mjs`, fail on
   debug-signed release, attach `SHA256SUMS`+signer report+release notes per version, and stop publishing
   volatile hashes in durable docs (they are already wrong for this build) — A7-09/A7-10/A7-11.
5. **Harden the Capacitor patch and prove the 1.0.2 fix (P1):** pin exact `@capacitor/android`, use
   `patch-package --error-on-warn`, assert the patched marker in CI, and script the IME check on an API 29
   AVD (no API 29 image currently installed) — A7-07/A7-08.
6. **Strengthen migration protection and fix the docs gate (P1/P2):** export `1.json` and use
   `MigrationTestHelper` with production `open()`, insert `saved_phrases` rows, add a
   "schema version bump requires migration+test" CI check (A7-04); and add the seven
   `docs/audits/android-team/*.md` files to `DOCUMENTATION_INDEX.md` before running `npm run verify`,
   otherwise `check:docs` fails (A7-16).

---

## 10. Appendix — commands executed and limitations

Key read-only evidence commands (all from the repo root unless stated):

```text
git branch --show-current; git status --porcelain; git log --oneline -12; git tag --list
git show --stat --format='%h %s' c897209 e31c6d3 5da6e3a
git show HEAD:android/gradle.properties | grep -n 'jvmargs|user.language'
git diff android/gradle.properties
find src -name '*.test.ts' -o -name '*.test.tsx' | wc -l            # 61
grep -rc '@Test' android/app/src/{test,androidTest}                 # 10 total (9 unit + 1 instrumented)
python3 -c "import playwright"                                      # ModuleNotFoundError
adb devices -l; adb -s emulator-5554 emu avd name                   # almani
adb -s emulator-5554 shell getprop ro.build.version.sdk             # 35
adb -s emulator-5554 shell dumpsys webviewupdate | grep Current     # 124.0.6367.219
adb -s emulator-5554 shell dumpsys package today.fluently.app.debug # versionCode 3, 1.0.2-debug, installed 18:17:31
<SDK>/build-tools/36.0.0/apksigner verify --verbose --print-certs <apk>
<SDK>/build-tools/36.0.0/aapt2 dump badging <apk>
shasum -a 256 <apk>; unzip -l <apk>; unzip -p <apk> 'assets/public/*' | grep -aoE '<key patterns>'
grep -n 'padForIme' node_modules/@capacitor/android/.../SystemBars.java
node scripts/check-docs.mjs                                          # exit 1: audit report not indexed (A7-16)
```

Limitations:

- This audit did not run `npm run verify`, `vitest`, or any `./gradlew` task, and did not install, launch or
  mutate the emulator; those were reserved for the Lead's centrally-managed build. Runtime journeys, the
  release-APK install, upgrade path and provider-backed translation remain **NOT_VERIFIED**.
- The verified APKs were built from a working tree containing the uncommitted
  `android/gradle.properties` change; digests therefore do not correspond to a pristine `c897209` checkout.
- Hashes/certificate values are point-in-time for this build and are intentionally not presented as a
  durable manifest.
