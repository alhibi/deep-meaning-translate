# Round 8 — deep analysis and fixes (2026-11-18)

Scope: user reports (storage shrinking, reload-like overlay, translation only after Enter), the
GitHub-version question, dependency freshness, and native-integration quality. Device: HONOR
PNM-N49, Android 17/API 37. All device evidence in `screenshots/`.

## 1. Was the tested build the latest GitHub main? — No; now it is

Before this round: the working tree was local `3cf511e` (one unpushed commit) while
`origin/main` was `136a171` (Codebuff commit, 2026-11-18 15:24 UTC). The APK tested in earlier
rounds was therefore **not** the latest GitHub main.

Now: the fixes were committed (`b2b2b3f`) and `origin/main` was merged (`d25b717`), so HEAD
contains `136a171`; `git rev-list --left-right --count origin/main...HEAD` = `0 3` (nothing
behind, three commits to push). The merged tree was rebuilt, tested and installed.

## 2. BUG-04 — translation waited for the keyboard Enter

**Reproduced on the phone:** typing `مرحبا` with the real Arabic keyboard left the result area at
`ستظهر ترجمتك هنا` indefinitely; pressing the keyboard Enter made the translation appear
(`screenshots/50`/`51`, a11y dumps).

**Root cause (CDP on the debug build):** `captureInput: true` in `capacitor.config.ts` made
Capacitor replace the WebView `InputConnection` with a plain `BaseInputConnection`. With it,
IME taps changed `textarea.value` from empty to `مرحبا` while the document received **zero**
`keydown`/`beforeinput`/`input`/`composition*` events (`window.__ev` stayed at the previous
Backspace events). React therefore never learned the draft; only the Enter keydown reached the
page and the Enter handler submitted the field value.

**Fix:** `captureInput: false` (one config line; comment explains why). The later CDP run showed
normal `keydown`/`beforeinput`/`input` events for every Arabic letter and the translation became
ready without touching Enter. Verified on the release APK too: `screenshots/56-merged-typed.png`
and `57-merged-translated.png` (translation ready after idle, no Enter).

A short focused poll was prototyped as a fallback and removed once the config fix proved to be the
real cause; the no-polling contract in `AGENTS.md` stands. Contract test:
`src/lib/native/shell-contracts.test.ts` asserts `captureInput: false`.

## 3. STORAGE-01 — the local archive was capped at 2,000 rows (statistics changed)

**What deleted rows:** `LinguaRepository.historyUpsert` and the import path called
`db.history().trim(HISTORY_LIMIT)` on every write; `history.ts` also called `historyTrim(2000)`,
`history.count()` was clamped to 2,000, `history.all()` sliced to 2,000, and the phrasebook was
capped at 300. Because Statistics is derived from the archive, trimming old rows silently changed
every count/timeline.

**Fix:**

- Room archive is **unlimited**: all trim calls and the trim bridge API (`historyTrim`, DAO,
  plugin method, JS port method) are removed. Contract test asserts the repository never calls
  `history().trim(`.
- `history.all()` reads the full archive once via `historyAll()`, caches it (`fullArchive`), and
  patches that snapshot on add/retag/remove/clear so Statistics does not refetch or lose rows.
  The translator window stays at 500 rows; counting is no longer clamped.
- Phrasebook and backup export/import are uncapped **on the device**; the browser fallback keeps
  its storage-quota caps (`historyCap()`/`savedCap()`).
- Translation memory stays bounded (120 rows/200 KB, 30-day TTL) because it is a cache, not the
  archive; that decision is unchanged and documented in `AGENTS.md`.

Verification: unit tests (`history.native.test.ts`, `history.test.ts`, storage tests) pass; full
suite 1,330 tests pass; Statistics on the phone shows the whole archive (16 translations / 995
words, `screenshots/55-stats-fixed.png`). A >2,000-row device test was not run (would need
synthetic rows on a retail device); the absence of every trim path is code- and test-verified.

## 4. OVERLAY-01 — reload-like overlay and delay

The app has no in-app 'reload' overlay; the closest mechanism is the native splash + boot cover.
The likely trigger is an **Activity recreation replaying the splash and WebView load** when a
configuration change not listed in `android:configChanges` happens (font size / font weight /
colour mode / permission change). Verified contributing facts: `fontScale` was not in
`configChanges`, and the splash plugin shows on every `onCreate`.

**Change applied:** added `fontScale|fontWeightAdjustment|colorMode` to `configChanges` so a
font-size change no longer recreates the activity and replays the launch cover. Permission-change
kills (Android `PERMISSION CHANGE`) still reload the process — that is OS behaviour.

Also recorded as open debt: the launch splash/window colour is hard-coded clay `#12100F`, so a
light-theme user sees a dark cover at every cold start (TD63).

## 5. Native integration audit — applied vs documented

An independent read-only audit of the Capacitor shell (device-verified values: WebView 159,
edge-to-edge enforced, safe-area top 44 px, keyboard resize 573 px) produced the following.

Applied now:

- P0 `captureInput: false` (section 2).
- `fontScale`/`colourMode` config changes (section 4).
- Removed dead `Keyboard.resize`/`resizeOnFullScreen` config (SystemBars owns IME insets; the
  real fix is the patch) and documented that.
- Declared `VIBRATE` in the repo manifest instead of relying on `@capacitor/haptics`' manifest.
- Themes with no saved preference now follow the phone (`matchMedia`) in the native boot too, and
  a live system-theme change is honoured while no explicit theme is saved.

Recorded as debt (TD61–TD69 in `docs/audits/technical-debt.md`), not silently claimed fixed:
foldable large-screen layout (the portrait lock is ignored at sw ≥ 600 dp on target 36),
predictive back, splash colour, the unused `@capacitor/status-bar` plugin fighting `SystemBars`
after a configuration change, MagicOS kill durability window, TTS first-tap/audio focus, sheet
safe areas, Kotlin/Gradle support window.

## 6. Dependencies and toolchain

Applied (security/support, low risk):

| Item | Before | After | Why |
| --- | --- | --- | --- |
| eslint | 10.13.0 | **10.15.0** | npm advisory range 10.0.0-alpha–10.14.0 |
| typescript-eslint | 8.72.0 | **8.73.0** | advisory range ≤8.72.2 |
| Gradle wrapper | 8.14.3 | **8.14.7** | Gradle security advisories (critical/high) |
| AGP | 8.13.0 | **8.13.2** | patch; bundles R8 8.13.19 |

Full lint, typecheck and test suite pass after the bumps; release build succeeds.

Deliberately **not** applied now (documented in TD69): Kotlin 2.1.21 → 2.3.21 + KSP 2.3.14. The
current Kotlin is outside the officially supported window for Gradle 8.14/AGP 8.13, but moving it
requires the coupled KSP/Room change and a full device regression pass; it is the next toolchain
task. TanStack versions stay as one coupled set; Vite/Vitest/patch bumps are unneeded churn.

## 7. Build environment problem (not app code)

A desktop cloud-sync service keeps recreating files like `config 3.xml`, `values 2.xml` inside
`android/` and `node_modules/`, which repeatedly failed Gradle with `Duplicate resources` /
`' ' is not a valid file-based resource name`. A cleanup script
(`scripts/clean-sync-duplicates.mjs`, wired as `prebuild:native:web`) removes them before a native
build. Recommendation: exclude `node_modules`, `android/build`, `android/.gradle`, `.output` and
`reports` from the sync service.

## 8. Artifact and device state

| Item | Value |
| --- | --- |
| Installed APK | `artifacts/today-1.0.8-review-r8-candidate4-merged.apk` |
| SHA-256 | `b1a16a31dd627dadd8ae150b63080cce63b3237057a55f78a6d26c7f2c388f2e` |
| Signing | debug keystore (review build, not publishable — TD18) |
| Git | HEAD `d25b717` contains `origin/main 136a171`; 3 commits ahead, 0 behind |
| Data | installed with `-r`; `firstInstallTime` unchanged (2026-11-16 20:42:46) |
| Phone state | Arabic UI, dark theme, launcher after the pass; no uninstall/clear |

## 9. Still open / not verified

- The user should confirm the reload-like overlay is gone after the configChanges fix; a screen
  recording of the exact moment would let us prove it.
- Foldable adaptive layout, predictive back, splash colour, status-bar plugin cleanup, MagicOS
  kill durability, TTS polish, sheet safe areas (TD61–TD68).
- Archive above 2,000 rows was not exercised on hardware.
- Kotlin 2.3/KSP 2.3 upgrade not applied (TD69).
