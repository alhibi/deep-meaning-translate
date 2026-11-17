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
  const revision = history.revision();
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
    // A tag correction or an exact re-translation does not change row count, but it
    // absolutely changes the statistics. `history.all()` deliberately does not advance
    // this revision, avoiding a full-archive fetch loop after its own refresh.
  }, [revision]);
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
/** Shape of the statistics-related preference; one object, shared by readers. */
export interface StatsPrefs {
  insightsHidden: boolean;
}

const DEFAULT_PREFS: StatsPrefs = { insightsHidden: false };
/**
 * The route reads this during render (routes/stats.tsx:162), and the page re-renders on
 * every sheet, metric toggle and URL sync. The stored string is the source of truth and is
 * compared on every read, so a cross-tab change or a cleared device is seen immediately;
 * only a changed value costs a JSON.parse. The returned object is stable for one value,
 * which also keeps the render-time comparison cheap.
 */
let prefsCache: { raw: string | null; value: StatsPrefs } | null = null;

export function readStatsPrefs(): StatsPrefs {
  const raw = readDeviceValue(PREFS);
  if (prefsCache && prefsCache.raw === raw) return prefsCache.value;
  let value: StatsPrefs;
  try {
    const parsed = JSON.parse(raw ?? "null") as { insightsHidden?: unknown } | null;
    value = { insightsHidden: parsed?.insightsHidden === true };
  } catch {
    value = DEFAULT_PREFS;
  }
  prefsCache = { raw, value };
  return value;
}

export function writeStatsPrefs(p: { insightsHidden: boolean }) {
  const value: StatsPrefs = { insightsHidden: p.insightsHidden === true };
  const raw = JSON.stringify(value);
  // The web write is synchronous and the native write updates its snapshot synchronously,
  // so priming the cache with the value the next read will see is not an assumption.
  prefsCache = { raw, value };
  void writeDeviceValue(PREFS, raw);
}
