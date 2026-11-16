# Device compatibility

Status: **Partly device-verified** on 2026-11-16. Everything below separates what was executed
from what was only inspected. The environment had one emulator: **emulator-5554, Android 15
(API 35), arm64-v8a, 1080×2400 @ 420 dpi, WebView 124.0.6367.219, software GPU (SwiftShader)**.
No API 24/29/36 image and no physical OEM/foldable was available.

## Supported range

| Property | Value | Notes |
| --- | --- | --- |
| `minSdk` | 24 (Android 7.0) | WebView is updatable on this range; Room 2.7 and DataStore 1.1 support it |
| `targetSdk` | 36 (Android 16) | Edge-to-edge, predictive-back handling |
| `compileSdk` | 36 | Build tools 36.0.0 |
| ABI | arm64-v8a, armeabi-v7a, x86, x86_64 | Universal APK; no native translator code |
| Locales | `en`, `ar`, `de` | `resourceConfigurations` keeps the APK small; the UI itself is locale-switched in JS |
| Direction | LTR and RTL | `supportsRtl="true"`; layout follows the app locale, not the system locale |
| Orientation | **portrait, locked in 1.0.3** | One-screen portrait composition; a squeezed landscape overlapped the style row, so it is not shipped as a half-broken second layout |

## Executed on API 35 (2026-11-16)

| Area | Result | Evidence |
| --- | --- | --- |
| Install / first run | **VERIFIED** — clean install opens the intro, dismisses to the translator | emulator screenshots 01–02, `am start -W` |
| Cold start | **OBSERVED** — 1.9–2.0 s Displayed after the fixes (SwiftShader; not a hardware claim) | `am start -W`, logcat |
| Persistence | **VERIFIED** — draft + settled result + theme + archive + saved + stats survive force-stop and process kill; restored offline without a new request | screenshots 05/16/19, bridge `boot()`, Room DB pull |
| Room writes | **VERIFIED** — history/phrasebook/memory/session rows present after translation/save; `session_state.seq > 0` | SQLite inspection of pulled `lingua.db` |
| Keyboard | **VERIFIED** — composer and result stay visible above the keyboard; the keyboard stage class engages; back closes the keyboard before navigation | screenshot 08/09, layout class observation, `mInputShown=false` after back |
| Back order | **VERIFIED** — sheet → close (app stays); next back → exit; `/stats` → translator with draft intact | emulator + CDP |
| Theme | **VERIFIED** — dark → light → vivid restored after restart; system bars and window strip match; live theme switch repaints bars | screenshots 06/13/14/16 |
| RTL | **VERIFIED at the document level** — Arabic target direction, Arabic input direction, `dir` attributes; an Arabic **interface locale** was not switched on this device pass | CDP DOM; NOT_VERIFIED for full Arabic UI on device |
| SAF export | **VERIFIED** — `ACTION_CREATE_DOCUMENT` saved a valid 3.7 KB envelope in Downloads | screenshot 17, file pull + JSON/digest inspection |
| SAF import | **VERIFIED** — merge on populated data reports “already present”, full restore after `pm clear` restores history, phrasebook, memory, session and theme | screenshots 18, UI report, Room `import_meta` |
| Tampered import | **VERIFIED** — edited history + stale digest refused with the calm “damaged after export” message | emulator |
| Dictation permission | **VERIFIED** — Android microphone prompt appears; denial shows the calm message; the app keeps working | screenshot 20 |
| Dictation transcription | **NOT_VERIFIED** — the emulator audio HAL cannot record (`AudioFlinger` mismatch); no real speech path | logcat |
| TTS | **OBSERVED** — native `LinguaTts` is reached and Google TTS reports no Arabic voice on this image; the failure is currently silent (TD23) | logcat |
| Rotation | **VERIFIED (new policy)** — device rotation is ignored; the activity stays portrait and the draft is intact. Before the lock, landscape compressed the canvas and overlapped the style row | emulator |
| System bars / edge-to-edge | **VERIFIED** — light theme gets light bars + dark icons; vivid gets dark bars; the native window strip matches the canvas | screenshots 13/16 |

## Not verified here

- API 24–29: the IME/SystemBars legacy branch still pads for the IME on every API (TD21); only
  API 35 + WebView 124 was tested.
- Physical OEM keyboards (Samsung/Xiaomi/Gboard variants), screen readers, font scaling and
  cutouts on real devices.
- Foldables (Honor Magic V6 was not available): the portrait lock cuts an obvious failure mode,
  but fold/unfold continuity and sensor behaviour are unproven. Test on a physical unit.
- Tablets/large screens: the max-width layout is shown, but no tablet-specific composition was
  designed or tested.
- Real network transitions (airplane mode did not cut the emulator's virtual ethernet), TLS
  pinning/observation, real provider latency and voice quality.
- Battery/doze and long-session memory on hardware (TD9/TD25).

## Manual checklist for the next device pass

1. Install the **1.0.3 debug** APK and the **review release** APK side by side; launch both.
2. Cold start with a populated archive (2,000 rows if feasible) and measure first paint.
3. Type a long Arabic sentence and a long German sentence; open/close the keyboard; check the
   composer strip and the result scroll.
4. Force-stop, reboot the phone, re-open: draft, result, theme, locale and stats must return.
5. Open every sheet (language, model, voice, saved, dialect) and press back on each.
6. Export a password-protected backup; import it after clearing app data; verify counts and
   that the same file imported twice does not duplicate rows.
7. Grant the microphone on a real device and dictate a sentence; deny it and check the copy.
8. Switch the interface to Arabic (RTL) and repeat 3–5.
9. Test on API 24/29 if a device is available (keyboard + migration from a v1 install).
10. On a foldable, fold/unfold while typing; the portrait lock must not reset the draft.
