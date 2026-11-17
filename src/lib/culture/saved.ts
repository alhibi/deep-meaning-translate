/**
 * Saved culture articles -- device-only, bounded and validated on read.
 *
 * This is a local reading list for the discovery surface, not a profile: it lives under its
 * own lingua.culture.* key through the app's device-storage facade (readDeviceValue /
 * writeDeviceValue / removeDeviceValue -- localStorage on the web, the hydrated DataStore
 * snapshot on Android), it is never sent anywhere, and nothing in it identifies a person.
 * The document is a versioned envelope rather than a bare array so a future shape can be
 * refused instead of misread:
 *
 *   { "version": 2, "ids": ["culture-food-bread", "culture-language-salaam"] }
 *
 * Every read goes through parseCultureSavedValue: a damaged document, another version, a
 * non-array or an invalid id yields the valid subset (or nothing), never a crash and never
 * an unbounded list. Writes keep the newest CULTURE_SAVED_LIMIT ids and are optimistic in
 * memory; the device-write result is returned, never hidden.
 */
import { useSyncExternalStore } from "react";
import { readDeviceValue, removeDeviceValue, writeDeviceValue } from "../persistence/settings";

export const CULTURE_SAVED_KEY = "lingua.culture.saved.v2";
export const CULTURE_SAVED_VERSION = 2;
export const CULTURE_SAVED_LIMIT = 500;

const MAX_ID_LENGTH = 128;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Ids are opaque article keys; they may not be blank, whitespace or control characters. */
export function isCultureId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
}

export interface CultureSavedDocument {
  version: typeof CULTURE_SAVED_VERSION;
  ids: string[];
}

/**
 * Validate a parsed saved document. Returns null when the document itself is not this
 * store's shape (wrong envelope/version), and a filtered, deduplicated, bounded list when
 * individual ids are unusable -- one bad id must not throw away the person's other saves.
 */
export function parseCultureSavedValue(value: unknown): string[] | null {
  if (!isRecord(value)) return null;
  if (value["version"] !== CULTURE_SAVED_VERSION) return null;
  const ids = value["ids"];
  if (!Array.isArray(ids)) return null;
  const out: string[] = [];
  for (const id of ids) {
    if (!isCultureId(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= CULTURE_SAVED_LIMIT) break;
  }
  return out;
}

/** Validate the raw stored string; unreadable/corrupt documents read as empty. */
export function parseCultureSavedRaw(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return parseCultureSavedValue(JSON.parse(raw)) ?? [];
  } catch {
    return [];
  }
}

/** The exact document written for a list, so tests and diagnostics compare bytes. */
export function serializeCultureSaved(ids: readonly string[]): string {
  const document: CultureSavedDocument = { version: CULTURE_SAVED_VERSION, ids: [...ids] };
  return JSON.stringify(document);
}

const EMPTY: readonly string[] = [];
let cache: string[] | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function current(): string[] {
  if (cache === null) cache = parseCultureSavedRaw(readDeviceValue(CULTURE_SAVED_KEY));
  return cache;
}

/** Saved ids, most recently saved first. Never triggers a device write. */
export function listSavedCultureIds(): readonly string[] {
  return current();
}

export function savedCultureCount(): number {
  return current().length;
}

export function isCultureSaved(id: string): boolean {
  return isCultureId(id) && current().includes(id);
}

async function persist(next: readonly string[]): Promise<boolean> {
  const bounded = next.filter(isCultureId).slice(0, CULTURE_SAVED_LIMIT);
  cache = [...bounded];
  emit();
  try {
    return await writeDeviceValue(CULTURE_SAVED_KEY, serializeCultureSaved(cache));
  } catch {
    return false;
  }
}

/** Save an article (move-to-front); returns whether the device kept it. */
export async function saveCultureItem(id: string): Promise<boolean> {
  if (!isCultureId(id)) return false;
  const list = current();
  if (list[0] === id) return true;
  return persist([id, ...list.filter((saved) => saved !== id)]);
}

/** Remove one saved article; returns whether the device kept the change. */
export async function removeCultureItem(id: string): Promise<boolean> {
  if (!isCultureId(id)) return false;
  const list = current();
  if (!list.includes(id)) return true;
  return persist(list.filter((saved) => saved !== id));
}

/** Flip an article's saved state; resolves to the new state (true = saved). */
export async function toggleCultureSaved(id: string): Promise<boolean> {
  if (isCultureSaved(id)) {
    await removeCultureItem(id);
    return false;
  }
  await saveCultureItem(id);
  return true;
}

/** Clear the whole list and remove the device document. */
export async function clearCultureSaved(): Promise<boolean> {
  cache = [];
  emit();
  try {
    return await removeDeviceValue(CULTURE_SAVED_KEY);
  } catch {
    return false;
  }
}

/**
 * Drop the in-memory copy so the next read re-reads the device document. Used after an
 * import/restore or "forget everything"; the list itself is not changed.
 */
export function resetCultureSavedCache(): void {
  cache = null;
  emit();
}

/**
 * Subscribe to saved-list changes (any mutation, including clearCultureSaved and a
 * cross-tab write). Returns the unsubscribe function. The UI adapter wraps this in its
 * port; returning it publicly is what makes non-toggle mutations observable.
 */
export function subscribeCultureSaved(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") return () => listeners.delete(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== CULTURE_SAVED_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** React binding for the saved list; the server snapshot is empty (device data only). */
export function useSavedCultureIds(): readonly string[] {
  return useSyncExternalStore(subscribeCultureSaved, current, () => EMPTY);
}
