import { isNativeApp } from "./native/config";
import { markNativeHydrated, nativePort, resetNativeHydrationForTests } from "./persistence/native";
import {
  setNativeSettingsMode,
  setNativeSettingsReady,
  flushSettings,
  forgetSettingsCache,
} from "./persistence/settings";
import { hydratePersist } from "./persist";
import { history, hydrateHistory } from "./history";
import { hydrateSaved, resetSavedCache } from "./saved";
import { hydrateMemory, reloadMemory } from "./translation/memory";
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

let watchingSystemTheme = false;
/** Follow the phone only while no explicit theme is saved; an explicit choice always wins. */
function watchSystemTheme() {
  if (watchingSystemTheme || typeof matchMedia !== "function") return;
  watchingSystemTheme = true;
  const query = matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (readDeviceValue(THEME_KEY) === null) applyStoredAppearance();
  };
  query.addEventListener?.("change", onChange);
}

function applyStoredAppearance() {
  if (typeof document === "undefined") return;
  // An explicit saved theme wins; with none saved, follow the phone (the same rule the
  // web boot script uses). Before this, an unset preference was forced to clay dark even
  // on a light phone, which contradicted the product rule and the splash.
  const storedTheme = readDeviceValue(THEME_KEY);
  const theme =
    storedTheme === null
      ? typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : parseTheme(storedTheme);
  const d = document.documentElement;
  d.classList.remove("dark", "light", "vivid");
  d.classList.add(theme);
  d.dataset["theme"] = theme;
  d.style.colorScheme = theme === "light" ? "light" : "dark";

  const saved = normalizeLocale(readDeviceValue(LOCALE_STORAGE));
  if (saved) setLocale(saved, false);
  if (readDeviceValue(INTRO_KEY) === "1") releaseIntroGate();
  syncThemeColor();
  watchSystemTheme();
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
    // The DataStore snapshot is seeded by the port; applying it here is what makes the
    // saved theme, interface locale and intro gate real on the next cold start (A3-09/A4-01).
    // Until this point native writes are refused, so a timed-out bridge cannot turn an
    // unhydrated cache into an empty table (A3-02).
    try {
      applyStoredAppearance();
    } catch {
      /* a blocked DOM is still not a reason to keep the cover up */
    }
    setNativeSettingsReady(true);
    markNativeHydrated();
    lastError = null;
  } catch (error) {
    // A broken or slow bridge must not brick the translator. The app opens with in-memory
    // defaults, keeps translating, and reports in the data screen that storage is unavailable.
    lastError = error instanceof Error && error.message === "boot-timeout" ? "timeout" : "bridge";
    setNativeSettingsReady(false);
  }
  // Ready in every branch: the cover exists to prevent a wrong first frame, never to
  // become a black screen when storage is unavailable.
  ready = true;
  listenForBackground();
  return lastError === null;
}

/** Both system bars, on every theme change — not only once at boot (A4-06). */
async function syncSystemBars(): Promise<void> {
  if (typeof document === "undefined") return;
  const light = document.documentElement.dataset["theme"] === "light";
  // The padded system-bar strip is native window background; match it to the canvas.
  const canvas = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
  if (canvas) {
    try {
      const { chromePlugin } = await import("./native/plugin");
      const chrome = await chromePlugin();
      await chrome?.setBackground({ color: canvas });
    } catch {
      /* an older shell without the plugin keeps its window colour */
    }
  }
  try {
    const core = await import("@capacitor/core");
    const bars = (
      core as unknown as { SystemBars?: { setStyle(o: { style: string }): Promise<void> } }
    ).SystemBars;
    if (bars) {
      await bars.setStyle({ style: light ? "LIGHT" : "DARK" });
      return;
    }
  } catch {
    /* SystemBars is the supported API; if it is missing the canvas colours still apply. */
  }
}

let barsObserved = false;
function observeSystemBars() {
  if (barsObserved || typeof MutationObserver === "undefined") return;
  barsObserved = true;
  const observer = new MutationObserver(() => void syncSystemBars());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
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
  // Hide first: applying the post-splash theme resets the window background to the
  // launch colour, so the canvas-coloured strip must be painted afterwards.
  await hideSplash();
  await syncSystemBars();
  observeSystemBars();
  // The Android 12+ splash applies its post-splash theme asynchronously; that theme owns
  // the window background again, so repaint the strip after it has settled.
  for (const delay of [250, 900]) {
    setTimeout(() => void syncSystemBars(), delay);
  }
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

/**
 * The single Android back decision. Overlays and the route handler cancel the event when
 * they take the press; otherwise the current screen stacks, and the root exits.
 */
export function dispatchBack(): void {
  if (typeof window === "undefined") return;
  const event = new CustomEvent("lingua:back", { cancelable: true });
  window.dispatchEvent(event);
  if (event.defaultPrevented) return;
  if (window.location.pathname !== "/") {
    window.history.back();
    return;
  }
  void import("@capacitor/app")
    .then(({ App }) => App.exitApp())
    .catch(() => {
      /* browser: nothing to exit */
    });
}

function leaveForeground() {
  window.dispatchEvent(new Event("lingua:flush"));
  void flushPlatform();
}

function listenForBackground() {
  if (typeof window === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leaveForeground();
  });
  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      await App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) leaveForeground();
      });
      // Android back is one event with one owner: an open overlay claims (cancels) it,
      // otherwise a non-root route goes back, and only the translator root exits. The
      // previous design let the route handler exit before a freshly-mounted sheet's
      // listener ran, so the sheet closed *and* the app quit (A4-03).
      await App.addListener("backButton", () => dispatchBack());
    } catch {
      /* the plugin is optional: the WebView's own lifecycle still applies */
    }
  })();
}

/**
 * Re-read the device snapshot after an import. Without this the module caches keep the
 * pre-import archive, phrasebook and memory, and the next whole-table save rewrites the
 * imported data from stale RAM (A3-03). Web storage is re-read lazily by the stores.
 */
export async function rehydrateDeviceData(): Promise<boolean> {
  if (!isNativeApp()) {
    history.reload();
    resetSavedCache();
    reloadMemory();
    return true;
  }
  try {
    const snapshot = await nativePort.hydrate();
    hydratePersist(snapshot.prefs, snapshot.session);
    hydrateHistory(snapshot.history, snapshot.historyTotal);
    hydrateSaved(snapshot.saved);
    hydrateMemory(snapshot.memory);
    applyStoredAppearance();
    setNativeSettingsReady(true);
    markNativeHydrated();
    lastError = null;
    return true;
  } catch {
    lastError = "bridge";
    return false;
  }
}

/** Test seam: forget the boot so a fresh snapshot can be applied. */
export function resetPlatformForTests() {
  ready = false;
  booted = false;
  lastError = null;
  setNativeSettingsReady(false);
  resetNativeHydrationForTests();
  forgetSettingsCache();
}
