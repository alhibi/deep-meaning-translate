import { isNativeApp } from "./native/config";
import { port } from "./persistence";
import {
  HISTORY_LIMIT,
  isEntry,
  normalizeText as norm,
  sanitizeEntry,
  type EntryTags,
  type HistoryEntry,
} from "./persistence/contracts";
import { readHistoryRaw, readHistorySnapshot, webPort, writeHistorySync } from "./persistence/web";

export { HISTORY_LIMIT, isEntry, sanitizeEntry } from "./persistence/contracts";
export type { EntryTags, HistoryEntry } from "./persistence/contracts";

/**
 * One translation archive, shared by the translator and Translation Statistics.
 * Rows written before statistics existed have no `v`; they stay valid and are
 * counted as imported ("legacy") rows — never copied, so nothing is counted twice.
 *
 * Writes are asynchronous: the cache is updated first (so the next render is correct),
 * then the durable row is written by the active port. In Android that is a Room upsert;
 * in the browser it is the same localStorage document as before. A save that the device
 * refused is reported through `lastWriteOk()`, never hidden.
 */
const MAX_TEXT = 5000;
/** Native in-memory window: the newest rows, never the whole archive. */
const RECENT_WINDOW = 500;
/** Re-translating the same text sooner than this is the same occasion, not a new use. */
const NEW_USE_AFTER = 30 * 60_000;
/** A sentence that grows while typing within this window is the same thought. */
const GROW_WINDOW = 3 * 60_000;

export type HistoryStatus = "ok" | "unavailable";
let status: HistoryStatus = "ok";
let lastWriteOk = true;
let lastEvicted = 0;
const native = isNativeApp();
/** Newest-first window; on Android this is the recent page, not the whole archive. */
let cache: HistoryEntry[] | null = null;
/**
 * Native only: the complete archive once Statistics has read it. Statistics re-derives on
 * every archive revision, so the full list is kept here and patched in place by writes
 * instead of being fetched over the bridge again for each correction.
 */
let fullArchive: HistoryEntry[] | null = null;
let total = 0;
/**
 * The exact `lingua.history.v1` document the cache was read from or last wrote. A
 * `storage` event is asynchronous, so comparing this token with storage before a
 * whole-array write is what stops a stale snapshot from erasing another tab's rows.
 */
let cacheToken: string | null = null;
/** Native only: the cache holds the whole archive, not just the recent boot window. */
let complete = false;
/** Changes only when archive content changes, not when a native screen refreshes its view. */
let revision = 0;
const listeners = new Set<() => void>();

/**
 * Keep the full-archive snapshot Statistics already paid for consistent with a write.
 * Without this, a tag correction or an exact re-translation would need another full fetch
 * (or, worse, Statistics would show the stale list).
 */
function patchFullArchive(row: HistoryEntry, removed: string[]) {
  if (!native || !fullArchive) return;
  const map = new Map(fullArchive.map((e) => [e.id, e]));
  map.set(row.id, row);
  for (const id of removed) map.delete(id);
  fullArchive = [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function emit(contentChanged = true) {
  if (contentChanged) revision += 1;
  for (const l of listeners) l();
}

function current(): HistoryEntry[] {
  if (cache === null) {
    if (native) {
      cache = [];
    } else {
      const snapshot = readHistorySnapshot();
      cache = snapshot.rows;
      cacheToken = snapshot.raw;
    }
    total = cache.length;
  }
  return cache;
}

/**
 * Re-read the archive when the stored document is not the one this tab last read/wrote.
 * Only the web backend needs it: it is the only one whose archive is a single JSON array,
 * so a save rewrites every row and a stale snapshot would drop the rows another tab added
 * while this tab was translating.
 */
function refreshIfStorageChanged(): void {
  if (native || typeof window === "undefined" || cache === null) return;
  // The string comparison is the cheap path; parsing 2,000 rows happens only when another
  // tab actually wrote, never on an ordinary save.
  if (readHistoryRaw() === cacheToken) return;
  const snapshot = readHistorySnapshot();
  cache = snapshot.rows;
  cacheToken = snapshot.raw;
  total = snapshot.rows.length;
}

/**
 * Called once by the platform boot with the validated native snapshot. When the window
 * already holds every stored row (the boot page is at least the whole archive), the
 * statistics screen can skip its full-archive fetch; otherwise `all()` fetches once.
 */
export function hydrateHistory(rows: HistoryEntry[], totalRows: number) {
  cache = rows;
  total = totalRows;
  cacheToken = null;
  complete = native && rows.length === totalRows;
  fullArchive = complete ? rows : null;
  emit();
}

export interface NewEntry {
  source: string;
  target: string;
  original: string;
  translated: string;
  style?: string | undefined;
  formality?: string | undefined;
  situation?: string | undefined;
  tags?: EntryTags | undefined;
}

if (typeof window !== "undefined" && !native) {
  // Another tab changed the archive: re-read so statistics never show stale numbers.
  window.addEventListener("storage", (e) => {
    if (e.key === "lingua.history.v1" || e.key === null) {
      cache = null;
      cacheToken = null;
      complete = false;
      emit();
    }
  });
}

async function candidates(entry: NewEntry, now: number, key: string): Promise<HistoryEntry[]> {
  if (!native) return current();
  try {
    return await port.historyCandidates({
      target: entry.target,
      normalized: key,
      recentSince: now - GROW_WINDOW,
    });
  } catch {
    // The bridge is unavailable: still merge within the hydrated window rather than
    // creating a duplicate row we can see.
    return current();
  }
}

export const history = {
  list: (): HistoryEntry[] => current(),
  status: (): HistoryStatus => (current(), status),
  lastWriteOk: () => lastWriteOk,
  /** Rows dropped from the oldest end by the most recent save to fit the device quota. */
  lastEvicted: () => lastEvicted,
  /** Total rows held by the device, including ones older than the hydrated window. */
  /** Native archives are not capped; the browser still answers inside its own quota. */
  count: (): number => {
    current();
    const known = Math.max(total, cache?.length ?? 0);
    return native ? known : Math.min(HISTORY_LIMIT, known);
  },
  /** Monotonic content revision for views that maintain a separate full-archive snapshot. */
  revision: (): number => revision,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  /** Forces a fresh read from storage (used by "try again"). */
  reload() {
    cache = null;
    fullArchive = null;
    emit();
  },
  /**
   * The whole archive, for statistics and search — requested by those screens only.
   * A cache known to hold every row is reused: a tag correction or an exact
   * re-translation changes one row, not the archive, and refetching up to 2,000 rows
   * over the bridge for that would be the statistics screen's largest read.
   */
  async all(): Promise<HistoryEntry[]> {
    if (!native) return current();
    if (complete) return current();
    if (complete && fullArchive) return fullArchive;
    try {
      // Native has no row cap: this is the one full-archive read, cached until a write
      // changes the archive. The translator keeps only the recent window; the full list is
      // returned to Statistics, which is the only consumer that needs it.
      const rows = await port.historyAll();
      cache = rows.slice(0, RECENT_WINDOW);
      total = rows.length;
      cacheToken = null;
      complete = true;
      fullArchive = rows;
      emit(false);
      return rows;
    } catch {
      status = "unavailable";
      complete = false;
      return current();
    }
  },
  /** One page for a screen that shows the archive; never the whole file. */
  async page(limit: number, offset: number) {
    if (!native) {
      const rows = current();
      return { rows: rows.slice(offset, offset + limit), total: rows.length };
    }
    return port.historyPage(limit, offset);
  },
  /**
   * Records a settled translation. The same text again updates its row in place
   * (no duplicate, original date kept); a sentence that grew while typing replaces
   * its shorter versions. `quiet` re-displays (e.g. a restored draft) never count as a use.
   */
  async add(entry: NewEntry, opts: { quiet?: boolean } = {}): Promise<HistoryEntry[]> {
    // Only real, finished translations into a real language are archived.
    if (!/^[a-z]{2}$/.test(entry.target) || !entry.translated.trim() || !entry.original.trim())
      return current();
    const now = Date.now();
    const original = entry.original.slice(0, MAX_TEXT);
    const key = norm(original);
    refreshIfStorageChanged();
    const rows = current();
    // Room needs a query, which is a real await. A browser's localStorage write is
    // synchronous, so the web path performs the merge and the write in one turn —
    // exactly the behaviour this archive had before the port existed.
    const pool = native ? await candidates(entry, now, key) : rows;
    // Another save may have committed while the Room query was in flight; merge into the
    // cache as it is now, not the window captured before the await.
    const baseRows = native ? current() : rows;
    const totalBefore = total;
    const merged: HistoryEntry[] = [];
    const rest: HistoryEntry[] = [...baseRows];
    for (const e of pool) {
      if (e.target !== entry.target) continue;
      const ek = norm(e.original);
      const recent = now - (e.updatedAt ?? e.createdAt) < GROW_WINDOW;
      if (ek === key || (recent && (key.startsWith(ek) || ek.startsWith(key)))) {
        merged.push(e);
        const at = rest.findIndex((r) => r.id === e.id);
        if (at >= 0) rest.splice(at, 1);
      }
    }
    const same = merged.find((e) => norm(e.original) === key);
    const base = same ?? merged[0];
    let uses = Math.max(1, ...merged.map((e) => e.uses ?? 1));
    if (same && !opts.quiet && now - (same.updatedAt ?? same.createdAt) >= NEW_USE_AFTER) uses += 1;
    const row = sanitizeEntry({
      id: base?.id ?? `${now}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: merged.length ? Math.min(...merged.map((e) => e.createdAt)) : now,
      v: 2,
      updatedAt: now,
      uses,
      source: entry.source,
      target: entry.target,
      original,
      translated: entry.translated,
      style: entry.style ?? base?.style,
      formality: entry.formality || base?.formality,
      situation: entry.situation ?? base?.situation,
      // A provisional settle carries no tags; keep the model's earlier ones.
      tags: entry.tags ?? (same ? base?.tags : undefined),
      fix: same?.fix,
    });
    const removed = merged.filter((e) => e.id !== row.id).map((e) => e.id);
    // `row.id` may already be in Room even when it is outside the recent UI window.
    // Re-translating it is an update, not a new archive row; counting it as a new row
    // made the native badge/stats total drift upward on every later use.
    const existed = merged.some((e) => e.id === row.id);
    patchFullArchive(row, removed);
    cache = [row, ...rest].slice(0, native ? RECENT_WINDOW : HISTORY_LIMIT);
    total = Math.max(totalBefore + (existed ? 0 : 1) - removed.length, cache.length);
    emit();
    if (!native) {
      const written = writeHistorySync(cache);
      cache = written.rows;
      // The document is the truth: a full archive that shed its oldest row holds fewer
      // rows than the session has seen, and the reported total must not keep climbing.
      total = cache.length;
      if (written.ok) cacheToken = written.raw;
      lastWriteOk = written.ok;
      lastEvicted = webPort.lastEvicted();
    } else {
      try {
        await port.historyUpsert([row]);
        if (removed.length) await port.historyDelete(removed);
        // No trim on native: the archive keeps every settled sentence. Only the browser
        // fallback rewrites a bounded document (see the web branch above).
        lastWriteOk = true;
        // The optimistic emit may have raced the Room transaction. Publish one durable
        // revision once it commits so a mounted full-archive statistics view refetches.
        emit();
      } catch {
        // Keep the in-memory row: the person sees their translation, and the next save
        // retries. A silent "saved" would be the actual failure.
        complete = false;
        lastWriteOk = false;
      }
    }
    return cache;
  },
  /** Corrects classification without touching dates, text or counts. `null` resets a field to automatic. */
  async retag(
    id: string,
    fix: { [K in keyof EntryTags]?: EntryTags[K] | null },
  ): Promise<HistoryEntry[]> {
    refreshIfStorageChanged();
    const next = current().map((e) => {
      if (e.id !== id) return e;
      const patch: Record<string, unknown> = { ...e.fix };
      for (const [k, v] of Object.entries(fix)) {
        if (v === null) delete patch[k];
        else patch[k] = v;
      }
      return sanitizeEntry({ ...e, fix: patch as EntryTags });
    });
    cache = next;
    emit();
    const row = next.find((e) => e.id === id);
    if (!native) {
      const written = writeHistorySync(next);
      cache = written.rows;
      total = cache.length;
      if (written.ok) cacheToken = written.raw;
      lastWriteOk = written.ok;
    } else if (row) {
      patchFullArchive(row, []);
      try {
        await port.historyUpsert([row]);
        lastWriteOk = true;
        emit();
      } catch {
        complete = false;
        lastWriteOk = false;
      }
    }
    return next;
  },
  async remove(id: string): Promise<HistoryEntry[]> {
    refreshIfStorageChanged();
    const next = current().filter((e) => e.id !== id);
    cache = next;
    total = Math.max(0, total - 1);
    emit();
    if (!native) {
      const written = writeHistorySync(next);
      cache = written.rows;
      total = cache.length;
      if (written.ok) cacheToken = written.raw;
      lastWriteOk = written.ok;
    } else {
      if (fullArchive) fullArchive = fullArchive.filter((e) => e.id !== id);
      try {
        await port.historyDelete([id]);
        lastWriteOk = true;
        emit();
      } catch {
        complete = false;
        lastWriteOk = false;
      }
    }
    return next;
  },
  async clear(): Promise<HistoryEntry[]> {
    cache = [];
    fullArchive = [];
    complete = true;
    total = 0;
    emit();
    if (!native) {
      const written = writeHistorySync([]);
      if (written.ok) cacheToken = written.raw;
      lastWriteOk = written.ok;
    } else {
      try {
        await port.historyClear();
        complete = true;
        lastWriteOk = true;
        emit();
      } catch {
        complete = false;
        lastWriteOk = false;
      }
    }
    return cache;
  },
};
