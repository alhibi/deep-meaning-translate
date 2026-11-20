# Android rendering fixes — 1.1.1 (2026-11-20)

Status: **fixed at the source and verified on the physical device** (HONOR PNM-N49, Android 17 /
API 37). App: `versionCode 12`, `versionName 1.1.1`. Build: AGP 9.5.2 · Gradle 9.8.1 · built-in
Kotlin 2.4.21 · compileSdk/targetSdk 37.

## Reported symptom

Fast but visible overlap/rendering artefacts when tapping parts of the screen or the composer
field on the installed app.

## Root causes found (with evidence)

### R1 — Native text handles used the AppCompat default accent (teal), not the app signal

The WebView does not draw the caret: it draws the Android **insertion handle** (the teardrop),
selection handles, magnifier and selection tint from the Activity theme's `colorAccent`.
`AppTheme` never declared one, so AppCompat's default teal was used: every tap in the composer
showed a teal droplet over the clay/paper palette for ~1.8 s (frame analysis: 70 frames with
teal pixels `(126,201,194)`; the CSS caret is copper, so two different accents were on screen).

**Fix:** `colorAccent`, `android:colorControlActivated`, `android:colorControlHighlight` and
`android:textColorHighlight` = the app signal (`#C97A5A` / `#33C97A5A`) in `values/styles.xml`.
**Verified:** a frame at the same point now contains only warm signal pixels `(159,94,62)`; teal
frames in the recording dropped from 70 to 0.

### R2 — System-bar icon appearance did not follow the in-app palette

Bars are transparent (edge-to-edge), so their icon appearance is the app's responsibility. The JS
path called `SystemBars.setStyle` through `@capacitor/core`, which is not exposed that way in this
shell (the call was a silent no-op), and the launch theme only follows the phone's day/night mode.
Switching to paper-light therefore left **light status/navigation icons on cream** — low-contrast
"bars" that read as a rendering/overlap defect exactly when the theme control was tapped.

**Fix:** `LinguaChromePlugin` now derives the appearance from the canvas luminance
(`WindowInsetsControllerCompat.isAppearanceLightStatusBars/NavigationBars`) every time the canvas
colour is applied, so paper → dark icons, clay/vivid → light icons, independent of the phone mode.
**Verified** on device: light theme status band = 41,289 dark pixels vs 3,742 light; dark theme =
40,228 light vs 4,112 dark (was the inverse before the fix).

### R3 — The WebView surface defaulted to white during IME resize

The WebView is resized when the keyboard opens/closes and the plugin pads it by the IME inset.
Its default surface background is white; in clay dark a resize could flash a white frame before
the page repainted. The window background was already canvas-coloured, but the WebView itself was
not.

**Fix:** the chrome plugin (and `MainActivity.onResume`) now calls `webView.setBackgroundColor` with
the same canvas colour, so any resize/IME gap is painted in the app palette.

### R4 — Debug WebView debugging was enabled after the WebView existed

`WebView.setWebContentsDebuggingEnabled(true)` was called after `super.onCreate`, which is too late
per the Android docs; `chrome://inspect` stayed unreachable (it also blocked this investigation's
CDP trace). Moved before `super.onCreate` (debug builds only). No user-facing change.

## What is intentional (not a defect)

- The **theme reveal** is a deliberate circular View Transition spreading from the touch point
  (`theme.ts` + `::view-transition` CSS). It is an animation, not a stray overlay.
- The **keyboard slide** is the system IME animation; the app content and its canvas now move
  together with matching background, so no white gap is exposed.
- Tap feedback (`:active` scale/opacity) is design, 40 ms, and reduced under reduced motion.

## Build / verification evidence

| Gate                                            | Result                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `:app:assembleDebug`                            | PASS; `versionCode=12`, `versionName=1.1.1-debug`, targetSdk 37                     |
| `:app:testDebugUnitTest`                        | PASS (18 tests, 0 failures)                                                         |
| `:app:assembleRelease -PallowDebugSigning=true` | PASS with R8; 3.7 MB review APK                                                     |
| Install update over 1.1.0                       | Success; installed `versionCode=12 / 1.1.1-debug`                                   |
| Teal handle check                               | before 70 frames with teal `(126,201,194)`; after 0 frames, warm `(159,94,62)` only |
| Status-bar contrast                             | light theme dark icons; dark theme light icons (pixel counts above)                 |
| Crash scan                                      | 0 FATAL EXCEPTION / 0 ANR across the verification session                           |

## Files

- `android/app/src/main/res/values/styles.xml` — brand theme accent/highlight for native text handles.
- `android/app/src/main/res/values/colors.xml` — `brand_accent`, `brand_highlight`.
- `android/app/src/main/java/today/fluently/app/bridge/LinguaChromePlugin.kt` — WebView background +
  system-bar icon appearance from canvas luminance.
- `android/app/src/main/java/today/fluently/app/MainActivity.kt` — debug flag ordering + WebView
  background on resume.

APKs and screenshots: `artifacts/android-1.1.1/` (debug + release-review, checksums included).
