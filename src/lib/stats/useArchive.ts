import { useSyncExternalStore } from "react";
import { history, type HistoryEntry } from "../history";

/** Live view of the device archive. `null` during server render (nothing to read there). */
export function useArchive(): HistoryEntry[] | null {
  return useSyncExternalStore(history.subscribe, history.list, () => null);
}

/**
 * Hand-off from Statistics to the translator: "open this translation" sets it here,
 * the translator picks it up once on mount. In-memory only — never persisted.
 */
export interface PendingPick {
  original: string;
  source: string;
  target: string;
}
let pending: PendingPick | null = null;
export function setPendingPick(p: PendingPick) {
  pending = p;
}
export function takePendingPick(): PendingPick | null {
  const p = pending;
  pending = null;
  return p;
}

const PREFS = "lingua.stats.v1";
export function readStatsPrefs(): { insightsHidden: boolean } {
  try {
    const v = JSON.parse(window.localStorage.getItem(PREFS) ?? "null");
    return { insightsHidden: v?.insightsHidden === true };
  } catch {
    return { insightsHidden: false };
  }
}
export function writeStatsPrefs(p: { insightsHidden: boolean }) {
  try {
    window.localStorage.setItem(PREFS, JSON.stringify(p));
  } catch {
    /* non-essential */
  }
}
