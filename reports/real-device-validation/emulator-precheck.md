# Emulator pre-check (NOT device evidence)

Status: **PRE-CHECK ONLY** — no acceptance gate is advanced by this file. The protocol requires the
physical HONOR phone; the emulator is used here solely to de-risk the R8 release candidate before
the phone becomes reachable. It is **not** a substitute and is never reported as device proof.

## Environment

| Item | Value |
| --- | --- |
| AVD | `almani` (Pixel 7 profile, API 35, arm64-v8a, 2 GB) |
| Emulator | 37.2.12.0, headless, swiftshader_indirect |
| WebView | 124.0.6367.219 |
| APK | `artifacts/today-1.0.8-review-r8-candidate1.apk` (release, R8, debug-signed review) |

## What was executed and observed

| Check | Observation | Artefact |
| --- | --- | --- |
| Install | `adb install -r` → **Success**; versionCode 9 / versionName 1.0.8; previous app data preserved (`firstInstallTime` 2026-11-16) | `logs/emulator-precheck/launch-timing.txt` |
| Cold launch | Status ok, COLD, TotalTime 3059 ms (swiftshader; not a device number) | same |
| Previous session restore | translator opened with the earlier draft `Hallo` and its saved result, no intro replay | `screenshots/emulator/01-first-launch.png` |
| Real translation (release/R8) | typed `Guten Morgen` → streamed and settled **`صباح الخير`**, source auto-detected `Deutsch`, writer **Velo**; Copy/voice/save/dictionary actions appeared | `screenshots/emulator/03-translated.png` |
| Keyboard insets | result and actions stayed above the on-screen keyboard; no overlap | same |
| Back | first Back hid the keyboard (`mInputShown=false`), app stayed | `screenshots/emulator/04-after-back.png` |
| Process kill + relaunch | `am force-stop` then cold start 2268 ms; draft **and** settled result restored offline | `screenshots/emulator/05-restored-after-kill.png` |
| Native bridge under R8 | Room DB written by `LinguaStore`: `session_state` holds the new sentence, `history_entries`=2, `memory_rows`=1 | `logs/emulator-precheck/room-db-evidence.txt` |
| Stability | no `FATAL`/`AndroidRuntime` entry in the app process log; only expected WebView cache warnings; Capacitor bridge + TTS bound | `logs/emulator-precheck/logcat-app.txt` |

## Limitations found (important for the device pass)

- The **release** build disables WebView remote debugging (by design), so CDP cannot be used to
  inspect the DOM on the release artefact; `uiautomator dump` only exposes the WebView container.
  Device evidence therefore has to come from screenshots, logcat, Room pulls and UI automation by
  coordinates — or the debug build has to be used for DOM-level checks, labelled separately.
- Emulator performance numbers (launch, frames) are not transferable to the phone.
- The emulator has no real modem/IME/mic; dictation, real Arabic IME and OEM power management
  remain untested until the phone is reachable.

## Verdict

The release/R8 candidate installs, boots, restores native data, performs a real network
translation and writes Room rows — so the artefact is worth installing on the phone unchanged.
No code was modified in this pre-check. **Device gates remain BLOCKED (A) / NOT TESTED (B–H).**
