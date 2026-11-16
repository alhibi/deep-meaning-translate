/**
 * Web adapter: the storage the browser app has always used.
 *
 * Keys and shapes are unchanged, so an existing visit keeps its archive, phrasebook and
 * preferences. This module is the only place that knows the raw key names for the record
 * stores; settings live in `settings.ts`.
 */
import {
  BACKUP_SETTING_KEYS,
  HISTORY_LIMIT,
  MEMORY_MAX_BYTES,
  MEMORY_MAX_ENTRIES,
  MEMORY_TTL_MS,
  SAVED_LIMIT,
  isEntry,
  isMemoryRow,
  isPhrase,
  parsePrefs,
  parseSession,
  sanitizeEntry,
  type BackupData,
  type Dataset,
  type HistoryEntry,
  type ImportReport,
  type MemoryRow,
  type Prefs,
  type SavedPhrase,
  type Session,
} from "./contracts";
import { mergeData, replaceData } from "./backup";
import type { Hydrated, PersistencePort } from "./port";
import {
  deviceSettingValues,
  removeDeviceValue,
  seedOneSetting,
  writeDeviceValue,
} from "./settings";

const PREFS = "lingua.prefs.v1";
const SESSION = "lingua.session.v1";
const HISTORY = "lingua.history.v1";
const SAVED = "lingua.saved.v1";
const MEMORY = "lingua.memory.v1";
const SOFT_LIMIT = 2_400_000;

function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse<T>(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ session recency (TD14) */

/**
 * The session record is the validated `Session` plus two extra fields: `at` (the epoch-ms
 * this tab wrote it) and `origin` (an id for that tab). The shape is flat on purpose: a
 * record written before recency metadata existed is the same object without those two
 * fields, so a legacy bare session still parses, and an older build reads a new record
 * through `parseSession` and ignores the extras (the rollback path).
 *
 * Why the metadata exists: a second, empty tab used to remove `lingua.session.v1` when it
 * was closed, erasing another tab's newer draft. `persist.ts` refuses a write whose
 * recency is older than the record it would overwrite; the empty draft is written as an
 * empty record instead of a deletion, so `parseSession` still resolves it to "no draft".
 */
export interface SessionMeta {
  at: number;
  origin: string;
}

export type SessionRecord = Session & SessionMeta;

/** The stored draft, from either a legacy bare Session or a metadata record. */
export function readSessionRecord(): Session | null {
  if (typeof window === "undefined") return null;
  return parseSession(parse(get(SESSION)));
}

/** Recency metadata of the stored record; null when absent, legacy or damaged. */
export function readSessionMeta(): SessionMeta | null {
  if (typeof window === "undefined") return null;
  const raw = parse(get(SESSION));
  if (!raw || typeof raw !== "object") return null;
  const record = raw as { at?: unknown; origin?: unknown };
  if (typeof record.at !== "number" || !Number.isFinite(record.at) || record.at < 0) return null;
  return { at: record.at, origin: typeof record.origin === "string" ? record.origin : "unknown" };
}

/**
 * A write time newer than the stored record. Wall clock plus the +1 guard keeps saves in
 * the same millisecond (and after a legacy clock was rolled back) monotonic; `seenAt` is
 * the newest recency this tab knows about, so this tab's next write always wins over it.
 */
export function nextSessionTimestamp(seenAt = 0): number {
  const stored = readSessionMeta()?.at ?? 0;
  return Math.max(Date.now(), stored + 1, seenAt + 1);
}

let tabOriginId: string | null = null;

/** Stable id for this tab, stamped into every session write it makes. */
export function tabOrigin(): string {
  if (tabOriginId) return tabOriginId;
  tabOriginId = newOriginId();
  return tabOriginId;
}

function newOriginId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
      return crypto.randomUUID();
  } catch {
    /* a browser without randomUUID still needs a tab id */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Persist a session with its recency metadata. `null` is an empty draft, never a key
 * removal: deleting here is what let a closing empty tab erase another tab's draft.
 */
export function writeSessionState(session: Session | null, meta: SessionMeta): boolean {
  if (typeof window === "undefined") return false;
  const record: SessionRecord | { text: ""; at: number; origin: string } = session
    ? { ...session, at: meta.at, origin: meta.origin }
    : { text: "", at: meta.at, origin: meta.origin };
  try {
    window.localStorage.setItem(SESSION, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function readHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  const parsed = parse(get(HISTORY));
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (const row of parsed as unknown[]) {
    if (!isEntry(row) || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(sanitizeEntry(row));
  }
  return out;
}

export function readSaved(): SavedPhrase[] {
  if (typeof window === "undefined") return [];
  const parsed = parse(get(SAVED));
  return Array.isArray(parsed) ? (parsed as unknown[]).filter(isPhrase).slice(0, SAVED_LIMIT) : [];
}

export function readMemory(): MemoryRow[] {
  if (typeof window === "undefined") return [];
  const parsed = parse(get(MEMORY));
  if (!Array.isArray(parsed)) return [];
  const now = Date.now();
  const seen = new Set<string>();
  const out: MemoryRow[] = [];
  for (const row of parsed as unknown[]) {
    if (!isMemoryRow(row) || seen.has(row.k) || now - row.at > MEMORY_TTL_MS) continue;
    seen.add(row.k);
    out.push(row);
    if (out.length >= MEMORY_MAX_ENTRIES) break;
  }
  return out;
}

export function writeHistorySync(rows: HistoryEntry[]): { ok: boolean; rows: HistoryEntry[] } {
  let next = rows.slice(0, HISTORY_LIMIT);
  let json = JSON.stringify(next);
  let evicted = 0;
  // Bound the synchronous write first: at the quota every save is both slow and doomed.
  while (json.length > SOFT_LIMIT && next.length > 1) {
    const before = next.length;
    next = next.slice(0, Math.max(1, next.length - Math.ceil(next.length * 0.1)));
    evicted += before - next.length;
    json = JSON.stringify(next);
  }
  for (let attempt = 0; attempt < 64; attempt++) {
    try {
      window.localStorage.setItem(HISTORY, json);
      lastEvicted = evicted;
      return { ok: true, rows: next };
    } catch {
      if (next.length <= 1) break;
      const before = next.length;
      next = next.slice(0, Math.max(1, next.length - Math.ceil(next.length * 0.1)));
      evicted += before - next.length;
      json = JSON.stringify(next);
    }
  }
  lastEvicted = evicted;
  return { ok: false, rows: next };
}

let lastEvicted = 0;

function writeMemory(rows: MemoryRow[]): boolean {
  let out = rows.slice(0, MEMORY_MAX_ENTRIES);
  let json = JSON.stringify(out);
  const size = (v: string) => new TextEncoder().encode(v).length;
  while (size(json) > MEMORY_MAX_BYTES && out.length > 1) {
    out = out.slice(0, -1);
    json = JSON.stringify(out);
  }
  try {
    window.localStorage.setItem(MEMORY, json);
    return true;
  } catch {
    return false;
  }
}

export const webPort: PersistencePort & { hydrateSync(): Hydrated; lastEvicted(): number } = {
  kind: "web",

  hydrateSync(): Hydrated {
    if (typeof window === "undefined")
      return {
        settings: {},
        prefs: null,
        session: null,
        history: [],
        historyTotal: 0,
        saved: [],
        memory: [],
      };
    const history = readHistory();
    return {
      settings: deviceSettingValues(),
      prefs: parsePrefs(parse(get(PREFS))),
      session: readSessionRecord(),
      history,
      historyTotal: history.length,
      saved: readSaved(),
      memory: readMemory(),
    };
  },

  async hydrate(): Promise<Hydrated> {
    return this.hydrateSync();
  },

  async savePrefs(prefs: Prefs | null) {
    if (!prefs) return removeDeviceValue(PREFS);
    return writeDeviceValue(PREFS, JSON.stringify(prefs));
  },

  async saveSession(session: Session | null) {
    // One code path for both shapes: `null` becomes an empty record, never a key removal.
    return writeSessionState(parseSession(session), {
      at: nextSessionTimestamp(),
      origin: tabOrigin(),
    });
  },

  async historyPage(limit, offset) {
    const rows = readHistory();
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },

  async historyCandidates(q) {
    return readHistory().filter(
      (e) =>
        e.target === q.target &&
        (e.original.trim().replace(/\s+/g, " ") === q.normalized ||
          ((e.updatedAt ?? e.createdAt) >= q.recentSince &&
            (q.normalized.startsWith(e.original.trim().replace(/\s+/g, " ")) ||
              e.original.trim().replace(/\s+/g, " ").startsWith(q.normalized)))),
    );
  },

  async historyUpsert(rows) {
    const byId = new Map(readHistory().map((e) => [e.id, e]));
    for (const row of rows) if (isEntry(row)) byId.set(row.id, sanitizeEntry(row));
    const next = [...byId.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, HISTORY_LIMIT);
    if (!writeHistorySync(next).ok) throw new Error("history-write-failed");
    return next.length;
  },

  async historyDelete(ids) {
    const drop = new Set(ids);
    if (!writeHistorySync(readHistory().filter((e) => !drop.has(e.id))).ok)
      throw new Error("history-write-failed");
  },

  async historyTrim(limit) {
    if (!writeHistorySync(readHistory().slice(0, limit)).ok)
      throw new Error("history-write-failed");
  },

  async historyAll() {
    return readHistory();
  },

  async historyClear() {
    try {
      window.localStorage.removeItem(HISTORY);
    } catch {
      /* nothing stored */
    }
  },

  async memoryClear() {
    try {
      window.localStorage.removeItem(MEMORY);
    } catch {
      /* nothing stored */
    }
  },

  async savedWrite(rows) {
    try {
      window.localStorage.setItem(
        SAVED,
        JSON.stringify(rows.filter(isPhrase).slice(0, SAVED_LIMIT)),
      );
      return true;
    } catch {
      return false;
    }
  },

  async memoryWrite(rows) {
    return writeMemory(rows.filter(isMemoryRow));
  },

  async snapshot(): Promise<Dataset> {
    return {
      settings: deviceSettingValues(),
      prefs: parsePrefs(parse(get(PREFS))),
      // Backups carry the validated draft, not the tab that wrote it or when.
      session: readSessionRecord(),
      history: readHistory(),
      saved: readSaved(),
      memory: readMemory(),
    };
  },

  // The web backend has no import log table; the provenance argument is accepted so the
  // port has one call shape, and deliberately ignored here.
  async replaceAll(input: BackupData, mode, _meta?): Promise<ImportReport> {
    const previous = await this.snapshot();
    const { data, report } =
      mode === "merge" ? mergeData(previous, input) : replaceData(input, previous);
    const requireWrite = (ok: boolean) => {
      if (!ok) throw new Error("storage-write-failed");
    };
    const restore = async (snapshot: Dataset) => {
      // Best effort cannot create atomic localStorage, but every known store is restored
      // before the import rejects. Never report an import as successful after any refusal.
      requireWrite(writeHistorySync(snapshot.history).ok);
      requireWrite(await this.savedWrite(snapshot.saved));
      requireWrite(await this.memoryWrite(snapshot.memory));
      requireWrite(await this.savePrefs(snapshot.prefs));
      requireWrite(await this.saveSession(snapshot.session));
      for (const key of BACKUP_SETTING_KEYS) {
        const value = snapshot.settings[key];
        requireWrite(
          value === undefined ? await removeDeviceValue(key) : await writeDeviceValue(key, value),
        );
      }
    };
    // All-or-nothing from the caller's perspective: a failed write restores every
    // record family plus prefs/session/settings before the operation rejects.
    try {
      requireWrite(writeHistorySync(data.history).ok);
      requireWrite(await this.savedWrite(data.saved));
      requireWrite(await this.memoryWrite(data.memory));
      requireWrite(await this.savePrefs(data.prefs));
      requireWrite(await this.saveSession(data.session));
      for (const [key, value] of Object.entries(data.settings)) {
        if (typeof value === "string") requireWrite(await writeDeviceValue(key, value));
      }
      if (mode === "replace") {
        for (const key of BACKUP_SETTING_KEYS) {
          if (data.settings[key] === undefined) requireWrite(await removeDeviceValue(key));
        }
      }
    } catch {
      try {
        await restore(previous);
      } catch {
        // The original failure remains the public result; storage can be reported as
        // unavailable rather than pretending the backup was imported.
      }
      throw new Error("import-failed");
    }
    return report;
  },

  async clearAll() {
    try {
      for (const key of [PREFS, SESSION, HISTORY, SAVED, MEMORY])
        window.localStorage.removeItem(key);
    } catch {
      /* storage blocked */
    }
  },

  lastEvicted: () => lastEvicted,
};
