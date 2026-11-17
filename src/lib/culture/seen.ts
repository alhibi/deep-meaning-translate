/**
 * Recently seen culture records — device-only, bounded novelty history.
 *
 * Random discovery must not immediately show the same record twice, and the featured feed
 * benefits from knowing what a person has already opened. This store keeps the newest
 * `CULTURE_SEEN_LIMIT` ids in one versioned envelope through the app's device-storage
 * façade, never identifies anyone and is fully clearable. It is a novelty window, not an
 * analytics log: only ids, most recent first, and no timestamps or counts leave the record.
 *
 *   { "v": 1, "ids": ["met-1234", "met-42"] }
 */
import { readDeviceValue, writeDeviceValue } from "../persistence/settings";

export const CULTURE_SEEN_KEY = "lingua.culture.seen.v1";
export const CULTURE_SEEN_VERSION = 1;
/** Small on purpose: it only has to make the next random pick feel new. */
export const CULTURE_SEEN_LIMIT = 200;

const MAX_ID_LENGTH = 128;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Ids are opaque catalog keys; they may not be blank, whitespace or control characters. */
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
  v: typeof CULTURE_SEEN_VERSION;
  ids: string[];
}

/** Validate a parsed seen document; wrong envelope/version reads as unavailable (null). */
export function parseCultureSeenValue(value: unknown): string[] | null {
  if (!isRecord(value)) return null;
  if (value["v"] !== CULTURE_SEEN_VERSION) return null;
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

export function parseCultureSeenRaw(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return parseCultureSeenValue(JSON.parse(raw)) ?? [];
  } catch {
    return [];
  }
}

export function serializeCultureSeen(ids: readonly string[]): string {
  const document: CultureSeenDocument = { v: CULTURE_SEEN_VERSION, ids: [...ids] };
  return JSON.stringify(document);
}

let cache: string[] | null = null;
const listeners = new Set<() => void>();

function emit() {
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

/** Mark one record as seen (move-to-front; re-marking only refreshes its position). */
export async function markCultureSeen(id: string): Promise<boolean> {
  if (!isSeenCultureId(id)) return false;
  const list = current();
  if (list[0] === id) return true;
  return persist([id, ...list.filter((seen) => seen !== id)]);
}

/** Mark a page of records seen in one device write (most recent supplied id first). */
export async function markCultureSeenMany(ids: readonly string[]): Promise<boolean> {
  const incoming = ids.filter(isSeenCultureId);
  if (incoming.length === 0) return true;
  const list = current();
  const fresh = [...new Set(incoming)].filter((id) => id !== list[0]);
  if (fresh.length === 0) return true;
  return persist([...fresh, ...list.filter((seen) => !fresh.includes(seen))]);
}

/** Clear the novelty history (device document included). */
export async function clearSeenHistory(): Promise<boolean> {
  return persist([]);
}

/** Drop the in-memory copy so the next read re-reads the device document. */
export function resetCultureSeenCache(): void {
  cache = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") return () => listeners.delete(listener);
  const onStorage = (event: StorageEvent) => {
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

/** React binding for the seen history (used by a "clear history" control). */
export function subscribeSeenCulture(listener: () => void): () => void {
  return subscribe(listener);
}

/** Snapshot for `useSyncExternalStore` consumers that want the raw list. */
export function seenCultureSnapshot(): readonly string[] {
  return current();
}
