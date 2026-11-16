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
    captureInput: true,
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
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
