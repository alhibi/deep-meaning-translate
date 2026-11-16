/**
 * Where the installed app talks to the service.
 *
 * The APK ships its UI inside the WebView, so a relative `/api/...` would ask the local
 * asset server and never reach the Worker. The base URL is therefore explicit, compiled
 * in through `VITE_NATIVE_API_BASE`, and validated: HTTPS only, no path, no wildcard.
 * A missing or invalid value disables the network path with a calm error instead of
 * silently sending requests to the wrong place.
 */

export const DEFAULT_NATIVE_API_BASE = "https://fluently.today";

/** True only inside the Capacitor WebView, never in a normal browser tab. */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }
  ).Capacitor;
  if (!cap) return false;
  try {
    return cap.isNativePlatform?.() === true || cap.getPlatform?.() === "android";
  } catch {
    return false;
  }
}

function normalizeBase(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "10.0.2.2"))
    return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  return url.origin;
}

/** The validated base URL, or null when the build was configured wrong. */
export function nativeApiBase(): string | null {
  const configured = import.meta.env?.["VITE_NATIVE_API_BASE"] as string | undefined;
  return normalizeBase(configured ?? DEFAULT_NATIVE_API_BASE);
}

/** Absolute URL for a native endpoint, or null when no valid base exists. */
export function nativeApiUrl(path: string): string | null {
  if (!path.startsWith("/api/native/")) return null;
  const base = nativeApiBase();
  return base ? `${base}${path}` : null;
}
