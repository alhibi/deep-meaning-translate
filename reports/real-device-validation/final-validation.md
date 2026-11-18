# Final Validation — Release Candidate

## Candidate identity

| Item | Value |
| --- | --- |
| Artifact | `artifacts/today-1.0.8-review-r8-candidate2-cspfix.apk` |
| Package / version | `today.fluently.app`, versionCode 9, versionName 1.0.8 (R8 minified release) |
| SHA-256 | `607b500f58036614e06e159e9cb22b9d6e8d900ce572413f762602b41e236e52` |
| Signing | debug keystore `02d5b40c...de9a` — **review build, not publishable** (no upload keystore, TD18) |
| Source | local commit `3cf511e` + the two CSP script changes described in `fixes-and-regressions.md` |
| Installed | `install -r` over the existing 1.0.8 package; `firstInstallTime` unchanged (2026-11-16 20:42:46) |
| Installed == tested? | **YES** — the APK pulled back from `/data/app/.../base.apk` has the same SHA-256 |

## Acceptance gates

| Gate | Status | Basis |
| --- | --- | --- |
| A — Installation | **PASS** | correct package installed over existing data and launched on the phone; version and signature verified |
| B — Functional integrity | **PASS (with NOT TESTED items)** | install/launch, DE->AR and AR->DE translation over the live network, source detection, dictation (after fix), stats, sheets, back order, airplane-mode failure + retry, persistence |
| C — Visual integrity | **PASS** | three themes, RTL and LTR interfaces, keyboard insets, system bars, cutout, foldable inner display; no clipping/overlap found |
| D — Stability | **PASS (bounded)** | no crash/ANR/process death in the exercised scenarios (`exit-info`, `dropbox`); logcat unavailable on this OEM build — see `crash-analysis.md` |
| E — Lifecycle | **PASS** | background/foreground, force-stop + restore (draft, result, theme), fold/unfold, back order |
| F — Device compatibility | **PASS (bounded)** | Android 17/API 37, 408 dpi display-size override, foldable states, OEM side-panel overlay identified as system UI, hardware Back; OEM background-kill policy not tested |
| G — Performance | **PARTIAL** | cold 312–332 ms, hot 25–29 ms, PSS 111.6 MB measured; frame/jank timing NOT VERIFIED because WebView frames are not attributed to the package in `gfxinfo` |
| H — Release verification | **PASS** | the final APK is byte-identical to the installed, tested artifact; SHA-256 recorded |

## Defects

| ID | Severity | Status |
| --- | --- | --- |
| BUG-01 dictation blocked by CSP `script-src` (AudioWorklet blob) | **Critical for dictation** | **FIXED, rebuilt, reinstalled, verified on device, regression-checked** |
| BUILD-ENV-01 duplicated `* 3.xml` files in node_modules broke Gradle | Build environment | Fixed by cleaning duplicates + stale plugin build dirs; not an app change |

No other app defect was reproduced on the device.

## Not tested (explicit)

Backup export/import (SAF), mic denial/revocation, long text and the 5,000-character limit, style and
Arabic-variety switching, model switching, Sentence Shadow, TTS, font scale 1.3, notifications,
slow-network/timeout paths, long-session memory growth, background-kill survival under MagicOS.

## Device state left behind

- App updated to candidate2, user data preserved (draft cleared, dark theme and Arabic interface restored).
- Test translations were added to the app's local history by the normal translation flow; they were not
  deleted because deleting history would remove the user's own rows too.
- Airplane mode was restored to OFF; fold state override was reset to CLOSED.
- No uninstall, no `pm clear`, no permission grant was changed (mic was already granted).

## Repository state

Two files are modified in the working tree (the CSP fix). They are **not committed** — committing/pushing
the connected Lovable branch was left to the owner. Generated `android-web/` and `android/app/src/main/assets/public`
were refreshed by the rebuild.
## Round 3 update (2026-11-18)

Added evidence on the same device and the same installed APK:

- **Model switch** Velo <-> Sona: PASS (label, cleared answer, new request through the selected writer).
- **Style switch** Natural -> Formal: PASS (new request, different result).
- **Long text** 1,720 characters: PASS (no ANR, composer scrolls, result settles).
- **Permission revocation:** `pm revoke` kills the process via Android's `PERMISSION CHANGE` reason
  (OS behaviour). After re-grant + relaunch, dictation works (mic 7.6 s, listening state, transcript).
- **Font scale 1.3:** **FAIL / not supported** — the WebView interface does not follow the system font
  scale. This is a real accessibility gap (non-critical) and is **not fixed**: recorded here and in
  `functional-test-results.md` for the technical-debt register.

Gate impact: B remains PASS for the exercised surface; C remains PASS at default scale with the
font-scale gap noted; no new crash or regression observed.

Still NOT TESTED: SAF backup export/import, mic denial dialog (user-facing deny), Sentence Shadow,
TTS, notifications, slow-network/timeout paths, Arabic-variety switching, hostile strings,
long-session memory, background-kill survival under MagicOS.
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