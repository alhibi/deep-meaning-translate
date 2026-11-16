# Device compatibility

Status: **Design and code implemented**; the compatibility matrix below is **NOT_VERIFIED**
because this build environment has no emulator image, no system image and no connected
device (`adb devices` empty). The APKs are verified as signatures and manifests only.

## Supported range

| Property | Value | Notes |
| --- | --- | --- |
| `minSdk` | 24 (Android 7.0) | WebView is updatable on this range; Room 2.7 and DataStore 1.1 support it |
| `targetSdk` | 36 (Android 16) | Edge-to-edge, per-app language, predictive-back handling |
| `compileSdk` | 36 | Build tools 36.0.0 |
| ABI | arm64-v8a, armeabi-v7a, x86, x86_64 | Universal APK; no native translator code, only DataStore's counter |
| Locales | `en`, `ar`, `de` | `resourceConfigurations` keeps the APK small; the UI itself is locale-switched in JS |
| Direction | LTR and RTL | `supportsRtl="true"`; the layout follows the app locale, not the system locale |

## What was designed per device class

| Concern | Behaviour |
| --- | --- |
| Keyboard | `windowSoftInputMode="adjustResize"` + Capacitor `Keyboard.resize: "native"`; the composer stays visible above the IME, and back closes the keyboard before navigation |
| Edge-to-edge | `WindowCompat.setDecorFitsSystemWindows(window, false)`; the shell uses `env(safe-area-inset-*)`, so text never sits under a cutout or gesture bar |
| System bars | Transparent; icon style follows the palette (light theme → dark icons) after hydration |
| Back | overlay → keyboard → previous destination → `App.exitApp()`, on gesture and button navigation (`enableOnBackInvokedCallback="false"` keeps one path) |
| Splash | Held until the restored theme/locale/draft are painted, so no default palette flashes |
| Small screens | The same one-screen shell scrolls; result and sheets remain reachable; no fixed-height assumptions |
| Large screens / tablets | The existing max-width layout is unchanged; no separate tablet UI was added |
| Fonts | The product's bundled fonts are served from the APK; no network font fetch |
| Speech | Cloud voice first; if the WebView has no `speechSynthesis`, Android's engine reads the translation (no word timing) |
| Dictation | `RECORD_AUDIO` requested on first use; denial leaves every other feature working |
| Rotation | `configChanges` keeps the WebView alive; draft/session survive rotation through normal state |
| Low storage / corrupt DB | Storage errors are reported calmly; the app still translates; imports roll back |

## Known risks not yet measured on hardware

- WebView version differences on Android 7–9 (flex gap, `dvh`, `backdrop-filter`). The web
  app already gates the heaviest effects, but smoothness on 2 GB devices is unmeasured.
- IME behaviour on Samsung/Xiaomi keyboards with `adjustResize` and full-screen mode.
- Android 12+ splash icon cropping for adaptive icons at unusual aspect ratios.
- Text-to-speech availability per OEM (some devices ship no engine or no Arabic voice).
- Battery/doze behaviour for long translations in the background (the app is foreground-only).

## How to verify on a device

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p today.fluently.app.debug -c android.intent.category.LAUNCHER 1
adb logcat | grep -i -E "capacitor|today.fluently|AndroidRuntime"
```

Check, in order: first paint matches the saved theme; draft and archive return after a
force-stop; keyboard does not cover the composer; back order; RTL with an Arabic UI;
dictation permission flow; export then import a backup; airplane mode error state.

Record the result in `docs/audits/` with device model, Android version, WebView version
and classification (VERIFIED / OBSERVED / SUSPECTED / NOT_VERIFIED).
