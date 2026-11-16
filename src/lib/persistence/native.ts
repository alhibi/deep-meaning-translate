/**
 * Android adapter: Room for records, Preferences DataStore for settings.
 *
 * The app never reads localStorage here. The Kotlin plugin returns a validated snapshot
 * at boot; every write is queued, ordered, and executed off the main thread in Kotlin.
 * `historyCandidates` is the one query that keeps the archive's merge rules in
 * TypeScript while Room still does the searching.
 */
import {
  HISTORY_LIMIT,
  MEMORY_MAX_ENTRIES,
  isEntry,
  isMemoryRow,
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
import type { Hydrated, PersistencePort } from "./port";
import { storePlugin } from "../native/plugin";
import { seedSettings } from "./settings";

let seq = 0;
/**
 * Session stamps are wall-clock based. Seed them from the stored row so a device clock that
 * was rolled back (or an import that stamped a future seq) cannot make every later draft
 * save look stale and be silently rejected (A3-06).
 */
const nextSeq = () => {
  seq = Math.max(seq + 1, Date.now());
  return seq;
};

/**
 * True only after a complete boot snapshot was read AND applied. Until then every read and
 * write fails closed: a timed-out bridge must never look like "storage is empty" and let a
 * whole-table write erase the phrasebook or memory (A3-02).
 */
let hydrated = false;

/**
 * Explicitly allow native reads/writes. Called by the boot path only **after** the
 * snapshot has been applied to the module caches. A late-arriving hydrate that lost the
 * boot race must not open writes on its own: its values were never applied, so the first
 * whole-table save would run from an empty cache (the A3-02 failure mode).
 */
export function markNativeHydrated() {
  hydrated = true;
}

/** Test seam: boot tests must be able to return to the closed state. */
export function resetNativeHydrationForTests() {
  hydrated = false;
}

async function rawStore() {
  const plugin = await storePlugin();
  if (!plugin) throw new Error("bridge-unavailable");
  return plugin;
}

async function store() {
  if (!hydrated) throw new Error("storage-unavailable");
  return rawStore();
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const nativePort: PersistencePort = {
  kind: "native",

  async hydrate(): Promise<Hydrated> {
    const boot = await (await rawStore()).boot();
    const settings = parseJson<Record<string, string>>(boot.settings, {});
    seedSettings(settings);
    // A stored session always has a lower seq than the next write; adopting it makes the
    // guard survive restarts instead of depending on the device clock only.
    if (Number.isFinite(boot.sessionSeq)) seq = Math.max(seq, boot.sessionSeq);
    const history = parseJson<unknown[]>(boot.history, []).filter(isEntry).map(sanitizeEntry);
    const snapshot: Hydrated = {
      settings,
      prefs: parsePrefs(parseJson<unknown>(boot.prefs, null)),
      session: parseSession(parseJson<unknown>(boot.session, null)),
      history,
      historyTotal: Number.isFinite(boot.historyTotal) ? boot.historyTotal : history.length,
      saved: parseJson<SavedPhrase[]>(boot.saved, []),
      memory: parseJson<MemoryRow[]>(boot.memory, [])
        .filter(isMemoryRow)
        .slice(0, MEMORY_MAX_ENTRIES),
    };
    return snapshot;
  },

  async savePrefs(prefs: Prefs | null) {
    const res = await (
      await store()
    )
      .prefsWrite({ json: prefs ? JSON.stringify(prefs) : null })
      .catch(() => ({ ok: false }));
    return res.ok;
  },

  async saveSession(session: Session | null) {
    const res = await (
      await store()
    )
      .sessionWrite({ json: session ? JSON.stringify(session) : null, seq: nextSeq() })
      .catch(() => ({ ok: false }));
    return res.ok;
  },

  async historyPage(limit, offset) {
    const page = await (await store()).historyPage({ limit, offset });
    return {
      rows: parseJson<unknown[]>(page.rows, []).filter(isEntry).map(sanitizeEntry),
      total: page.total,
    };
  },

  async historyCandidates(q) {
    const res = await (await store()).historyCandidates(q);
    return parseJson<unknown[]>(res.rows, []).filter(isEntry).map(sanitizeEntry);
  },

  async historyUpsert(rows) {
    const valid = rows.filter(isEntry).map(sanitizeEntry);
    if (!valid.length) return 0;
    const res = await (await store()).historyUpsert({ rows: JSON.stringify(valid) });
    return res.total;
  },

  async historyDelete(ids) {
    if (!ids.length) return;
    await (await store()).historyDelete({ ids: JSON.stringify(ids) });
  },

  async historyTrim(limit) {
    await (await store()).historyTrim({ limit: Math.min(limit, HISTORY_LIMIT) });
  },

  async historyAll() {
    const res = await (await store()).historyAll();
    return parseJson<unknown[]>(res.rows, []).filter(isEntry).map(sanitizeEntry);
  },

  async historyClear() {
    await (await store()).historyClear();
  },

  async savedWrite(rows) {
    await (await store()).savedWrite({ rows: JSON.stringify(rows) });
  },

  async memoryWrite(rows) {
    await (await store()).memoryWrite({ rows: JSON.stringify(rows) });
  },

  async memoryClear() {
    await (await store()).memoryWrite({ rows: "[]" });
  },

  async snapshot(): Promise<Dataset> {
    const plugin = await store();
    // One round trip for settings plus one per record family; the screen never waits
    // for this — it runs when the person opens Data settings.
    const [settings, history, page] = await Promise.all([
      plugin.settingsAll(),
      plugin.historyAll(),
      plugin.historyPage({ limit: 1, offset: 0 }),
    ]);
    const boot = await plugin.boot();
    return {
      settings: parseJson<Record<string, string>>(settings.values, {}),
      prefs: parsePrefs(parseJson<unknown>(boot.prefs, null)),
      session: parseSession(parseJson<unknown>(boot.session, null)),
      history: parseJson<unknown[]>(history.rows, []).filter(isEntry).map(sanitizeEntry),
      saved: parseJson<SavedPhrase[]>(boot.saved, []),
      memory: parseJson<MemoryRow[]>(boot.memory, []).filter(isMemoryRow),
      historyTotal: page.total,
    };
  },

  async replaceAll(input: BackupData, mode, meta): Promise<ImportReport> {
    // Merge/replace is decided in `backup.ts` from a full snapshot so the archive rules
    // live in one language; Kotlin then applies the result atomically.
    const { mergeData, replaceData } = await import("./backup");
    const previous = await this.snapshot();
    const { data, report } =
      mode === "merge" ? mergeData(previous, input) : replaceData(input, previous);
    await (
      await store()
    ).replaceAll({
      json: JSON.stringify(data),
      mode,
      ...(meta?.fileName ? { fileName: meta.fileName } : {}),
      ...(meta?.digest ? { digest: meta.digest } : {}),
      report: JSON.stringify(report),
    });
    // The TS report is the one the person saw in the preview: it knows added vs skipped.
    // Kotlin's applied counts only describe the final table sizes (A2-05/A3-07).
    return report;
  },

  async clearAll() {
    await (await store()).clearAll();
  },
};
