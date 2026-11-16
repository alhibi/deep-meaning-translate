# Final independent review — Android 1.0.3 (1.0.3 / versionCode 4)

Date: 2026-11-16 · Reviewer: qa-final (independent; implementation reports not trusted) · Repository:
`deep-meaning-translate`, branch `main`.

**Baseline:** commit `c5e70e2` ("Complete the Android 1.0.3 shell…"), diff
`c897209..c5e70e2` (70 files, +4501/−426). Reviewed read-only. While this review ran, two
uncommitted follow-ups appeared (late-hydrate write guard in `src/lib/persistence/native.ts` +
`platform.ts`, comment in `index.tsx`), the docs were reformatted/updated, and the APKs and hashes
were regenerated. Findings below distinguish **c5e70e2** (what a release built from the commit would
ship) from the **working tree** at 19:08 (what the refreshed APKs were built from). I wrote only this
file.

## Verdict

**PASS WITH REQUIRED FOLLOW-UPS — do not tag/release from c5e70e2 as-is; the refreshed tree is
release-consistent after the follow-ups are committed and the doc defects below are fixed. No new P0
found in the reviewed paths; one P1 data-integrity race existed in c5e70e2 and is correctly fixed in
the working tree (uncommitted at review time).** Not publishable regardless: the only release APK is
debug-signed (TD18, disclosed).

## Findings (severity · classification · evidence · fix/test)

| #   | Sev    | Class                                   | Finding                                                                                                                                                                                                                 |
| --- | ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **P1** | OBSERVED (static; fix verified in tree) | **Late-hydrate write guard was open in c5e70e2** — same A3-02 data-loss class it claims closed.                                                                                                                         |
| F2  | **P2** | VERIFIED                                | **Release-signing guard does not fail "before packaging"**; it runs after `packageRelease` produced an APK. Docs claim otherwise.                                                                                       |
| F3  | **P2** | OBSERVED                                | **Committed reports/hashes and the P1 fix are not in c5e70e2.** Release artefacts were regenerated during review; the commit still documents the pre-fix build.                                                         |
| F4  | **P2** | OBSERVED                                | **Stale/contradictory docs:** SAF import/export declared NOT_VERIFIED "no device available" while device evidence says VERIFIED; the 8 MiB import cap is Android-only but documented as general.                        |
| F5  | P3     | VERIFIED                                | Wrong counts in docs: "10 tests" (actual 13) and "16 links" (actual 15).                                                                                                                                                |
| F6  | P3     | OBSERVED                                | Back-overlay claim overstated ("any component"); stats sheets are not wired to `useAndroidBack`; listener-order comment is misleading; ordering untested.                                                               |
| F7  | P3     | OBSERVED                                | CSP `connect-src` hardcodes `https://fluently.today` while `NATIVE_API_BASE` is configurable — a configured native build would be blocked with no build-time assertion.                                                 |
| F8  | P3     | OBSERVED                                | Keyboard listener cleanup race: listeners added after a fast unmount are never removed.                                                                                                                                 |
| F9  | P3     | OBSERVED                                | `LinguaChrome` schedules uncancelled 4 s `postDelayed` repaints per theme change and accepts only `#rrggbb`; current tokens are hex, so current themes are correct.                                                     |
| F10 | P3     | SUSPECTED                               | Android CI job never executed (TD24, admitted) and `sdkmanager --install` may block on unaccepted SDK licences; it also does not build release/run instrumentation.                                                     |
| F11 | P3     | OBSERVED / NOT_VERIFIED                 | Test gaps: no TS test for fail-closed hydration or seq seeding; `resetPlatformForTests` does not reset native hydration; instrumentation results not independently reproduced (install prohibited).                     |
| F12 | P3     | OBSERVED                                | Small factual doc/code nits: manifest comment says "Two permissions" (three declared); architecture says the web adapter is never imported at runtime, but `history.ts`/`saved.ts` import it (dead branches on native). |

### F1 — P1: late hydrate reopened writes on empty caches (c5e70e2)

Evidence: in the commit, `src/lib/persistence/native.ts:90` set `hydrated = true` inside
`nativePort.hydrate()` — i.e. **before** `hydratePlatform()` applied the snapshot.
`src/lib/platform.ts:85` wraps the hydrate in `withBootTimeout(..., 3000)`; on timeout the catch at
`:101-106` sets `nativeReady` false but does not cancel or ignore the still-pending hydrate. If the
bridge answers after 3 s, `hydrate()` resolves, flips `hydrated`, and native Room writes become
allowed while `history`/`saved`/`memory` caches were never hydrated. `saved.ts:22-25` /
`translation/memory.ts:51-55` then read `[]` on native, and whole-table writes
(`LinguaRepository.kt:129-141`: `db.saved().clear()` / `db.memory().clear()` then upsert) would
erase the phrasebook/memory on the next save. That is exactly the A3-02/P0-3 failure mode the commit
claims fixed, and it contradicts `AGENTS.md` ("closed until a complete snapshot is applied"),
`docs/android/architecture.md:84-90` and `persistence-and-migrations.md:117-119`.

Working-tree fix (verified by reading, not by tests): `markNativeHydrated()` is now exported
(`native.ts:54-55`), called only after `setNativeSettingsReady(true)` in `platform.ts` (boot success
and `rehydrateDeviceData`); `hydrate()` no longer sets the flag. A hydrate that loses the race can no
longer open writes. **Required:** commit this follow-up and add a regression test (fake slow bridge
resolving after the boot timeout → phrasebook/memory write must be refused / must not clear storage);
also add `resetPlatformForTests` coverage for the hydration flag. Without the commit, a rebuild from
`c5e70e2` reintroduces silent data loss.

### F2 — P2: release guard runs after packaging

`android/app/build.gradle.kts:126-140` attaches `doFirst` to tasks named `assembleRelease`/
`bundleRelease`. Gradle executes dependencies first: `./gradlew :app:assembleRelease --dry-run` printed
`:app:packageRelease` (line 398) before `:app:assembleRelease` (line 400), so with no signing config
AGP packages `app-release-unsigned.apk`, then the guard throws. Docs `docs/android/build-and-release.md:38-40`
say it "**fails before packaging**" and the guard comment says "Fail before packaging"; both are false.
The build still fails closed (no successfully signed artefact), and `-PallowDebugSigning=true` is
warned, but the claim is unsafe if a future signing config is partially present. **Fix:** attach the
check to `packageRelease`/`packageReleaseBundle` (or fail in configuration when a release task is
requested), and add a test asserting `outputs/apk/release` is absent after the failed command.

### F3 — P2: commit vs refreshed artefacts

At review start the artefacts matched the commit's documented hashes
(`29bf0626…` debug / `a5c75769…` release) and the commit's reports. During review the tree was
refreshed: artefacts now hash `a1a737fbab4c30caf6c3536a216333823689b3ce4f3035cec2033c8e4762e0e6`
(6 549 961 B) and `57b4ce52c1f0b2e10ad051480e4a6deccae9eaaaea85ad89782e88d5ba126119` (2 173 405 B); they
verify, match the updated `SHA256SUMS.txt`/`ANDROID_RELEASE_REPORT.md`/`build-and-release.md`, and the
APK's `assets/public/assets/index-CkQ4qD2S.js` is byte-identical to the `android-web/` build of the
current tree. So the refreshed pair is consistent — but it is **not** what c5e70e2 says shipped. Commit
the source follow-ups + docs + new hashes together (and rebuild once more if any source changes), otherwise
a tag on c5e70e2 ships the F1 race and stale evidence.

### F4 — P2: stale/contradictory docs

- `docs/android/data-import-export.md:3-4`: "On-device SAF interaction is **NOT_VERIFIED** (no device
  available)" contradicts `docs/android/device-compatibility.md:32-34` and `ANDROID_TEST_EVIDENCE.md`
  (SAF export/import, tampered file and `pm clear` restore all **VERIFIED** on emulator-5554).
- `data-import-export.md:83,90` and the "8 MiB" refusal row read as general, but the cap exists only in
  `BackupReader.kt:22-25` (Android). The web path `DataControls.tsx:236-247` does `file.text()` with no
  size/byte check and `parseBackup()` has no cap. **Fix:** scope the claim to Android or add a web
  `file.size` guard (and a test); correct the status header.

### F6 — P3: back coverage/ordering

`docs/android/architecture.md:98` claims "open overlay/sheet (any component) → close it", but
`useAndroidBack` is wired only in `LanguageSheet.tsx:131` and `VoiceSheet.tsx:48`; stats sheets
(`src/components/stats/FilterSheet.tsx:79`, `DetailSheet.tsx:84`, `RecordSheet.tsx:53`) are not wired
(pressing back on /stats navigates to the translator, which unmounts the sheet — not "close it").
The `useAndroidBack.ts:6-9` comment claims listeners run child-before-route; in fact the route listener
is registered first and sheets later — it works only because `dispatchBack()` checks
`defaultPrevented` after dispatching to all listeners, which no test covers. When a sheet contains a
focused search input, the route handler claims first (blur) and the sheet then also closes — both actions
from one press. Acceptable UX, but the doc/test should match reality.

### F7 — P3: CSP vs configurable API base

`scripts/prepare-native-web.mjs:35` fixes `connect-src` to `https://fluently.today`; `vite.native.config.ts:12`
allows `NATIVE_API_BASE` to point elsewhere, and `src/lib/native/config.ts:29-48` accepts it. A build
with a different base would have every API/WebSocket call blocked by the APK CSP, with no gate or test
noticing. **Fix:** generate the CSP from the same `apiBase` value and assert it in CI; or remove the
override.

### F8/F9/F10/F11/F12

- F8: `src/routes/index.tsx:424-446` — cleanup sets `disposed` and removes `handles`, but if unmount
  happens before the `addListener` promises resolve, `handles` is assigned after cleanup and the native
  listeners leak. App-lifetime component → low impact. Fix: after each await, if `disposed`, call
  `handle.remove()` and return.
- F9: `LinguaChromePlugin.kt:51-55` posts an uncancelled 4 s repaint per call (theme toggles stack
  timers; harmless because each applies latest `lastColor`), and `hex` is `#rrggbb`-only
  (`:22`). Current `--background` tokens are hex (`styles.css:69,121,186`), so current themes are
  VERIFIED; a future token format silently disables the strip.
- F10: `ci.yml:74-77` uses `sdkmanager --install` without an explicit licence accept
  (`android-actions/setup-android` may not pre-accept; SUSPECTED hang) and the job was never executed
  on GitHub (TD24, admitted). It assembles debug only — no release/instrumentation gate.
- F11: no TS test exercises `storage-unavailable` fail-closed or `sessionSeq` seeding; the only
  evidence is device observation in the team's report. `resetPlatformForTests()` clears
  `nativeReady` but not the native module's `hydrated` flag. `connectedDebugAndroidTest` was **not**
  run here (task forbids install/uninstall); the 3 tests exist and look sound in source, but the
  "3 passed / 8.7 s" claim is NOT_VERIFIED by this review.
- F12: `AndroidManifest.xml:4-8` comment still says "Two permissions"; `docs/android/architecture.md:84-86`
  says the web adapter "is not imported at runtime, only type-shared", but `src/lib/history.ts:11` and
  `src/lib/saved.ts:10` import `persistence/web` unconditionally (branches are dead on native, no dual
  write).

## What I VERIFIED positively

- **Plugin-proxy/thenable fix is correct.** Read `node_modules/@capacitor/core/dist/capacitor.js`:
  `registerPlugin` proxies every property, including `then`, to a method that throws
  `"<Plugin>.<method>()" is not implemented on android`; `asNonThenable` (`src/lib/native/plugin.ts:104-111`)
  hides only `then` and forwards real methods, is applied to all four plugins including `LinguaTts`
  (`src/lib/native/tts.ts:27`), and `plugin.test.ts` proves resolution does not assimilate while
  `boot()` still works. No plugin defines a real method named `then`. Residual: a future plugin method
  named `then` would be hidden.
- **Session Long decode / seq guard:** `PluginCall.getDouble` returns the default for `Long`
  (`PluginCall.java:238-260`), `getLong` accepts it (`:191-206`); `sessionWrite`/`historyCandidates`
  now use `getLong`; `putSession` rejects `seq <= 0`; `boot()` returns `sessionSeq` and
  `native.ts:77` seeds the next stamp. This matches the reported defect. (Not independently run on device.)
- **Security hardening:** `gate.server.ts` exact allowlist, dev origin only when
  `NODE_ENV` is development/test, no wildcard, preflight 204/403, generic 502 (10 test cases pass);
  `repair/lexicon/shadow` bodies are bounded before schema/admission and every native route uses the
  shared bounded handlers; CSP meta is present in the packaged shell and API keys absent from
  `assets/public`; manifest `allowBackup=false`, `usesCleartextTraffic=false`, system trust anchors,
  no FileProvider, portrait lock, `MODIFY_AUDIO_SETTINGS` added.
- **Artefacts (refreshed pair):** both verify with APK Signature Scheme v2 only, `CN=Android Debug`;
  packages `today.fluently.app(.debug)`, versionCode 4, versionName 1.0.3(-debug), minSdk 24,
  target/compileSdk 36; permissions exactly INTERNET, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, VIBRATE(+debug
  dynamic receiver); `webContentsDebuggingEnabled=false`; CSP present; no provider-key pattern in app
  assets; `FileProvider` absent. Pre-refresh artefacts (committed hashes) had the same properties.
- `android/app/schemas/today.fluently.app.data.LinguaDatabase/2.json` is committed.

## Commands run (all read-only; no source/artefact modification by me)

| Command                                                                                    | Result                                                                                                         |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `git show --stat c5e70e2`; `git diff --name-status c897209..c5e70e2`                       | 70 files as reported                                                                                           |
| `npm run verify` (typecheck, eslint `--max-warnings 0`, vitest + coverage, contrast, docs) | **EXIT 0**; 65 files / 376 passed / 4 skipped; contrast 51/51; docs green                                      |
| `npx tsc --noEmit` after the follow-ups                                                    | **EXIT 0**                                                                                                     |
| `node scripts/check-docs.mjs`                                                              | **50 documents, 15 relative links, all indexed** (not 16)                                                      |
| `./gradlew :app:testDebugUnitTest`                                                         | **BUILD SUCCESSFUL**; XML: BackupReader 3, Migration 3, Repository 7 = **13 passed**, 0 failed                 |
| `./gradlew :app:assembleRelease --dry-run`                                                 | `:app:packageRelease` precedes `:app:assembleRelease` (F2 evidence)                                            |
| `apksigner verify --verbose --print-certs` both APKs (before and after refresh)            | v2 true, v1/v3 false, CN=Android Debug                                                                         |
| `aapt2 dump badging` / `dump xmltree`                                                      | packages/versions/SDK/permissions above, `allowBackup=false`, cleartext off, provider list has no FileProvider |
| `sha256sum` artefacts vs `SHA256SUMS.txt`/reports                                          | match (new `a1a737…`/`57b4ce…`; commit-time `29bf…`/`a5c…` matched earlier)                                    |
| `unzip -p` APK assets                                                                      | CSP meta, config debug flag false, no key patterns, APK bundle byte-identical to current `android-web`         |

Not run (deliberately): `connectedDebugAndroidTest`, `assembleRelease` execution, any install/uninstall
or push; no APK/screenshot visual inspection beyond the byte checks above. No source edits by me.

## Residual risk / NOT_VERIFIED

- **NOT_VERIFIED:** instrumentation results, R8 release-APK runtime behaviour, API 24–29/OEM
  keyboards/foldables, real dictation/TTS, TLS, battery/performance (TD17/TD21/TD23/TD25/TD28);
  the team's device matrix is taken on trust.
- **TD18:** review APK is debug-signed; not publishable/upgrade-safe.
- **TD24:** Android CI never ran on GitHub; the job also lacks licence-accept and release/instrumentation
  coverage.
- Refreshed artefacts must be rebuilt exactly once from the final committed tree and their hashes
  re-recorded; if any further source change lands, all hashes/screenshots/evidence must be regenerated.
- The docs in `docs/audits/android-team/01–07` record pre-fix findings; they are not updated to mark
  each finding's closure except through `ANDROID_GAP_ANALYSIS.md`. That is acceptable as history, but
  the stale statements in `docs/android/*` (F4/F5) are user-facing and should be corrected.
