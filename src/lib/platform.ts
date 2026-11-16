import { isNativeApp } from "./native/config";
import { nativePort } from "./persistence/native";
import { setNativeSettingsMode, flushSettings, forgetSettingsCache } from "./persistence/settings";
import { hydratePersist } from "./persist";
import { hydrateHistory } from "./history";
import { hydrateSaved } from "./saved";
import { hydrateMemory } from "./translation/memory";
import { INTRO_KEY, releaseIntroGate } from "./intro";
import { LOCALE_STORAGE, normalizeLocale, setLocale } from "./i18n";
import { THEME_KEY, parseTheme, syncThemeColor } from "./theme";
import { readDeviceValue } from "./persistence/settings";

/**
 * Platform boot.
 *
 * The browser needs nothing here: its storage is read on demand exactly as before. The
 * Android app loads one validated snapshot (DataStore + a recent Room page) while the
 * native splash screen is still covering the WebView, applies the saved palette and
 * direction, and only then lets React render. No default theme is painted first and
 * swapped later, and no screen opens with an empty draft it already has.
 */
let ready = false;
let booted = false;
let lastError: string | null = null;

/**
 * The bridge is a device resource, not a guarantee. If it does not answer in this
 * window the app opens with in-memory data instead of holding the splash forever.
 */
const BOOT_TIMEOUT_MS = 3000;

function withBootTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("boot-timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function platformReadySync(): boolean {
  return ready || !isNativeApp();
}

export function platformError(): string | null {
  return lastError;
}

function applyStoredAppearance() {
  if (typeof document === "undefined") return;
  const theme = parseTheme(readDeviceValue(THEME_KEY));
  const d = document.documentElement;
  d.classList.remove("dark", "light", "vivid");
  d.classList.add(theme);
  d.dataset["theme"] = theme;
  d.style.colorScheme = theme === "light" ? "light" : "dark";

  const saved = normalizeLocale(readDeviceValue(LOCALE_STORAGE));
  if (saved) setLocale(saved, false);
  if (readDeviceValue(INTRO_KEY) === "1") releaseIntroGate();
  syncThemeColor();
}

export async function hydratePlatform(): Promise<boolean> {
  if (booted) return ready;
  booted = true;
  if (!isNativeApp()) {
    ready = true;
    return true;
  }
  setNativeSettingsMode(true);
  try {
    const snapshot = await withBootTimeout(nativePort.hydrate(), BOOT_TIMEOUT_MS);
    hydratePersist(snapshot.prefs, snapshot.session);
    hydrateHistory(snapshot.history, snapshot.historyTotal);
    hydrateSaved(snapshot.saved);
    hydrateMemory(snapshot.memory);
    lastError = null;
  } catch (error) {
    // A broken or slow bridge must not brick the translator. The app opens with empty
    // device data, keeps working in memory, and says so in the data screen.
    lastError = error instanceof Error && error.message === "boot-timeout" ? "timeout" : "bridge";
    try {
      applyStoredAppearance();
    } catch {
      /* a blocked DOM is still not a reason to keep the cover up */
    }
  }
  // Ready in every branch: the cover exists to prevent a wrong first frame, never to
  // become a black screen when storage is unavailable.
  ready = true;
  listenForBackground();
  return lastError === null;
}

/**
 * Hide the native splash and align the system bars, after React has committed the first
 * real frame. Idempotent, and called from the root route whenever `ready` becomes true,
 * including the degraded path.
 */
export async function finishPlatformChrome(): Promise<void> {
  if (!isNativeApp()) return;
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    const light = document.documentElement.dataset["theme"] === "light";
    await StatusBar.setStyle({ style: light ? Style.Light : Style.Dark });
  } catch {
    /* not fatal: the canvas still owns its own colours */
  }
  await hideSplash();
}

async function hideSplash(): Promise<void> {
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    // A plugin that rejects once may still work after the WebView has painted. Retry
    // once, then rely on the native auto-hide ceiling in capacitor.config.ts.
    await new Promise<void>((resolve) => setTimeout(resolve, 700));
    try {
      const { SplashScreen } = await import("@capacitor/splash-screen");
      await SplashScreen.hide();
    } catch {
      /* the native ceiling will remove it */
    }
  }
}

/** Persist everything queued before Android may stop the process. */
export async function flushPlatform(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await flushSettings();
  } catch {
    /* the next boot retries; a flush failure must not block leaving the app */
  }
}

function listenForBackground() {
  if (typeof window === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      window.dispatchEvent(new Event("lingua:flush"));
      void flushPlatform();
    }
  });
  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      await App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) return;
        window.dispatchEvent(new Event("lingua:flush"));
        void flushPlatform();
      });
      // Android back: close the open sheet first, otherwise let the WebView's history
      // decide. `index.tsx` registers the sheet closers on this event.
      await App.addListener("backButton", () => {
        window.dispatchEvent(new Event("lingua:back"));
      });
    } catch {
      /* the plugin is optional: the WebView's own lifecycle still applies */
    }
  })();
}

/** Test seam: forget the boot so a fresh snapshot can be applied. */
export function resetPlatformForTests() {
  ready = false;
  booted = false;
  lastError = null;
  forgetSettingsCache();
}
