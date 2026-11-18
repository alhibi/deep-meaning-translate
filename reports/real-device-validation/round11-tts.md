# Round 11 — TTS readiness and audio focus (2026-11-18)

## What changed

- `src/lib/native/tts.ts`: the native fallback used to call `available()` once; the Android
  engine initialises asynchronously after `load()`, so a first tap during that window failed as
  `unsupported` with no retry. `speakNative` now waits in 12 bounded steps (~1.8 s) for readiness
  and stops waiting as soon as the person cancels.
- `android/.../bridge/LinguaTtsPlugin.kt`: the engine now receives speech audio attributes
  (`USAGE_ASSISTANCE_ACCESSIBILITY` / `CONTENT_TYPE_SPEECH`) and requests transient audio focus
  with ducking. Focus is abandoned on `onDone`, `onError`, `onStop`, `stop()`, pause and destroy,
  so a voice is heard over music without stopping it and no player thinks speech is still active.

## Verification

| Check | Result |
| --- | --- |
| TypeScript + ESLint | clean |
| Unit tests (`src/lib/tts.test.ts`) | 7/7 pass |
| Release build (R8, Gradle 8.14.7 / AGP 8.13.2) | BUILD SUCCESSFUL |
| Device: listen control tapped | playback works; screenshot `62-tts-focus.png` |
| Device: native audio-focus entry | **NOT OBSERVED** — this phone's WebView has no `speechSynthesis`, but the cloud voice (server PCM via Web Audio) serves the listen action, so the native fallback plugin was not invoked. The focus-stack inspection therefore proves nothing about the Kotlin change. |

Classification: the Kotlin/TS change is build- and test-verified; its live effect is
**NOT_VERIFIED on hardware** because the cloud voice path is used first on this device. To exercise
it, the cloud voice would have to fail (no provider key / offline) so `tts.ts` falls back to
`speakNative`.

## Artifact

- `artifacts/today-1.0.8-review-r8-candidate6-tts.apk`
- SHA-256 `b2817b332ddf730a3bbb2a400a3cc8a4699bf03d39c4b265b7ac1f7fc224f6cc`
- commit `34c2867`

## Still open

Durability window under MagicOS kill (TD65), adaptive foldable composition (TD61), predictive back
(TD62), Kotlin 2.3/KSP 2.3 upgrade (TD69), and the owner's confirmation of the overlay fix.
