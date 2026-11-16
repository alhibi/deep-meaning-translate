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

function writeMemory(rows: MemoryRow[]) {
  let out = rows.slice(0, MEMORY_MAX_ENTRIES);
  let json = JSON.stringify(out);
  const size = (v: string) => new TextEncoder().encode(v).length;
  while (size(json) > MEMORY_MAX_BYTES && out.length > 1) {
    out = out.slice(0, -1);
    json = JSON.stringify(out);
  }
  try {
    window.localStorage.setItem(MEMORY, json);
  } catch {
    /* quota or private mode: the memory stays in RAM for this session */
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
      session: parseSession(parse(get(SESSION))),
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
    if (!session) return removeDeviceValue(SESSION);
    return writeDeviceValue(SESSION, JSON.stringify(session));
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
    writeHistorySync(readHistory().slice(0, limit));
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
    } catch {
      /* quota or blocked: the phrasebook stays in memory for this session */
    }
  },

  async memoryWrite(rows) {
    writeMemory(rows.filter(isMemoryRow));
  },

  async snapshot(): Promise<Dataset> {
    return {
      settings: deviceSettingValues(),
      prefs: parsePrefs(parse(get(PREFS))),
      session: parseSession(parse(get(SESSION))),
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
    // All-or-nothing: a failed write restores the snapshot taken before it.
    try {
      writeHistorySync(data.history);
      await this.savedWrite(data.saved);
      writeMemory(data.memory);
      await this.savePrefs(data.prefs);
      await this.saveSession(data.session);
      for (const [key, value] of Object.entries(data.settings)) {
        if (typeof value === "string") await writeDeviceValue(key, value);
      }
      if (mode === "replace") {
        for (const key of BACKUP_SETTING_KEYS) {
          if (data.settings[key] === undefined) await removeDeviceValue(key);
        }
      }
    } catch {
      writeHistorySync(previous.history);
      await this.savedWrite(previous.saved);
      writeMemory(previous.memory);
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
