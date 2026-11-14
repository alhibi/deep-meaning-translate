import { useSyncExternalStore } from "react";

/** Personal phrasebook: device-only, never sent anywhere. */
export interface SavedPhrase {
  id: string;
  source: string;
  target: string;
  original: string;
  translated: string;
  createdAt: number;
  /** Times reviewed and remembered — weaker phrases come up first. */
  known: number;
  reviewedAt: number;
}

const KEY = "lingua.saved.v1";
const LIMIT = 300;
const EMPTY: SavedPhrase[] = [];

let cache: SavedPhrase[] | null = null;

/** Damaged or foreign rows in storage are dropped, never allowed to crash the app. */
export function isPhrase(v: unknown): v is SavedPhrase {
  const p = v as SavedPhrase;
  return (
    !!p &&
    typeof p === "object" &&
    typeof p.id === "string" &&
    typeof p.original === "string" &&
    typeof p.translated === "string" &&
    typeof p.target === "string" &&
    typeof p.source === "string" &&
    Number.isFinite(p.createdAt) &&
    Number.isFinite(p.known) &&
    Number.isFinite(p.reviewedAt)
  );
}
const listeners = new Set<() => void>();

function read(): SavedPhrase[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache) return cache;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? (parsed as unknown[]).filter(isPhrase) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: SavedPhrase[]) {
  cache = next.slice(0, LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn());
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/** UTC day index of a `YYYY-MM-DD` key, so the same key picks the same phrase anywhere. */
function dayIndex(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return 0;
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

export const saved = {
  list: read,
  find(original: string, target: string) {
    const o = norm(original);
    return read().find((p) => p.target === target && norm(p.original) === o);
  },
  toggle(entry: Pick<SavedPhrase, "source" | "target" | "original" | "translated">) {
    const hit = saved.find(entry.original, entry.target);
    if (hit) {
      write(read().filter((p) => p.id !== hit.id));
      return false;
    }
    const now = Date.now();
    write([
      {
        ...entry,
        original: norm(entry.original),
        id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: now,
        known: 0,
        reviewedAt: 0,
      },
      ...read(),
    ]);
    return true;
  },
  remove(id: string) {
    write(read().filter((p) => p.id !== id));
  },
  /** Edit the saved translation. Empty or unchanged text is refused. */
  update(id: string, translated: string): boolean {
    const next = translated.trim();
    const hit = read().find((p) => p.id === id);
    if (!hit || !next || next === hit.translated || next.length > 5000) return false;
    write(read().map((p) => (p.id === id ? { ...p, translated: next } : p)));
    return true;
  },
  mark(id: string, remembered: boolean) {
    write(
      read().map((p) =>
        p.id === id ? { ...p, known: remembered ? p.known + 1 : 0, reviewedAt: Date.now() } : p,
      ),
    );
  },
  /** Review order: least known first, then longest since last seen. */
  reviewQueue() {
    return [...read()].sort((a, b) => a.known - b.known || a.reviewedAt - b.reviewedAt);
  },
  /** One phrase per calendar day key (`YYYY-MM-DD`), stable for the whole day. */
  ofTheDay(dayKey: string): SavedPhrase | null {
    const list = read();
    if (list.length === 0) return null;
    return list[((dayIndex(dayKey) % list.length) + list.length) % list.length] ?? null;
  },
  clear() {
    write([]);
  },
};

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      cache = null;
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSaved(): SavedPhrase[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
