/**
 * Recently seen culture articles -- device-only, bounded novelty history.
 *
 * Random discovery must not immediately show the same article twice, and the feed benefits
 * from knowing what a person has already opened. This store keeps the newest
 * CULTURE_SEEN_LIMIT ids in one versioned envelope through the app's device-storage facade,
 * never identifies anyone and is fully clearable. It is a novelty window, not an analytics
 * log: only ids, most recent first, and no timestamps or counts leave the record.
 *
 *   { "version": 2, "ids": ["culture-food-bread", "culture-language-salaam"] }
 */
import { useSyncExternalStore } from "react";
import { readDeviceValue, removeDeviceValue, writeDeviceValue } from "../persistence/settings";

export const CULTURE_SEEN_KEY = "lingua.culture.seen.v2";
export const CULTURE_SEEN_VERSION = 2;
/** Small on purpose: it only has to make the next random pick feel new. */
export const CULTURE_SEEN_LIMIT = 200;

const MAX_ID_LENGTH = 128;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Ids are opaque article keys; they may not be blank, whitespace or control characters. */
export function isSeenCultureId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
}

export interface CultureSeenDocument {
  version: typeof CULTURE_SEEN_VERSION;
  ids: string[];
}

/** Validate a parsed seen document; a wrong envelope/version reads as unavailable (null). */
export function parseCultureSeenValue(value: unknown): string[] | null {
  if (!isRecord(value)) return null;
  if (value["version"] !== CULTURE_SEEN_VERSION) return null;
  const ids = value["ids"];
  if (!Array.isArray(ids)) return null;
  const out: string[] = [];
  for (const id of ids) {
    if (!isSeenCultureId(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= CULTURE_SEEN_LIMIT) break;
  }
  return out;
}

/** Validate the raw stored string; unreadable/corrupt documents read as empty. */
export function parseCultureSeenRaw(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return parseCultureSeenValue(JSON.parse(raw)) ?? [];
  } catch {
    return [];
  }
}

export function serializeCultureSeen(ids: readonly string[]): string {
  const document: CultureSeenDocument = { version: CULTURE_SEEN_VERSION, ids: [...ids] };
  return JSON.stringify(document);
}

const EMPTY: readonly string[] = [];
let cache: string[] | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function current(): string[] {
  if (cache === null) cache = parseCultureSeenRaw(readDeviceValue(CULTURE_SEEN_KEY));
  return cache;
}

/** Recently seen ids, newest first. */
export function listSeenCultureIds(): readonly string[] {
  return current();
}

export function seenCultureCount(): number {
  return current().length;
}

export function hasSeenCulture(id: string): boolean {
  return isSeenCultureId(id) && current().includes(id);
}

async function persist(next: readonly string[]): Promise<boolean> {
  const bounded = next.filter(isSeenCultureId).slice(0, CULTURE_SEEN_LIMIT);
  cache = [...bounded];
  emit();
  try {
    return await writeDeviceValue(CULTURE_SEEN_KEY, serializeCultureSeen(cache));
  } catch {
    return false;
  }
}

/** Mark one article as seen (move-to-front; re-marking only refreshes its position). */
export async function markCultureSeen(id: string): Promise<boolean> {
  if (!isSeenCultureId(id)) return false;
  const list = current();
  if (list[0] === id) return true;
  return persist([id, ...list.filter((seen) => seen !== id)]);
}

/** Mark a page of articles seen in one device write (newest supplied id first). */
export async function markCultureSeenMany(ids: readonly string[]): Promise<boolean> {
  const incoming = ids.filter(isSeenCultureId);
  if (incoming.length === 0) return true;
  const list = current();
  const fresh = [...new Set(incoming)].filter((id) => id !== list[0]);
  if (fresh.length === 0) return true;
  return persist([...fresh, ...list.filter((seen) => !fresh.includes(seen))]);
}

/** Clear the novelty history and remove the device document. */
export async function clearSeenHistory(): Promise<boolean> {
  cache = [];
  emit();
  try {
    return await removeDeviceValue(CULTURE_SEEN_KEY);
  } catch {
    return false;
  }
}

/** Drop the in-memory copy so the next read re-reads the device document. */
export function resetCultureSeenCache(): void {
  cache = null;
  emit();
}

/**
 * Subscribe to seen-history changes (any mutation, including clearSeenHistory and a
 * cross-tab write). Returns the unsubscribe function.
 */
export function subscribeSeenCulture(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") return () => listeners.delete(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== CULTURE_SEEN_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Snapshot for useSyncExternalStore consumers that want the raw list. */
export function seenCultureSnapshot(): readonly string[] {
  return current();
}

/** React binding for the seen history; the server snapshot is empty (device data only). */
export function useSeenCultureIds(): readonly string[] {
  return useSyncExternalStore(subscribeSeenCulture, current, () => EMPTY);
}
