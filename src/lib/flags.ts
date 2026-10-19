import { useSyncExternalStore } from "react";

/** Translations the user marked "inaccurate" — device-only, never sent anywhere. */
export interface Flag {
  id: string;
  source: string;
  target: string;
  original: string;
  translated: string;
  /** Words of the translation the user marked as wrong (may be empty). */
  words: string[];
  brain: string;
  createdAt: number;
}

const KEY = "lingua.flags.v1";
const LIMIT = 200;
const EMPTY: Flag[] = [];
let cache: Flag[] | null = null;
const listeners = new Set<() => void>();

export function isFlag(v: unknown): v is Flag {
  const f = v as Flag;
  return (
    !!f &&
    typeof f === "object" &&
    typeof f.id === "string" &&
    typeof f.source === "string" &&
    typeof f.target === "string" &&
    typeof f.original === "string" &&
    typeof f.translated === "string" &&
    typeof f.brain === "string" &&
    Array.isArray(f.words) &&
    f.words.every((w) => typeof w === "string") &&
    Number.isFinite(f.createdAt)
  );
}

function read(): Flag[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache) return cache;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? (parsed as unknown[]).filter(isFlag) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: Flag[]) {
  cache = next.slice(0, LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn());
}

/** Split a translation into tappable words, dropping punctuation. */
export function wordsOf(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ""))
    .filter(Boolean);
}

export const flags = {
  list: read,
  add(entry: Omit<Flag, "id" | "createdAt">) {
    if (!entry.original.trim() || !entry.translated.trim()) return;
    const rest = read().filter(
      (f) => !(f.target === entry.target && f.original.trim() === entry.original.trim()),
    );
    write([
      {
        ...entry,
        original: entry.original.trim(),
        words: [...new Set(entry.words)],
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        createdAt: Date.now(),
      },
      ...rest,
    ]);
  },
  remove(id: string) {
    write(read().filter((f) => f.id !== id));
  },
  clear() {
    write([]);
  },
};

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
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

export const useFlags = () => useSyncExternalStore(subscribe, read, () => EMPTY);
