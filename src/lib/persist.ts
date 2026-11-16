import { isNativeApp } from "./native/config";
import { port } from "./persistence";
import { parsePrefs, parseSession, type Prefs, type Session } from "./persistence/contracts";

export { parsePrefs, parseSession, isSourceCode, isTargetCode } from "./persistence/contracts";
export type { Prefs, Session } from "./persistence/contracts";

/**
 * Intentional, device-only persistence. Nothing here leaves the device.
 * - prefs: language pair + style (not sensitive)
 * - session: the current draft and its latest translation, so the app feels continuous
 * Everything read back is validated: damaged or foreign values are dropped, never trusted.
 *
 * In the Android app the durable copy is a Room row written through the native port; in
 * the browser it is the same `lingua.session.v1` value as before. `savePrefs` and
 * `saveSession` are asynchronous and report whether the device kept the value — a
 * failed write is never reported as saved.
 */
const PREFS = "lingua.prefs.v1";
const SESSION = "lingua.session.v1";
const native = isNativeApp();

/**
 * In-memory memory of this tab's own last values.
 *
 * Route components unmount on navigation; the translator must not remount empty.
 * This copy lives as long as the tab, is never read during server rendering, and is
 * only an initial value: storage stays the single source of truth across reloads.
 */
let rememberedPrefs: Prefs | null = null;
let rememberedSession: Session | null = null;

/** Hydrated values from the native snapshot; null on the web (localStorage is read live). */
let cache: { prefs: Prefs | null; session: Session | null } | null = null;

/** Called once by the platform boot with the validated native snapshot. */
export function hydratePersist(prefs: Prefs | null, session: Session | null) {
  cache = { prefs, session };
  rememberedPrefs = prefs;
  rememberedSession = session;
}

/** Test seam and "forget everything": drop the tab's remembered copy. */
export function resetPersistCache() {
  cache = null;
  rememberedPrefs = null;
  rememberedSession = null;
}

export const persist = {
  prefs: (): Prefs | null => {
    if (cache) return cache.prefs;
    if (native) return null;
    try {
      return parsePrefs(JSON.parse(window.localStorage.getItem(PREFS) ?? "null"));
    } catch {
      return null;
    }
  },
  savePrefs: async (p: Prefs | null): Promise<boolean> => {
    const valid = parsePrefs(p);
    rememberedPrefs = valid;
    if (cache) cache.prefs = valid;
    return port.savePrefs(valid);
  },
  session: (): Session | null => {
    if (cache) return cache.session;
    if (native) return null;
    try {
      return parseSession(JSON.parse(window.localStorage.getItem(SESSION) ?? "null"));
    } catch {
      return null;
    }
  },
  saveSession: async (s: Session | null): Promise<boolean> => {
    const valid = parseSession(s);
    rememberedSession = valid;
    if (cache) cache.session = valid;
    return port.saveSession(valid);
  },
  /**
   * The last values this tab held, for a route that is being mounted again.
   * Empty on server rendering and on the first visit; never a substitute for storage.
   */
  remembered: (): { prefs: Prefs | null; session: Session | null } => ({
    prefs: rememberedPrefs,
    session: rememberedSession,
  }),
  /** Remove everything Lingua keeps on this device. */
  async clearAll(): Promise<void> {
    rememberedPrefs = null;
    rememberedSession = null;
    cache = null;
    await port.clearAll();
  },
  /**
   * Ask the browser not to evict our storage under pressure. Best effort: the
   * browser may decline, and the user can always clear site data themselves.
   * A native install needs none of this — Room is not evicted like a website's storage.
   */
  async requestDurable(): Promise<boolean> {
    try {
      if (!navigator.storage?.persist) return false;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  },
};
