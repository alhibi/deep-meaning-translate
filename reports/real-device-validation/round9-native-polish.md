# Round 9 — native polish verified (2026-11-18)

Device: HONOR PNM-N49, Android 17/API 37. APK:
`artifacts/today-1.0.8-review-r8-candidate5-native.apk`,
SHA-256 `30d7753e4326c2fab20578df961a3d7e76df9dac636fabe39b61eca3ce0be1c9`.

## 1. Reload-like overlay — config-change recreation stopped (fix verified)

**Test on the phone:** the translator was open with a draft (`Schrift Test`), PID `23663`,
activity record `t20583`, `font_scale=1.0`. Setting `font_scale=1.3` while the app was
foreground then checking again:

- PID stayed `23663` (no process restart),
- the same ActivityRecord `179367185 ... t20583` stayed resumed (no recreation),
- the draft was still `Schrift Test` (no WebView reload),
- no splash/boot cover was replayed.

`fontScale|fontWeightAdjustment|colorMode` were added to `android:configChanges` in round 8; this
is the first device proof that the change does what it was meant to do. A user-facing confirmation
of the specific overlay they saw is still useful.

## 2. Launch surfaces now follow the phone's day/night mode

`app-release.apk` resource table contains two `color/splash_background` entries:

- day (default): `0xFFF6F3ED` (paper)
- night: `0xFF12100F` (clay)

`styles.xml` uses `@color/splash_background` for `windowBackground`, `background` and
`windowSplashScreenBackground`, and `@bool/splash_light_status_bar` for the splash status icons.
A light phone no longer gets a clay launch cover. Limitation kept in TD63: an explicit in-app theme
that differs from the system mode cannot be known before the Android 12 starting window is drawn,
so the launch colour follows the phone, not the saved app theme.

## 3. Status-bar plugin removed; SystemBars alone keeps the icons correct

`@capacitor/status-bar` and its unreachable JS fallback were removed (`npm ls` is empty). The
merged plugin list no longer contains `StatusBarPlugin`.

Device evidence in light theme (dark icons on the paper canvas):

- folded 1080x2420: `screenshots/59-light-bars.png` (status-bar crop shows dark icons),
- unfolded inner display 2172x2352 after `cmd device_state state 1`:
  `screenshots/60-light-unfolded.png` — the status icons stayed dark, i.e. the old plugin's
  config-change callback (which reset the appearance to the device's dark theme) is gone.

## 4. Regression smoke on the final artifact

After installing candidate5 over the existing app (`firstInstallTime` unchanged), a translation
completed automatically without pressing Enter (`screenshots/61-final-smoke.png`), and the archive
still renders. Full test suite and lint were run on this tree (exit 0); the native-shell contract
tests pass.

## 5. Remaining open work

- TTS first-tap readiness and audio focus (TD67).
- MagicOS kill durability window (TD65).
- Adaptive foldable composition (TD61), predictive back (TD62).
- Kotlin 2.3.21 + KSP 2.3.14 upgrade (TD69) — needs a full device regression pass.
- An archive above 2,000 rows on hardware (code/test-verified only so far).
- User confirmation that the overlay they saw is gone.
