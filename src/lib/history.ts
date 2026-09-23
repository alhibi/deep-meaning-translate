export interface HistoryEntry {
  id: string;
  source: string;
  target: string;
  original: string;
  translated: string;
  createdAt: number;
}

const KEY = "lingua.history.v1";
const LIMIT = 40;

function read(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: HistoryEntry[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, LIMIT)));
  } catch {
    /* storage full or unavailable — history is non-essential */
  }
}

export const history = {
  list: read,
  add(entry: Omit<HistoryEntry, "id" | "createdAt">): HistoryEntry[] {
    const now = Date.now();
    // One entry per thought: a sentence that grew while typing replaces its earlier versions.
    const existing = read().filter(
      (e) =>
        !(
          e.target === entry.target &&
          (e.original === entry.original ||
            (now - e.createdAt < 3 * 60_000 &&
              (entry.original.startsWith(e.original) || e.original.startsWith(entry.original))))
        ),
    );
    const next = [
      { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now() },
      ...existing,
    ].slice(0, LIMIT);
    write(next);
    return next;
  },
  clear(): HistoryEntry[] {
    write([]);
    return [];
  },
};
