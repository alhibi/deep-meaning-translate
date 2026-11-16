import { useEffect, useState, useSyncExternalStore } from "react";
import { history, type HistoryEntry } from "../history";
import { isNativePersistence } from "../persistence";
import { readDeviceValue, writeDeviceValue } from "../persistence/settings";

/** Live view of the device archive. `null` during server render (nothing to read there). */
export function useArchive(): HistoryEntry[] | null {
  return useSyncExternalStore(history.subscribe, history.list, () => null);
}

/**
 * The statistics screen needs the whole archive to be correct; the translator only needs
 * the recent window it was hydrated with. This asks the native port for every row once
 * per mount in pages, instead of loading the archive for every screen in the app.
 */
export function useFullArchive(): HistoryEntry[] | null {
  const recent = useArchive();
  const [all, setAll] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (!isNativePersistence()) return;
    void history.all().then((rows) => {
      if (alive) setAll(rows);
    });
    return () => {
      alive = false;
    };
  }, [recent?.length]);
  if (!isNativePersistence()) return recent;
  return all;
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
    const v = JSON.parse(readDeviceValue(PREFS) ?? "null");
    return { insightsHidden: v?.insightsHidden === true };
  } catch {
    return { insightsHidden: false };
  }
}
export function writeStatsPrefs(p: { insightsHidden: boolean }) {
  void writeDeviceValue(PREFS, JSON.stringify(p));
}
