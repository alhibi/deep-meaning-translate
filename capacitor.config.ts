import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor shell for the installed app.
 *
 * `webDir` contains the SPA produced by `npm run build:native:web` — the UI is packaged
 * in the APK and never loaded from the website. The origin is `https://localhost`, which
 * is the origin the native API routes allow (`src/lib/native/gate.server.ts`).
 *
 * The splash screen does not hide itself: the app hides it after the theme, direction,
 * draft and recent archive have been restored, so no default palette is painted first.
 */
const config: CapacitorConfig = {
  appId: "today.fluently.app",
  appName: "today",
  webDir: "android-web",
  backgroundColor: "#12100F",
  android: {
    allowMixedContent: false,
    // Do NOT capture input: Capacitor replaces the WebView InputConnection with a plain
    // BaseInputConnection when this is true, and on the target Android 17 phone that made
    // Arabic/German IME taps change the textarea value without dispatching any input or
    // composition event to the page. The translator then never learned the draft and only
    // translated after Enter. The stock InputConnection keeps IME events intact.
    captureInput: false,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: "https",
    hostname: "localhost",
  },
  plugins: {
    SplashScreen: {
      // The app hides it as soon as the restored frame is committed. This duration is
      // only a native ceiling: a WebView that never runs must not show black forever.
      launchShowDuration: 6000,
      launchAutoHide: true,
      backgroundColor: "#12100F",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    // No Keyboard resize keys: Capacitor SystemBars owns IME insets and the Keyboard
    // plugin skips its resize when SystemBars is present; `resize` is iOS-only and
    // `resizeOnFullScreen` conflicts with SystemBars. The load-bearing IME padding is the
    // patch in patches/@capacitor+android+8.6.2.patch — keep it when upgrading Capacitor.
  },
};

export default config;
