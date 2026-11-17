import { useSyncExternalStore } from "react";
import { isNativeApp } from "./native/config";
import { port } from "./persistence";
import {
  SAVED_LIMIT,
  isPhrase,
  normalizeText as norm,
  type SavedPhrase,
} from "./persistence/contracts";
import { readSavedRaw, readSavedSnapshot, writeSavedSync } from "./persistence/web";

export { isPhrase } from "./persistence/contracts";
export type { SavedPhrase } from "./persistence/contracts";

/** Personal phrasebook: device-only, never sent anywhere. */
const EMPTY: SavedPhrase[] = [];
const native = isNativeApp();

let cache: SavedPhrase[] | null = null;
/**
 * The exact `lingua.saved.v1` document the cache mirrors. The phrasebook is one JSON
 * array, so every change rewrites it; checking this token before writing stops a stale
 * snapshot from erasing a phrase another tab saved while this one was open.
 */
let cacheToken: string | null = null;
const listeners = new Set<() => void>();

function read(): SavedPhrase[] {
  if (cache) return cache;
  if (native) {
    cache = [];
    return cache;
  }
  const snapshot = readSavedSnapshot();
  cache = snapshot.rows;
  cacheToken = snapshot.raw;
  return cache;
}

/**
 * The list to mutate: re-reads when another tab changed the stored document since this
 * tab's snapshot. Reads used by render (`find`, `list`, `ofTheDay`) stay on the cache;
 * a real change arrives through the storage subscription that re-renders the view.
 */
function fresh(): SavedPhrase[] {
  if (cache === null) return read();
  if (native || typeof window === "undefined") return cache;
  if (readSavedRaw() === cacheToken) return cache;
  const snapshot = readSavedSnapshot();
  cache = snapshot.rows;
  cacheToken = snapshot.raw;
  return cache;
}

/**
 * Normalised lookup per phrase list: "is this draft saved?" runs on every translator
 * render, so normalising all 300 phrases there would repeat per keystroke. A new list
 * (every write, every cross-tab reload) gets a new index; the WeakMap keeps no list alive.
 */
const indexes = new WeakMap<SavedPhrase[], Map<string, Map<string, SavedPhrase>>>();

function lookup(list: SavedPhrase[], original: string, target: string): SavedPhrase | undefined {
  let byTarget = indexes.get(list);
  if (!byTarget) {
    byTarget = new Map();
    for (const phrase of list) {
      let byText = byTarget.get(phrase.target);
      if (!byText) {
        byText = new Map();
        byTarget.set(phrase.target, byText);
      }
      const normalized = norm(phrase.original);
      // Storage order decides on a duplicate pair: the first one is the visible match.
      if (!byText.has(normalized)) byText.set(normalized, phrase);
    }
    indexes.set(list, byTarget);
  }
  return byTarget.get(target)?.get(norm(original));
}

/** Called once by the platform boot with the validated native snapshot. */
export function hydrateSaved(rows: SavedPhrase[]) {
  cache = rows.filter(isPhrase).slice(0, SAVED_LIMIT);
  cacheToken = null;
  listeners.forEach((fn) => fn());
}

/** Drop the in-memory phrase list; the next read re-reads storage (post-import reload). */
export function resetSavedCache() {
  cache = null;
  cacheToken = null;
  listeners.forEach((fn) => fn());
}

async function write(next: SavedPhrase[]): Promise<boolean> {
  cache = next.slice(0, SAVED_LIMIT);
  listeners.forEach((fn) => fn());
  if (!native) {
    const written = writeSavedSync(cache);
    cache = written.rows;
    // A refused write leaves the old document in place; keeping the old token means the
    // optimistic list is not dropped by the next read, while a real other-tab write is.
    if (written.ok) cacheToken = written.raw;
    return written.ok;
  }
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
    return lookup(read(), original, target);
  },
  async toggle(entry: Pick<SavedPhrase, "source" | "target" | "original" | "translated">) {
    const list = fresh();
    const hit = lookup(list, entry.original, entry.target);
    if (hit) {
      await write(list.filter((p) => p.id !== hit.id));
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
      ...list,
    ]);
    return true;
  },
  async remove(id: string) {
    await write(fresh().filter((p) => p.id !== id));
  },
  /** Edit the saved translation. Empty or unchanged text is refused. */
  async update(id: string, translated: string): Promise<boolean> {
    const next = translated.trim();
    const list = fresh();
    const hit = list.find((p) => p.id === id);
    if (!hit || !next || next === hit.translated || next.length > 5000) return false;
    await write(list.map((p) => (p.id === id ? { ...p, translated: next } : p)));
    return true;
  },
  async mark(id: string, remembered: boolean) {
    await write(
      fresh().map((p) =>
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
      cacheToken = null;
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
