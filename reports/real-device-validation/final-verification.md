# Final verification — objective close-out (2026-11-18)

This file maps every objective item to its implementation and to the evidence produced on the
HONOR PNM-N49 (Android 17 / API 37). Status words follow `docs/quality/testing.md`
(VERIFIED / OBSERVED / NOT_VERIFIED).

## Item 1 — unlimited local storage; statistics never lose rows

- Code: native Room archive has no trim path (DAO trim, repository trim, bridge method and the JS
  port removed); `history.all()` caches the full archive and patches it on writes; phrasebook and
  backup export/import are uncapped on the device (browser keeps its quota cap).
- Tests: `history.native.test.ts`, `history.test.ts`, Kotlin `RepositoryTest` (new regression test),
  and `src/lib/native/shell-contracts.test.ts` (asserts no `history().trim(`).
- Device: on `emulator-5556` with a root-injected archive, 2,107 rows survived launch, a new
  translation made it 2,108, and the oldest row `bulk-0` was still present
  (`logs/large-archive-test.txt`).
- **Status: VERIFIED** (emulator with injected archive). The retail phone path has no trim call;
  injecting 2,000+ rows on the phone itself was not done.

## Item 2 — no reload-like overlay / flash / delay

- Code: `fontScale|fontWeightAdjustment|colorMode` added to `configChanges` so a configuration
  change no longer recreates the activity (which replayed the splash and reloaded the WebView).
  Launch surfaces now use day/night resources (`splash_background`: paper on light phones, clay on
  dark).
- Device: changing `font_scale` to 1.3 while the app was open kept the same PID (23663) and the same
  ActivityRecord, with the draft intact and no splash replay.
- Recording: an 11.8 s screen capture shows only the expected Android launch splash (~0.4–0.5 s)
  then the translator; no white flash, no second cover, no repeated reload; Home does not replay it
  (`videos/launch-2026-11-18.mp4` + contact sheet, `logs/launch-and-durability-2026-11-18.txt`).
- **Status: VERIFIED** for configuration-change recreation and cold-start behaviour. The owner's
  visual confirmation is still useful if they saw a different moment.

## Item 3 — automatic translation without pressing Enter

- Root cause found with CDP on the debug build: `captureInput: true` made Capacitor replace the
  WebView InputConnection, so Arabic/German IME taps changed the textarea value with **zero** input
  events; only Enter reached the page.
- Fix: `captureInput: false` (contract test guards it). After the fix the CDP timeline showed normal
  `keydown/beforeinput/input` events per letter, and on release builds an Arabic word translated
  automatically without Enter (`screenshots/56-merged-typed.png`, `57-merged-translated.png`, plus
  repeated smoke tests through rounds 12–13).
- **Status: VERIFIED on the phone.**

## Item 4 — repository matches the latest GitHub main

- `origin/main` was `136a171` while the earlier tested build came from `3cf511e` (local). The fixes
  were committed and `136a171` merged (`d25b717`); HEAD is now `66954b6` with
  `git rev-list --left-right --count origin/main...HEAD` = **`0 7`** (nothing behind, seven local
  commits).
- **Status: VERIFIED** (tree contains upstream). **Not pushed**: publishing the connected Lovable
  branch is left to the owner.

## Item 5 — dependencies / languages updated where needed

| Component | Result |
| --- | --- |
| eslint 10.15.0, typescript-eslint 8.73.0 | security advisories fixed |
| Gradle 8.14.7 | security fixes; matches AGP 8.13 |
| AGP 8.13.2 | R8 8.13.19, required for Kotlin 2.3 |
| Kotlin 2.3.21 + KSP 2.3.14 | replaces an unsupported 2.1.21 pair; builds/tests pass |
| Room 2.7.2 | kept; KSP2 codegen verified |

Final gate: `npm run verify` = **exit 0** (tsc, eslint --max-warnings 0, vitest + coverage floors,
51 contrast pairs, docs inventory, cultural-content security gate).
- **Status: VERIFIED.**

## Item 6 — native integration with the phone

| Area | Evidence | Status |
| --- | --- | --- |
| Edge-to-edge / cutout | live safe-area insets, screenshots in earlier rounds | VERIFIED |
| Status/navigation bars | `@capacitor/status-bar` removed; light theme keeps dark icons after unfolding (`59-light-bars.png`, `60-light-unfolded.png`) | VERIFIED |
| Keyboard | IME resize verified (window 573 px), composition events restored | VERIFIED |
| Launch/splash | day/night resources in the APK (`#F6F3ED` / `#12100F`) | VERIFIED |
| Foldable | folded + unfolded inner display (2172x2352) render, no crash; portrait lock is ignored at sw≥600 dp (documented TD61) | OBSERVED / debt |
| Haptics | explicit `VIBRATE` in the manifest; feel façade works (was already wired) | OBSERVED |
| Predictive back | not implemented; opt-out documented as temporary (TD62) | debt |
| TTS | readiness retry + audio focus implemented; device uses cloud voice first so the native path was not exercised (NOT_VERIFIED on hardware) | PARTIAL |

## Release artifact

- `artifacts/today-1.0.8-review-r8-candidate7-kotlin23.apk`
- SHA-256 `d149bf07609050e97af17936a75a43de25479a70a340c576780183c935cad46e`
- The APK pulled back from the phone has the **same** SHA-256; `install -r` preserved data
  (`firstInstallTime` 2026-11-16 20:42:46).
- Signature: debug keystore — a non-publishable review build (TD18).

## Residual debt (documented, not hidden)

TD61 adaptive foldable composition, TD62 predictive back, TD63 splash vs explicit app theme,
TD64 (done), TD65 durability window (not reproduced; kept under observation), TD66 dead native
config, TD67 TTS native path hardware verification, TD68 sheet safe areas, TD69 (done).

## Next actions for the owner

1. Confirm the overlay is gone (or send a recording of the moment it re-appears).
2. Decide whether to push the seven local commits to GitHub / Lovable.
3. Decide on the adaptive inner-display design (two-pane/tabletop) before targetSdk 37.
4. Optionally force the native TTS path (no cloud key / offline) to verify TD67 on hardware.
