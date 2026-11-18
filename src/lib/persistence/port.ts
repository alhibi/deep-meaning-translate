import type {
  BackupData,
  Dataset,
  HistoryEntry,
  ImportReport,
  MemoryRow,
  Prefs,
  SavedPhrase,
  Session,
} from "./contracts";

export interface Hydrated {
  settings: Record<string, string>;
  prefs: Prefs | null;
  session: Session | null;
  history: HistoryEntry[];
  historyTotal: number;
  saved: SavedPhrase[];
  memory: MemoryRow[];
}

export interface HistoryCandidates {
  target: string;
  normalized: string;
  recentSince: number;
}

/**
 * The persistence contract. Two implementations, one set of semantics:
 * `web.ts` keeps the existing localStorage keys, `native.ts` drives Room + DataStore.
 *
 * Rules that hold for both:
 * - every read is validated against `contracts.ts`;
 * - writes are asynchronous and report failure instead of swallowing it;
 * - the archive is never rewritten wholesale for a single sentence unless the backend
 *   has no finer operation (the web's JSON document does; Room does not);
 * - import replaces or merges in one transaction, never row by row.
 */
export interface PersistencePort {
  readonly kind: "web" | "native";

  /** The snapshot the UI boots from. Native is async; web also offers a sync variant. */
  hydrate(): Promise<Hydrated>;

  savePrefs(prefs: Prefs | null): Promise<boolean>;
  saveSession(session: Session | null): Promise<boolean>;

  historyPage(limit: number, offset: number): Promise<{ rows: HistoryEntry[]; total: number }>;
  historyCandidates(q: HistoryCandidates): Promise<HistoryEntry[]>;
  historyUpsert(rows: HistoryEntry[]): Promise<number>;
  historyDelete(ids: string[]): Promise<void>;
  historyAll(): Promise<HistoryEntry[]>;
  historyClear(): Promise<void>;

  /** False means the in-memory update was not made durable (quota/private mode/bridge). */
  savedWrite(rows: SavedPhrase[]): Promise<boolean>;
  /** False means the in-memory update was not made durable (quota/private mode/bridge). */
  memoryWrite(rows: MemoryRow[]): Promise<boolean>;
  /** Forget the memory entirely; the web removes the key, Room deletes the rows. */
  memoryClear(): Promise<void>;

  /** Everything a backup contains, already validated. */
  snapshot(): Promise<Dataset>;
  /**
   * One transaction: merged or replaced, or the previous data untouched. The optional
   * provenance is recorded by backends that keep an import log (Room's import_meta).
   */
  replaceAll(
    data: BackupData,
    mode: "merge" | "replace",
    meta?: { fileName?: string; digest?: string },
  ): Promise<ImportReport>;

  clearAll(): Promise<void>;
}
