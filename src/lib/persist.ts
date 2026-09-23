import type { Dialect, StyleOverride, TranslationResult } from "./translation/types";

/**
 * Intentional, device-only persistence. Nothing here leaves the device.
 * - prefs: language pair + style (not sensitive)
 * - session: the current draft and its latest translation, so the app feels continuous
 */
const PREFS = "lingua.prefs.v1";
const SESSION = "lingua.session.v1";

export interface Prefs {
  source: string;
  target: string;
  style: StyleOverride;
  dialect?: Dialect;
}
export interface Session {
  text: string;
  result: TranslationResult | null;
  source: string;
  target: string;
  style: StyleOverride;
}

function get<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function set(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — persistence is a convenience */
  }
}

export const persist = {
  prefs: () => get<Prefs>(PREFS),
  savePrefs: (p: Prefs) => set(PREFS, p),
  session: () => get<Session>(SESSION),
  saveSession: (s: Session | null) => set(SESSION, s && s.text.trim() ? s : null),
  /** Remove everything Lingua keeps on this device. */
  clearAll() {
    try {
      for (const k of Object.keys(window.localStorage))
        if (k.startsWith("lingua.")) window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};
