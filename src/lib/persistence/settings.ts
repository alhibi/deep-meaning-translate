/**
 * Small device settings (theme, locale, voice, feel, favourites, intro gate).
 *
 * One API, two backends:
 * - **web**: the same `localStorage` keys the app has always used;
 * - **Android**: a hydrated snapshot of Preferences DataStore, written back through the
 *   Kotlin plugin. Reads are synchronous because the snapshot is loaded before the
 *   translator renders; writes are promises and never pretend to be synchronous.
 *
 * This is not a second source of truth: in the app, DataStore is the only owner of these
 * values and this module is its in-memory view. There is no localStorage mirror.
 */
import { storePlugin } from "../native/plugin";
import { BACKUP_SETTING_KEYS } from "./contracts";

let nativeMode = false;
const snapshot = new Map<string, string>();

/** Sequential writes per key: a keystroke burst becomes one DataStore write, not thirty. */
const queued = new Map<string, string>();
const removals = new Set<string>();
let flushing: Promise<boolean> | null = null;
let lastWriteOk = true;

export function setNativeSettingsMode(on: boolean) {
  nativeMode = on;
}

export function isNativeSettings(): boolean {
  return nativeMode;
}

/** Replace the whole in-memory view with the DataStore snapshot read at boot. */
export function seedSettings(values: Record<string, string>) {
  snapshot.clear();
  for (const [k, v] of Object.entries(values)) if (typeof v === "string") snapshot.set(k, v);
}

export function seedOneSetting(key: string, value: string | null) {
  if (value === null) snapshot.delete(key);
  else snapshot.set(key, value);
}

/** Synchronous read of an already-validated value. Empty when absent. */
export function readDeviceValue(key: string): string | null {
  if (!nativeMode) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return snapshot.get(key) ?? null;
}

export function deviceValue(key: string, fallback: string): string {
  return readDeviceValue(key) ?? fallback;
}

/** False when the browser refuses storage entirely (private mode, blocked cookies). */
export function storageReachable(): boolean {
  if (nativeMode) return true;
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.getItem("lingua.probe");
    return true;
  } catch {
    return false;
  }
}

/** Apply the value in memory now, persist it in order. Returns whether the device kept it. */
export function writeDeviceValue(key: string, value: string): Promise<boolean> {
  if (!nativeMode) {
    try {
      window.localStorage.setItem(key, value);
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }
  snapshot.set(key, value);
  removals.delete(key);
  queued.set(key, value);
  return runQueue();
}

export function removeDeviceValue(key: string): Promise<boolean> {
  if (!nativeMode) {
    try {
      window.localStorage.removeItem(key);
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }
  snapshot.delete(key);
  queued.delete(key);
  removals.add(key);
  return runQueue();
}

/**
 * Every value this device holds that is actually a setting.
 *
 * Only the backup whitelist is returned: the same namespace also holds records
 * (`lingua.history.v1`, `lingua.session.v1`, …), and returning those as "settings" would
 * let a merge write a stale archive back over the freshly imported one.
 */
export function deviceSettingValues(): Record<string, string> {
  const allowed = new Set<string>(BACKUP_SETTING_KEYS);
  if (!nativeMode) {
    const out: Record<string, string> = {};
    try {
      for (const k of Object.keys(window.localStorage)) {
        if (!allowed.has(k)) continue;
        const v = window.localStorage.getItem(k);
        if (v !== null) out[k] = v;
      }
    } catch {
      /* storage blocked */
    }
    return out;
  }
  return Object.fromEntries([...snapshot].filter(([key]) => allowed.has(key)));
}

function runQueue(): Promise<boolean> {
  if (flushing) return flushing;
  flushing = (async () => {
    const plugin = await storePlugin();
    if (!plugin) {
      lastWriteOk = false;
      return false;
    }
    let ok = true;
    for (;;) {
      const nextKey = queued.keys().next();
      const nextRemoval = removals.values().next();
      if (nextKey.done && nextRemoval.done) break;
      if (!nextKey.done) {
        const key = nextKey.value;
        const value = queued.get(key);
        queued.delete(key);
        if (value === undefined) continue;
        const res = await plugin.settingsWrite({ key, value }).catch(() => ({ ok: false }));
        ok &&= res.ok;
      } else if (!nextRemoval.done) {
        const key = nextRemoval.value;
        removals.delete(key);
        const res = await plugin.settingsRemove({ key }).catch(() => ({ ok: false }));
        ok &&= res.ok;
      }
    }
    lastWriteOk = ok;
    return ok;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Await every queued setting write (called before the app is backgrounded). */
export async function flushSettings(): Promise<boolean> {
  if (!nativeMode) return true;
  if (flushing) await flushing;
  if (queued.size || removals.size) return runQueue();
  return lastWriteOk;
}

export function lastSettingsWriteOk(): boolean {
  return lastWriteOk;
}

/**
 * Drop every setting. On the web this removes the `lingua.*` keys (the data stores clear
 * their own records); on Android the plugin's `clearAll` has already emptied DataStore,
 * so only this module's view needs forgetting.
 */
export async function forgetSettingsCache(): Promise<void> {
  queued.clear();
  removals.clear();
  snapshot.clear();
  if (nativeMode) return;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("lingua.")) window.localStorage.removeItem(key);
    }
  } catch {
    /* storage blocked */
  }
}
