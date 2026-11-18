# Functional Test Results — Real Device

Device: HONOR PNM-N49, Android 17 (API 37), MagicOS 11.0.0.132. APK: `today-1.0.8-review-r8-candidate2-cspfix.apk`
(release, R8, debug-signed review build), SHA-256 `607b500f58036614e06e159e9cb22b9d6e8d900ce572413f762602b41e236e52`.
Evidence: `screenshots/`, `logs/`. Statuses: PASS / FAIL / PARTIAL / NOT TESTED.

## A. Boot, first run, navigation

| ID | Result | Evidence |
| --- | --- | --- |
| A01 Install + launch | **PASS** — `install -r` Success, versionCode 9/1.0.8, cold launch, no crash; intro not replayed because the intro gate was already dismissed on this install | logcat blocked; `launch-timing.txt`, `01-launch.png` |
| A02 Intro persistence | **PASS** — intro did not reappear after update/relaunch | `02-after-first-paint.png` |
| A03 Cold start | **PASS** — 332 / 313 / 312 ms (`am start -W`, COLD) | `launch-timing.txt` |
| A04 Warm start | **PASS** — 29 / 25 ms (HOT) | session log |
| A05 About page | **NOT TESTED** | — |
| A06 Stats page | **PASS** — archive renders: 5 translations, 695 words, 3 language pairs, 2/30 active days, practice map | `18-stats.png` |
| A07 Back order | **PASS** — Back closed the model sheet and kept the app; Back at root returned to the Honor launcher; Back with keyboard open hid the keyboard (`mInputShown=false`) | `10-after-back-sheet.png`, `04-after-back.png` |
| A08 Sheets | **PARTIAL** — model sheet and language sheet opened/closed correctly; other sheets not exercised | `23-locale-sheet.png` |

## B. Translation features

| ID | Result | Evidence |
| --- | --- | --- |
| B01 German → Arabic | **PASS** — typed `Guten Morgen` → streamed and settled **`صباح الخير`**, writer Velo, source auto-detected Deutsch | `03-translated-de.png`, `04-translated-de.png` |
| B02 Arabic → German | **PASS** — `مرحبا` typed with the real Arabic keyboard → **`Hey, na`**; later dictation Arabic → German path also worked | `15b-ar-de.png` |
| B03 Mixed scripts / numbers | **NOT TESTED** | — |
| B04 Long text (claim: 5k chars) | **NOT TESTED** | — |
| B05 Style switch (natural/formal/casual) | **NOT TESTED** (row rendered and reachable) | — |
| B06 Arabic variety | **NOT TESTED** (selector rendered) | — |
| B07 Source detection | **PASS (partial)** — auto improved to `Deutsch` after German input and to `العربية` after Arabic input; no false source shown | a11y dumps `m.xml`, `r.xml` |
| B08 Model switch Velo ⇄ Sona | **PARTIAL** — sheet opened and showed Velo selected + Sona option; switch not executed | `09-state` capture, a11y |
| B09 Copy result | **PARTIAL** — Copy control present and tapped; clipboard content not readable by shell (Android 10+ restriction), toast not captured | `16-copy.png` |
| B10 Save phrase + history | **PARTIAL** — archive rows grew (history entries written by bridge, stats counts visible); explicit save-phrase not exercised | `18-stats.png`, Room DB pull from emulator pre-check |
| B11 Sentence Shadow | **NOT TESTED** | — |
| B12 Empty / whitespace input | **PASS** — empty field sends nothing, placeholder remains | `01-launch.png` |

## C. Input and keyboard

| ID | Result | Evidence |
| --- | --- | --- |
| C01 Arabic RTL typing via real IME | **PASS** — `مرحبا` typed by tapping the system Arabic keyboard keys; caret at the inline-start (right) edge | `12-typed-ar.png`, a11y `ت.xml` |
| C02 German LTR | **PASS** — `input text` Latin input, LTR layout and left-aligned German result | `03-typed.png` |
| C03 IME composition | **PASS** — while the Arabic word was composing no request was sent; after the space committed it, the request started (matches the designed composition pause) | timeline screenshots |
| C04 Keyboard insets | **PASS** — composer, result and action row stayed above the keyboard in dark and light themes; no overlap | `04-translated-de.png`, `26-airplane-error.png` |
| C05 Paste / clear | **PARTIAL** — clear control emptied the field; clipboard paste not tested (adb cannot set the device clipboard) | a11y after clear |
| C06 Numbers and punctuation | **NOT TESTED** | — |

## D. Android lifecycle

| ID | Result | Evidence |
| --- | --- | --- |
| D01 Background → foreground | **PASS** — Home then relaunch kept draft/result/theme | `19-home.png`, `19b-back-to-app.png` |
| D02 Process kill → relaunch | **PASS** — `am force-stop` then COLD start 323 ms restored draft, settled result and light theme from Room/DataStore | `20-restored.png` |
| D03 Rotation / fold | **PASS (foldable)** — simulated unfold (STATE_FLAT): app stayed alive, content re-centred on the 2172x2352 inner display, draft intact, no crash; state reset to CLOSED afterwards | `21-unfolded-default.png` |
| D04 Notification during request | **NOT TESTED** | — |
| D05 Screen off during request | **NOT TESTED** | — |
| D06 Long session / memory growth | **NOT TESTED** | — |

## E. Permissions

| ID | Result | Evidence |
| --- | --- | --- |
| E01 Dictation (mic granted) | **FAIL → FIXED → PASS** — before the fix: mic opened for 136 ms then dictation failed; after the CSP fix: mic active 20.9 s and live Arabic transcript appeared in the composer | `28-dictation.png`, `30-dictation-fixed.png`, `logs/dictation-csp-fix-evidence.txt` |
| E02 Dictation denied | **NOT TESTED** | — |
| E03 Revoke mic from settings | **NOT TESTED** | — |
| E04 Location never requested | **PASS** — `ACCESS_COARSE_LOCATION: granted=false` after the whole pass; weather surface is off and no prompt appeared | `dumpsys package` output |

## F. Network

| ID | Result | Evidence |
| --- | --- | --- |
| F01 Normal request | **PASS** — live translation through `https://fluently.today/api/native/v1/translate-stream` with CORS accepted | `04-translated-de.png` |
| F02 Airplane mode | **PASS** — calm Arabic error `انقطع الاتصال قبل اكتمال الترجمة.` + `حاول مجدداً`; draft preserved; no crash/fake result | `26-airplane-error.png` |
| F03 Recovery + retry | **PASS** — after network returned, retry produced `مسا الخير` and `الترجمة جاهزة` | `27-retry-success.png` |
| F04 Slow network / timeout | **NOT TESTED** | — |
| F05 Provider HTTP failure | **NOT TESTED** | — |
| F06 Duplicate requests | **NOT TESTED** | — |

## G. Visual and surfaces

| ID | Result | Evidence |
| --- | --- | --- |
| G01 Three themes | **PASS** — dark, light (paper), vivid captured; status-bar icons flipped correctly (dark icons on light, light icons on dark/vivid); window strip matched the canvas | `17-theme.png`, `22-theme-vivid.png` |
| G02 Arabic RTL interface | **PASS** — full RTL mirror, no clipped text | `02-after-first-paint.png` |
| G03 German LTR interface | **PASS** — toolbar/order mirrored to LTR, Arabic draft still RTL | `24-locale-de.png` |
| G04 Bars / cutout / edge-to-edge | **PASS (observed)** — top row clears the 113 px status bar; bottom gesture area respected; no content under the cutout | screenshots |
| G05 Empty / error / success states | **PASS** — all three observed and legible | `01-launch`, `26-airplane-error`, `15b-ar-de` |
| G06 Font scale 1.3 | **NOT TESTED** | — |
| G07 Hostile strings | **NOT TESTED** | — |

## H. Device-specific

| ID | Result | Evidence |
| --- | --- | --- |
| H01 Battery-optimisation state | **OBSERVED** — app not on the deviceidle whitelist; background-survival under MagicOS not tested | `logs/device-env.txt` |
| H02 Back gesture (OEM) | **PARTIAL** — hardware Back key verified; gesture navigation not separately exercised | session log |
| H03 Refresh-rate modes | **OBSERVED** — 30/60/90/120 Hz supported; display ran 60–120 Hz; no frame-time metric captured (see performance report) | `dumpsys display` |
| H04 SAF backup export/import | **NOT TESTED** | — |
| H05 TTS (Arabic voice) | **NOT TESTED** | — |

## What the pass proves

- The release/R8 candidate installs over the existing app without losing data, boots fast, translates in both
  directions over the real network, survives force-stop and unfold, handles airplane-mode failure and retry,
  and renders correctly in Arabic RTL, German LTR, three themes and on both foldable displays.
- One real defect was found and fixed on the device: dictation was broken by the shell CSP (Section E01 /
  `fixes-and-regressions.md`).

## What is explicitly not covered

Backup export/import, permission denial/revocation flows, long text and 5k-char limit, style and Arabic
variety switching, model switching, Sentence Shadow, TTS, font scale, notifications, slow-network/timeouts,
and long-session memory. These are **NOT TESTED**, not passed.
## Round 3 additions (2026-11-18, same device and APK)

| ID | Result | Evidence |
| --- | --- | --- |
| B04 Long text | **PASS** — typed 1,720 characters; composer grew to 4 visible lines and scrolls, request settled with a full Arabic result and no ANR/freeze | `screenshots/40-longtext-typed.png`, `41-longtext-result.png` |
| B05 Style switch | **PASS** — Natural -> Formal produced a new request and a different result (`مرحبًا` -> `طاب يومكم`); restored Natural | `screenshots/34-model-sona.png`, `35-style-formal.png` |
| B08 Model switch | **PASS** — Velo -> Sona changed the label immediately, cleared the previous answer (`ستظهر ترجمتك هنا`) and answered `Guten Tag` with Sona (`مرحبًا`); restored Velo | a11y dumps `sn.xml`, `sn2.xml` |
| E02/E03 Permission revocation | **OBSERVED** — `pm revoke RECORD_AUDIO` causes Android to kill the app process (`ApplicationExitInfo: reason=8 PERMISSION CHANGE, description="permissions revoked"`), which is OS behaviour, not an app crash. After `pm grant` and relaunch, dictation worked again: mic active 7.6 s, `أستمع…` state and a live transcript | `screenshots/38-mic-regranted.png`, `39-mic-regranted-ok.png`, `exit-info` output |
| G06 Font scale 1.3 | **FAIL (accessibility gap)** — with system `font_scale=1.3` and a cold relaunch the interface rendered at exactly the same size; the WebView does not inherit the system font scale and the app sets no `textZoom`/rem scaling for it. Restored `font_scale=1.0` | `screenshots/36-fontscale-1.3.png` |

The font-scale finding is a real (non-critical) accessibility gap, not fixed in this pass; it should be
recorded in `docs/audits/technical-debt.md` and addressed deliberately (WebView `textZoom` or a CSS
scale rooted in the system setting).
## Round 4 additions (2026-11-18, same device and APK)

| ID | Result | Evidence |
| --- | --- | --- |
| H04 Backup export (SAF) | **PASS** — About -> Data controls -> Export opened the system create-document picker in Downloads with the prefilled name `today-backup-20261118-1926.json`; saving produced a **55,189-byte** JSON envelope (`format: today-backup`, `schemaVersion: 1`, `appVersion: 1.0.8`, `encrypted: false`, SHA-256 digest, `data.settings...`). File pulled and inspected. | `screenshots/` (About/data section), `/tmp/backup.json` inspected, log in this round |
| H04 Backup import (SAF) | **PASS** — importing the same file first showed the choice dialog (merge newest-wins vs replace everything), then the merge completed with `انتهى الاستيراد`: history `0 added / 10 already present`, phrasebook `0 / 0`, translation memory `0 added / 19 already present` — no duplicate rows, no data loss. | a11y dumps `imp2.xml`, `imp3.xml` |
| G07 Hostile string | **PASS** — a 150-character unbroken ASCII string wrapped across 4 lines inside the composer with no horizontal overflow or clipped control; the action row stayed reachable. | `screenshots/42-hostile-string.png` |

The exported plain-JSON backup contained the device archive, so it was **deleted from Downloads** after verification; nothing was left on the phone.

Remaining NOT TESTED: mic denial dialog (user-facing), TTS playback, notifications, slow-network/timeout
paths, Arabic-variety switching effect, long-session memory, background-kill survival under MagicOS.
## Round 5 additions (2026-11-18, same device and APK)

| ID | Result | Evidence |
| --- | --- | --- |
| E02 Mic denial (user-facing) | **PASS** — after revoking the permission and tapping the microphone, Android's permission dialog appeared (`com.google.android.permissioncontroller`); choosing `عدم السماح` produced the calm app message `اسمح باستخدام الميكروفون من إعدادات المتصفح.` with no crash. Permission was then restored and the `user-fixed` flag cleared so the owner can still change it in Settings. | `screenshots/43-mic-denied.png`, permission dialog a11y dump |
| D02b Background kill (`am kill`) | **PASS** — draft `Hallo Welt` was written, the app was sent Home, `am kill` removed the process (`pidof` empty), and the next cold start (311 ms) restored the draft and the settled result. | a11y dump after relaunch |
| H05 TTS playback | **PASS (playback started)** — tapping the listen control created a started `AAudio` player in the app UID (`u/pid 11061/3390 state:started`, `USAGE_MEDIA`); a second tap stopped it. Audibility/content quality was not judged (no audio capture), only the media pipeline state. | `screenshots/44-tts-playing.png`, `dumpsys audio` log |

Remaining NOT TESTED: notifications during use, slow-network/timeout paths, Arabic-variety switching
effect, long-session memory growth, background survival under MagicOS power management.