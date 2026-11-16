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
  saved: string;
  memory: string;
  schemaVersion: number;
}

export interface PagePayload {
  rows: string;
  total: number;
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
  /** One transaction: everything is replaced, or nothing is. */
  replaceAll(options: { json: string; mode: "merge" | "replace" }): Promise<{ report: string }>;
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

type PluginName = "LinguaStore" | "LinguaFiles" | "LinguaTts";

const cache = new Map<PluginName, unknown>();

async function load<T>(name: PluginName): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const hit = cache.get(name);
  if (hit) return hit as T;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const plugin = registerPlugin<T>(name);
    cache.set(name, plugin);
    return plugin;
  } catch {
    return null;
  }
}

export const storePlugin = () => load<LinguaStorePlugin>("LinguaStore");
export const filesPlugin = () => load<LinguaFilesPlugin>("LinguaFiles");
export const ttsPlugin = () => load<LinguaTtsPlugin>("LinguaTts");

/** Test seam: drop the cached handles so a fake bridge can be installed. */
export function resetPluginCacheForTests() {
  cache.clear();
}
