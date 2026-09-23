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
    const existing = read().filter(
      (e) => !(e.original === entry.original && e.target === entry.target),
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
