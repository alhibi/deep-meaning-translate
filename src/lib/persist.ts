import { isNativeApp } from "./native/config";
import { port } from "./persistence";
import { parsePrefs, parseSession, type Prefs, type Session } from "./persistence/contracts";
import {
  nextSessionTimestamp,
  readSessionMeta,
  readSessionRecord,
  tabOrigin,
  writeSessionState,
} from "./persistence/web";

export { parsePrefs, parseSession, isSourceCode, isTargetCode } from "./persistence/contracts";
export type { Prefs, Session } from "./persistence/contracts";

/**
 * Intentional, device-only persistence. Nothing here leaves the device.
 * - prefs: language pair + style (not sensitive)
 * - session: the current draft and its latest translation, so the app feels continuous
 * Everything read back is validated: damaged or foreign values are dropped, never trusted.
 *
 * In the Android app the durable copy is a Room row written through the native port; in
 * the browser it is the same `lingua.session.v1` value as before, now carrying the recency
 * metadata the web adapter defines. `savePrefs` and `saveSession` are asynchronous and
 * report whether the device kept the value — a failed write is never reported as saved.
 *
 * Two browser-only rules live here, because they concern the app's view of storage rather
 * than one backend:
 * - **Stale session writes are refused.** A tab that has seen another tab's newer draft
 *   must not overwrite it, so closing an old tab cannot erase work done since (TD14).
 * - **Other tabs' writes are observed.** `storage` events for prefs/session update the
 *   remembered values and notify subscribers; a local write notifies them too, so a
 *   mounted view can re-render from the same store without a reload or a poll.
 */
const PREFS = "lingua.prefs.v1";
const SESSION = "lingua.session.v1";
const native = isNativeApp();

/**
 * What happened to a session write.
 * - `saved`: the device now holds this draft;
 * - `refused-stale`: another tab wrote a newer draft, so this write was dropped;
 * - `failed`: the device refused the write (quota, private mode, unavailable bridge).
 * A refusal is a normal outcome, not an error: the caller is a debounced or page-hide
 * flush, and throwing there would only produce an unhandled rejection.
 */
export type SessionSaveResult = "saved" | "refused-stale" | "failed";

/**
 * In-memory memory of this tab's own last values.
 *
 * Route components unmount on navigation; the translator must not remount empty.
 * This copy lives as long as the tab, is never read during server rendering, and is
 * only an initial value: storage stays the single source of truth across reloads.
 */
let rememberedPrefs: Prefs | null = null;
let rememberedSession: Session | null = null;

/**
 * Stable snapshot object for a `useSyncExternalStore` consumer: replaced only when a
 * remembered value actually changes, so reading it during render cannot loop.
 */
let rememberedSnapshot: { prefs: Prefs | null; session: Session | null } = {
  prefs: null,
  session: null,
};

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function setRemembered(next: { prefs?: Prefs | null; session?: Session | null }, broadcast = true) {
  const prefs = next.prefs === undefined ? rememberedPrefs : next.prefs;
  const session = next.session === undefined ? rememberedSession : next.session;
  if (prefs === rememberedPrefs && session === rememberedSession) return;
  rememberedPrefs = prefs;
  rememberedSession = session;
  rememberedSnapshot = { prefs, session };
  if (broadcast) notify();
}

/** Hydrated values from the native snapshot; null on the web (localStorage is read live). */
let cache: { prefs: Prefs | null; session: Session | null } | null = null;

/** Called once by the platform boot with the validated native snapshot. */
export function hydratePersist(prefs: Prefs | null, session: Session | null) {
  cache = { prefs, session };
  setRemembered({ prefs, session });
}

/** Test seam and "forget everything": drop the tab's remembered copy. */
export function resetPersistCache() {
  cache = null;
  setRemembered({ prefs: null, session: null });
}

/* --------------------------------------------------------------- session recency (TD14) */

/** Highest session write time this tab has seen: its boot read, storage events, own writes. */
let seenSessionAt = 0;
let recencyObserved = false;

/**
 * The first look at storage is also a recency observation: a tab that boots after another
 * tab's draft must not overwrite it on its first flush.
 */
function observeRecency(): number {
  if (native) return 0;
  if (!recencyObserved) {
    recencyObserved = true;
    seenSessionAt = readSessionMeta()?.at ?? 0;
  }
  return seenSessionAt;
}

/**
 * Test seam and "forget everything": forget the in-memory recency epoch. The next write is
 * judged only against what is stored, so after an explicit clear it wins.
 */
export function resetPersistRecency() {
  seenSessionAt = 0;
  recencyObserved = false;
}

function readRaw(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

/**
 * Another tab wrote prefs/session (or cleared storage). Re-read only what changed and
 * publish it to subscribers; there is no reload and no polling.
 */
function onExternalChange(key: string | null) {
  if (native) return;
  if (key === null || key === PREFS) {
    const prefs = parsePrefs(readRaw(PREFS));
    setRemembered({ prefs });
    if (cache) cache.prefs = prefs;
  }
  if (key === null || key === SESSION) {
    const meta = readSessionMeta();
    const session = readSessionRecord();
    if (meta) seenSessionAt = Math.max(seenSessionAt, meta.at);
    // An explicit clear (no record at all) starts a fresh recency epoch: the next write in
    // any tab wins, which is what "forget everything" means.
    else if (!session) seenSessionAt = 0;
    recencyObserved = true;
    setRemembered({ session });
    if (cache) cache.session = session;
  }
}

if (typeof window !== "undefined" && !native) {
  // Browser tabs broadcast writes through `storage`; the same tab is notified by the save
  // methods below. A local write therefore reaches every other tab without an event bus.
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === PREFS || event.key === SESSION)
      onExternalChange(event.key);
  });
}

export const persist = {
  prefs: (): Prefs | null => {
    if (cache) return cache.prefs;
    if (native) return null;
    return parsePrefs(readRaw(PREFS));
  },
  savePrefs: async (p: Prefs | null): Promise<boolean> => {
    const valid = parsePrefs(p);
    setRemembered({ prefs: valid });
    if (cache) cache.prefs = valid;
    try {
      return await port.savePrefs(valid);
    } catch {
      return false;
    }
  },
  session: (): Session | null => {
    if (cache) return cache.session;
    if (native) return null;
    observeRecency();
    return readSessionRecord();
  },
  saveSession: async (s: Session | null): Promise<SessionSaveResult> => {
    const valid = parseSession(s);
    // The tab always remembers its own intent, even when storage declines or another tab
    // holds the newer draft: this value is what a route remount in this tab restores.
    setRemembered({ session: valid });
    if (cache) cache.session = valid;
    if (native) {
      try {
        return (await port.saveSession(valid)) ? "saved" : "failed";
      } catch {
        return "failed";
      }
    }
    const seen = observeRecency();
    const stored = readSessionMeta();
    // Another tab wrote after this tab's last look. Keep its draft; do not throw — the
    // caller is a flush, and a live error surface for a lost draft would be noise on a
    // screen the person is leaving.
    if (stored && stored.at > seen) return "refused-stale";
    const at = nextSessionTimestamp(seen);
    if (!writeSessionState(valid, { at, origin: tabOrigin() })) return "failed";
    seenSessionAt = Math.max(seenSessionAt, at);
    recencyObserved = true;
    return "saved";
  },
  /**
   * The last values this tab held, for a route that is being mounted again.
   * Empty on server rendering and on the first visit; never a substitute for storage.
   * Stable between changes so it can be read by `useSyncExternalStore`.
   */
  remembered: (): { prefs: Prefs | null; session: Session | null } => rememberedSnapshot,
  /**
   * Subscribe to cross-tab and local persistence changes (prefs/session). Returns an
   * unsubscribe function. Pair it with `remembered()` as the snapshot: React only calls
   * this from an effect, never from render, and this module never calls React.
   */
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /** Remove everything Lingua keeps on this device. */
  async clearAll(): Promise<void> {
    cache = null;
    setRemembered({ prefs: null, session: null });
    resetPersistRecency();
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
