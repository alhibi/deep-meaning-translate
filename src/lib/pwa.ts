// The single service-worker registrar. Never registers in dev, iframes or Lovable previews.
import { isNativeApp } from "./native/config";

const SW_URL = "/sw.js";

function refused(): boolean {
  if (!import.meta.env.PROD) return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const h = window.location.hostname;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return true;
  if (/(^|\.)lovableproject(-dev)?\.com$/.test(h)) return true;
  if (h === "beta.lovable.dev" || h.endsWith(".beta.lovable.dev")) return true;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

async function unregisterOurs() {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs
      .filter((r) => (r.active ?? r.installing ?? r.waiting)?.scriptURL.endsWith(SW_URL))
      .map((r) => r.unregister()),
  );
}

/* ------------------------------------------------------------ update signal */

/**
 * With auto-update the new worker activates and claims this page immediately, but the
 * document already running still holds the old chunks. A quiet, dismissible "reload"
 * pill is the honest way to reach the new build: never a forced reload while someone is
 * mid-sentence, never a stale page pretending to be current.
 */
let updateReady = false;
const updateListeners = new Set<() => void>();

export function subscribeAppUpdate(fn: () => void) {
  updateListeners.add(fn);
  return () => void updateListeners.delete(fn);
}

export const appUpdateAvailable = () => updateReady;

/**
 * Pure decision so the rule is testable: only a page that already had a controller can
 * be told that a new worker took over. The first install also fires the
 * controllerchange event when the new worker claims the page, and that is not an update.
 */
export function shouldAnnounceUpdate(
  hadController: boolean,
  nextController: unknown,
  alreadyReady: boolean,
): boolean {
  return hadController && !alreadyReady && !!nextController;
}

function announceUpdate() {
  if (updateReady) return;
  updateReady = true;
  for (const fn of updateListeners) fn();
}

export function initServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // The APK ships its shell inside the package. A worker here could only serve a stale
  // asset over a newer APK, so the native build never registers one.
  if (isNativeApp()) return;
  if (refused()) {
    void unregisterOurs().catch(() => undefined);
    return;
  }
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (shouldAnnounceUpdate(hadController, navigator.serviceWorker.controller, updateReady))
      announceUpdate();
  });
  const register = () =>
    navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch(() => undefined);
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/** Update the app icon badge (e.g. phrases due for review) when supported by the OS/PWA. */
export function updateAppBadge(count: number) {
  if (typeof navigator === "undefined") return;
  const nav = navigator as unknown as {
    setAppBadge?: (contents?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0 && nav.setAppBadge) {
      void nav.setAppBadge(count).catch(() => {});
    } else if (nav.clearAppBadge) {
      void nav.clearAppBadge().catch(() => {});
    }
  } catch {
    /* badge API optional */
  }
}
