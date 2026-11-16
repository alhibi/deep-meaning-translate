/**
 * Typed handle on the Kotlin `LinguaStore` Capacitor plugin.
 *
 * Everything crosses the bridge as JSON strings: one versioned DTO per call, validated on
 * both sides. The plugin is loaded lazily so the web bundle never depends on Capacitor
 * being present, and a missing plugin fails as a calm, persistence-disabled session
 * rather than a crash.
 */

export interface BridgeResult {
  ok: boolean;
}

export interface BootPayload {
  /** Every DataStore value, keyed by its `lingua.*` storage key. */
  settings: string;
  prefs: string | null;
  session: string | null;
  /** Newest-first window of the archive, so the translator opens with content. */
  history: string;
  historyTotal: number;
  /** The stored draft's write stamp; the next session write continues above it. */
  sessionSeq: number;
  saved: string;
  memory: string;
  schemaVersion: number;
}

export interface PagePayload {
  rows: string;
  total: number;
}

/** One coherent native dataset, read while the bridge operation lock is held. */
export interface SnapshotPayload {
  data: string;
}

export interface FilePayload {
  content: string | null;
  name?: string;
}

export interface LinguaStorePlugin {
  boot(): Promise<BootPayload>;
  settingsWrite(options: { key: string; value: string }): Promise<BridgeResult>;
  settingsRemove(options: { key: string }): Promise<BridgeResult>;
  settingsAll(): Promise<{ values: string }>;
  sessionWrite(options: { json: string | null; seq: number }): Promise<BridgeResult>;
  prefsWrite(options: { json: string | null }): Promise<BridgeResult>;
  historyPage(options: { limit: number; offset: number }): Promise<PagePayload>;
  historyCandidates(options: {
    target: string;
    normalized: string;
    recentSince: number;
  }): Promise<{ rows: string }>;
  historyUpsert(options: { rows: string }): Promise<{ total: number }>;
  historyDelete(options: { ids: string }): Promise<BridgeResult>;
  historyTrim(options: { limit: number }): Promise<BridgeResult>;
  historyAll(): Promise<{ rows: string }>;
  historyClear(): Promise<BridgeResult>;
  savedWrite(options: { rows: string }): Promise<BridgeResult>;
  memoryWrite(options: { rows: string }): Promise<BridgeResult>;
  /** All backup fields in one bridge operation; never compose this from several reads. */
  snapshot(): Promise<SnapshotPayload>;
  /** One transaction: everything is replaced, or nothing is. Provenance is optional. */
  replaceAll(options: {
    json: string;
    mode: "merge" | "replace";
    fileName?: string;
    digest?: string;
    /** The validated TS import report, recorded in import_meta. */
    report?: string;
  }): Promise<{ report: string }>;
  clearAll(): Promise<BridgeResult>;
}

export interface LinguaFilesPlugin {
  exportBackup(options: {
    filename: string;
    content: string;
  }): Promise<{ saved: boolean; name?: string }>;
  pickBackup(): Promise<FilePayload>;
}

export interface LinguaTtsPlugin {
  available(): Promise<{ ready: boolean }>;
  speak(options: { text: string; lang: string; rate: number }): Promise<BridgeResult>;
  stop(): Promise<BridgeResult>;
}

export interface LinguaChromePlugin {
  /** Paint the window strip behind the system bars with the active canvas colour. */
  setBackground(options: { color: string }): Promise<void>;
}

type PluginName = "LinguaStore" | "LinguaFiles" | "LinguaTts" | "LinguaChrome";

const cache = new Map<PluginName, unknown>();

/**
 * Capacitor's plugin object is a Proxy whose fallback getter builds a method for *any*
 * property — including `then`. An async function that returns the proxy therefore makes
 * the JS engine treat it as a thenable, call `then()`, and the bridge throws
 * `"LinguaStore.then()" is not implemented on android`. On the device that rejected every
 * load, so the app booted without Room/DataStore and silently lost persistence.
 *
 * Hiding `then` keeps the proxy a plain value for promise resolution while every real
 * method still passes through. Do not "simplify" this back to returning the raw proxy.
 */
export function asNonThenable<T extends object>(value: T): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      if (property === "then") return undefined;
      return Reflect.get(target, property, receiver);
    },
  });
}

async function load<T>(name: PluginName): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const hit = cache.get(name);
  if (hit) return hit as T;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const plugin = asNonThenable(registerPlugin<T>(name) as object);
    cache.set(name, plugin);
    return plugin as T;
  } catch {
    return null;
  }
}

export const storePlugin = () => load<LinguaStorePlugin>("LinguaStore");
export const filesPlugin = () => load<LinguaFilesPlugin>("LinguaFiles");
export const ttsPlugin = () => load<LinguaTtsPlugin>("LinguaTts");
export const chromePlugin = () => load<LinguaChromePlugin>("LinguaChrome");

/** Test seam: drop the cached handles so a fake bridge can be installed. */
export function resetPluginCacheForTests() {
  cache.clear();
}
