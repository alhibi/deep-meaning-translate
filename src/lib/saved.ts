import { useSyncExternalStore } from "react";
import { isNativeApp } from "./native/config";
import { port } from "./persistence";
import {
  SAVED_LIMIT,
  isPhrase,
  normalizeText as norm,
  type SavedPhrase,
} from "./persistence/contracts";
import { readSaved } from "./persistence/web";

export { isPhrase } from "./persistence/contracts";
export type { SavedPhrase } from "./persistence/contracts";

/** Personal phrasebook: device-only, never sent anywhere. */
const EMPTY: SavedPhrase[] = [];
const native = isNativeApp();

let cache: SavedPhrase[] | null = null;
const listeners = new Set<() => void>();

function read(): SavedPhrase[] {
  if (cache) return cache;
  cache = native ? [] : readSaved();
  return cache;
}

/** Called once by the platform boot with the validated native snapshot. */
export function hydrateSaved(rows: SavedPhrase[]) {
  cache = rows.filter(isPhrase).slice(0, SAVED_LIMIT);
  listeners.forEach((fn) => fn());
}

/** Drop the in-memory phrase list; the next read re-reads storage (post-import reload). */
export function resetSavedCache() {
  cache = null;
  listeners.forEach((fn) => fn());
}

async function write(next: SavedPhrase[]): Promise<boolean> {
  cache = next.slice(0, SAVED_LIMIT);
  listeners.forEach((fn) => fn());
  try {
    return await port.savedWrite(cache);
  } catch {
    return false;
  }
}

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
  async toggle(entry: Pick<SavedPhrase, "source" | "target" | "original" | "translated">) {
    const hit = saved.find(entry.original, entry.target);
    if (hit) {
      await write(read().filter((p) => p.id !== hit.id));
      return false;
    }
    const now = Date.now();
    await write([
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
  async remove(id: string) {
    await write(read().filter((p) => p.id !== id));
  },
  /** Edit the saved translation. Empty or unchanged text is refused. */
  async update(id: string, translated: string): Promise<boolean> {
    const next = translated.trim();
    const hit = read().find((p) => p.id === id);
    if (!hit || !next || next === hit.translated || next.length > 5000) return false;
    await write(read().map((p) => (p.id === id ? { ...p, translated: next } : p)));
    return true;
  },
  async mark(id: string, remembered: boolean) {
    await write(
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
  async clear() {
    await write([]);
  },
};

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (native) return;
    if (e.key === "lingua.saved.v1" || e.key === null) {
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
