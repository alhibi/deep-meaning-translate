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
import { readHistory, webPort, writeHistorySync } from "./persistence/web";

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
let total = 0;
/** Changes only when archive content changes, not when a native screen refreshes its view. */
let revision = 0;
const listeners = new Set<() => void>();

function emit(contentChanged = true) {
  if (contentChanged) revision += 1;
  for (const l of listeners) l();
}

function current(): HistoryEntry[] {
  if (cache === null) {
    cache = native ? [] : readHistory();
    total = cache.length;
  }
  return cache;
}

/** Called once by the platform boot with the validated native snapshot. */
export function hydrateHistory(rows: HistoryEntry[], totalRows: number) {
  cache = rows;
  total = totalRows;
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
  count: (): number => (current(), Math.max(total, cache?.length ?? 0)),
  /** Monotonic content revision for views that maintain a separate full-archive snapshot. */
  revision: (): number => revision,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  /** Forces a fresh read from storage (used by "try again"). */
  reload() {
    cache = null;
    emit();
  },
  /** The whole archive, for statistics and search — requested by those screens only. */
  async all(): Promise<HistoryEntry[]> {
    if (!native) return current();
    try {
      const rows = await port.historyAll();
      cache = rows.slice(0, HISTORY_LIMIT);
      total = rows.length;
      // Fetching the full archive changes the window, not the archive itself. In
      // particular, it must not make useFullArchive fetch the same 2,000 rows again.
      emit(false);
      return rows;
    } catch {
      status = "unavailable";
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
    const rows = current();
    // Room needs a query, which is a real await. A browser's localStorage write is
    // synchronous, so the web path performs the merge and the write in one turn —
    // exactly the behaviour this archive had before the port existed.
    const pool = native ? await candidates(entry, now, key) : rows;
    const merged: HistoryEntry[] = [];
    const rest: HistoryEntry[] = [...rows];
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
    cache = [row, ...rest].slice(0, HISTORY_LIMIT);
    total = Math.max(total + (existed ? 0 : 1) - removed.length, cache.length);
    emit();
    if (!native) {
      const written = writeHistorySync(cache);
      cache = written.rows;
      lastWriteOk = written.ok;
      lastEvicted = webPort.lastEvicted();
    } else {
      try {
        await port.historyUpsert([row]);
        if (removed.length) await port.historyDelete(removed);
        await port.historyTrim(HISTORY_LIMIT);
        lastWriteOk = true;
        // The optimistic emit may have raced the Room transaction. Publish one durable
        // revision once it commits so a mounted full-archive statistics view refetches.
        emit();
      } catch {
        // Keep the in-memory row: the person sees their translation, and the next save
        // retries. A silent "saved" would be the actual failure.
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
      lastWriteOk = written.ok;
    } else if (row) {
      try {
        await port.historyUpsert([row]);
        lastWriteOk = true;
        emit();
      } catch {
        lastWriteOk = false;
      }
    }
    return next;
  },
  async remove(id: string): Promise<HistoryEntry[]> {
    const next = current().filter((e) => e.id !== id);
    cache = next;
    total = Math.max(0, total - 1);
    emit();
    if (!native) {
      const written = writeHistorySync(next);
      cache = written.rows;
      lastWriteOk = written.ok;
    } else {
      try {
        await port.historyDelete([id]);
        lastWriteOk = true;
        emit();
      } catch {
        lastWriteOk = false;
      }
    }
    return next;
  },
  async clear(): Promise<HistoryEntry[]> {
    cache = [];
    total = 0;
    emit();
    if (!native) {
      lastWriteOk = writeHistorySync([]).ok;
    } else {
      try {
        await port.historyClear();
        lastWriteOk = true;
        emit();
      } catch {
        lastWriteOk = false;
      }
    }
    return cache;
  },
};
