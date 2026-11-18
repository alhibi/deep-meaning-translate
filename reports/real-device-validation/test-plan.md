# Test Plan — Phase 04 (Real Device)

Derived from the actual feature surface in `src/` and the native shell in `android/` — not from a
generic Android checklist. Every case carries an ID, a precondition, exact steps, the expected
result, the evidence to capture, and a status column that stays **NOT TESTED** until the device
produces proof.

Device: HONOR PNM-N49 (see `reports/device-fingerprint.md`), against the **release-review APK**
built from `3cf511e` (`app-release.apk`, R8 minified, debug-signed for review only).
Status values: PASS / FAIL / BLOCKED / NOT TESTED.

## A. Boot, first run, navigation

| ID | Case | Steps | Expected | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| A01 | Clean install + first launch | `adb install -r app-release.apk`; launch from launcher | Splash → first-run intro in Arabic; no black frame; app does not crash | screenshot, `am start -W`, logcat | NOT TESTED |
| A02 | Intro dismissal persists | Dismiss intro, kill app, relaunch | Intro does not reappear; translator is the first painted screen | screenshots, logcat | NOT TESTED |
| A03 | Cold start timing | `am force-stop`; `am start -W` ×3 | Displayed time recorded; no ANR | `am start -W` output | NOT TESTED |
| A04 | Warm start | Home → launcher icon | Restores immediately with draft intact | screenshots | NOT TESTED |
| A05 | About page | Open "عن today" | One public page, sections, no crash; scroll to controls | screenshots | NOT TESTED |
| A06 | Stats page | Open stats icon | Local stats render; back returns with draft intact | screenshots | NOT TESTED |
| A07 | Back order | Back from stats; back from sheet; back at root | stats → translator (draft kept); sheet closes first; root exits | logcat, screen recording | NOT TESTED |
| A08 | Sheets and dialogs | Open/close every sheet and dialog | Focus trapped, no ghost overlay, back closes | screenshots | NOT TESTED |

## B. Translation features

| ID | Case | Steps | Expected | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| B01 | Arabic → German | Type "أريد أن أفهم معنى هذه الجملة" | Streamed word arrival, then settled German result | screen recording + logcat | NOT TESTED |
| B02 | German → Arabic | Type German sentence with umlauts (ä ö ü ß) | Correct Arabic, umlauts preserved in source | screenshots | NOT TESTED |
| B03 | Mixed scripts + numbers | Arabic + German + Latin digits + Arabic-Indic digits + URL + emoji | Number/URL check passes; no invented explanations | screenshots | NOT TESTED |
| B04 | Long text | Paste ~3–5k characters | Completes or fails calmly; no clipping; no ANR | screenshots, logcat | NOT TESTED |
| B05 | Style switching | Natural → Formal → Casual | New request per change; no stale answer kept | screenshots | NOT TESTED |
| B06 | Arabic variety | Select Levantine/Egyptian/Gulf/Iraqi/Maghrebi | Request carries the variety; output reflects it | screenshots | NOT TESTED |
| B07 | Language detection | Type a strong writing-system mismatch | `auto` sent; dismissible hint, not a false source | screenshots | NOT TESTED |
| B08 | Model switch Velo⇄Sona | Switch model mid-draft | Previous answer cleared immediately; new full request | screen recording | NOT TESTED |
| B09 | Copy + share | Copy settled result; share | Clipboard contains the exact answer; share sheet opens | screenshots, clipboard dump | NOT TESTED |
| B10 | Save phrase + history | Save a phrase; open stats | Row present; survives restart | DB pull, screenshots | NOT TESTED |
| B11 | Sentence Shadow | Settle a sentence that shifts meaning | Shadow offer appears only on settled; apply overlay updates copy/history | screenshots | NOT TESTED |
| B12 | Empty / whitespace input | Empty field, spaces only | No request, no error state | logcat | NOT TESTED |

## C. Input and keyboard

| ID | Case | Steps | Expected | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| C01 | Arabic RTL typing | System Arabic keyboard, type | Caret at inline-start (right), no mirror drift, one line growth | screenshots, recording | NOT TESTED |
| C02 | German LTR typing | German keyboard | Caret left, correct alignment | screenshots | NOT TESTED |
| C03 | IME composition | Type with composing candidates (Arabic/German) | No premature submit; Enter during composition does not send | logcat, recording | NOT TESTED |
| C04 | Keyboard insets | Focus editor | Keyboard never covers composer or result actions | screenshots | NOT TESTED |
| C05 | Paste and clear | Paste 2k chars, then clear | No stale answer enables actions; height grows ≤ limits then scrolls | screenshots | NOT TESTED |
| C06 | Numbers/punctuation input | Type ١٢٣ and 123, ?, ، | Verified, no unintended rewrite | screenshots | NOT TESTED |

## D. Lifecycle

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| D01 | Background → foreground | Draft/result/theme intact; no duplicate request | NOT TESTED |
| D02 | Process kill (`am kill`) → relaunch | Draft/result restored from Room/DataStore; no new provider request for a cached sentence | NOT TESTED |
| D03 | Rotation | Activity stays portrait; draft intact | NOT TESTED |
| D04 | Notification during request | Request finishes or fails calmly; no crash | NOT TESTED |
| D05 | Screen off / lock during request | No crash; result committed or clean error | NOT TESTED |
| D06 | Low-memory / long session | No leak; stats remain responsive | NOT TESTED |

## E. Permissions

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| E01 | Dictation — allow mic | Audio capture starts; transcription streams or fails calmly | NOT TESTED |
| E02 | Dictation — deny mic | Calm message; app keeps working | NOT TESTED |
| E03 | Revoke mic from settings, return | Calm state, no crash | NOT TESTED |
| E04 | Location never requested (weather off) | No location prompt in normal use | NOT TESTED |

## F. Network and services

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| F01 | Normal request | Translation completes; CORS accepted | NOT TESTED |
| F02 | Airplane mode | Calm retryable error; draft preserved; no fake result | NOT TESTED |
| F03 | Return from airplane mode | Next request succeeds without restart | NOT TESTED |
| F04 | Slow network | Streaming still arrives; no false timeout | NOT TESTED |
| F05 | Provider/HTTP failure | Calm error, retry works; no silent success | NOT TESTED |
| F06 | Duplicate requests | No double translation for one settled draft | NOT TESTED |

## G. Visual inspection

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| G01 | Light/dark/vivid themes | Tokens, system bars, window strip match; no flash | NOT TESTED |
| G02 | Arabic interface RTL | Mirror layout, no clipped text, correct direction | NOT TESTED |
| G03 | German/English LTR | Layout correct and symmetric | NOT TESTED |
| G04 | Status/navigation bars + cutout | Content never under bars; edge-to-edge safe areas | NOT TESTED |
| G05 | Loading / empty / error / success states | All four reachable and legible | NOT TESTED |
| G06 | Font scale 1.3 / display size | No overlap or truncation in composer and actions | NOT TESTED |
| G07 | Long/hostile strings | No overflow, no ellipsis eating controls | NOT TESTED |

## H. Device-specific (HONOR / MagicOS)

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| H01 | Battery optimization state | Record whether app is restricted; test background survival | NOT TESTED |
| H02 | OEM launcher back gesture | Back pipeline still closes sheets before exiting | NOT TESTED |
| H03 | Refresh-rate / display settings | Record modes; no layout issue | NOT TESTED |
| H04 | Storage/SAF | Export to Downloads, import back, tamper refused | NOT TESTED |
| H05 | TTS engine availability (Arabic) | Device voice or calm fallback; record TD23 behaviour | NOT TESTED |

## Performance (Phase 08)

| Metric | Method |
| --- | --- |
| Cold / warm start | `am start -W` ×3, plus `dumpsys activity` |
| Time to editable composer | screen recording frame timestamps or `logcat` markers |
| Jank | `dumpsys gfxinfo today.fluently.app framestats` after scroll/typing |
| Memory | `dumpsys meminfo` before/after a 10-minute session |
| CPU | `top -b -n1` samples during streaming |
| Network latency | `logcat` + server timing of one real request |
| Battery/thermal | `dumpsys battery`, `dumpsys thermalservice` |

## Evidence rules

- Screenshots for every visual claim; before/after for every fix.
- `logcat` captured with `-v threadtime` around each scenario, filtered for the app PID on failure.
- Status is written only after reading the artefact, never from expectation.
