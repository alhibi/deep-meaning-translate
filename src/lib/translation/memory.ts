import { isNativeApp } from "../native/config";
import { port } from "../persistence";
import {
  MEMORY_MAX_BYTES,
  MEMORY_MAX_ENTRIES,
  MEMORY_TTL_MS,
  isMemoryRow,
  type MemoryRow,
} from "../persistence/contracts";
import { readMemory } from "../persistence/web";
import { isResult } from "./result";
import type { TranslationResult } from "./types";

/**
 * Translation memory: the sentence you already translated comes back instantly.
 *
 * The in-memory cache in `useTranslator` only lives as long as the tab. This one lives
 * on the device — a Room table in the Android app, `lingua.memory.v1` in the browser —
 * so re-opening the app and pasting last week's message costs **zero requests and zero
 * milliseconds**.
 *
 * Deliberate constraints:
 * - **device-only.** Nothing is uploaded; this is the same class of storage the
 *   phrasebook and history already use, and the privacy page says so.
 * - **bounded twice**: at most `MAX_ENTRIES` rows *and* at most `MAX_BYTES` of JSON.
 *   Bytes are real UTF-8 bytes, so an Arabic row cannot buy twice the budget a Latin
 *   row gets. A quota error must never break a translation, so a failed write is
 *   dropped, not retried.
 * - **validated on read.** A row that no longer passes `isResult` is discarded.
 * - **expired.** A 30-day ceiling keeps a stale model answer from outliving its model.
 * - **settled only.** A provisional stream never went through `verify`; storing one
 *   would let an unchecked reading answer for that text forever.
 *
 * Rows are kept newest-first, so position *is* the recency order.
 */
const native = isNativeApp();
let rows: MemoryRow[] | null = null;

/** Called once by the platform boot with the validated native snapshot. */
export function hydrateMemory(list: MemoryRow[]) {
  rows = list.filter(isMemoryRow).slice(0, MEMORY_MAX_ENTRIES);
}

if (typeof window !== "undefined" && !native) {
  // Another tab cleared the device: drop this tab's copy instead of answering from stale RAM.
  window.addEventListener("storage", (event) => {
    if (event.key === "lingua.memory.v1" || event.key === null) rows = null;
  });
}

function load(): MemoryRow[] {
  if (rows) return rows;
  rows = native ? [] : readMemory();
  return rows;
}

/** Real UTF-8 bytes, not UTF-16 code units: an Arabic row costs two bytes per letter. */
const encoder = typeof TextEncoder === "undefined" ? null : new TextEncoder();
const byteLength = (value: string) => (encoder ? encoder.encode(value).length : value.length);

function flush(): Promise<boolean> {
  if (!rows) return Promise.resolve(true);
  // Trim to the byte budget from the oldest end before writing, never after:
  // a value that does not fit must not be written at all.
  let out = rows;
  let json = JSON.stringify(out);
  while (byteLength(json) > MEMORY_MAX_BYTES && out.length > 1) {
    out = out.slice(0, -1);
    json = JSON.stringify(out);
  }
  rows = out;
  return port.memoryWrite(out).then(
    () => true,
    () => false,
  );
}

/** A settled translation for this key, or null when it is unknown or too old. */
export function memoryGet(key: string): TranslationResult | null {
  if (!key) return null;
  const list = load();
  const i = list.findIndex((r) => r.k === key);
  const row = i < 0 ? undefined : list[i];
  if (!row) return null;
  if (Date.now() - row.at > MEMORY_TTL_MS) {
    list.splice(i, 1);
    void flush();
    return null;
  }
  if (i > 0) {
    // Recency is the array order, so a hit has to move to the front or the
    // least-used row would be the one that is read most often.
    list.splice(i, 1);
    list.unshift(row);
    void flush();
  }
  return row.v;
}

/** Remember a settled translation. Provisional/live text must never be stored. */
export function memorySet(key: string, value: TranslationResult): Promise<boolean> {
  if (!key || !isResult(value)) return Promise.resolve(false);
  const list = load();
  const at = Date.now();
  const i = list.findIndex((r) => r.k === key);
  const row: MemoryRow = { k: key, v: value, at };
  if (i >= 0) list.splice(i, 1);
  list.unshift(row);
  while (list.length > MEMORY_MAX_ENTRIES) list.pop();
  return flush();
}

/** Forget one key — used when a translation is superseded by a repair. */
export function memoryDrop(key: string): Promise<boolean> {
  const list = load();
  const i = list.findIndex((r) => r.k === key);
  if (i < 0) return Promise.resolve(true);
  list.splice(i, 1);
  return flush();
}

/** How many rows are held. Used by tests and by any future "storage used" line. */
export function memorySize(): number {
  return load().length;
}

/** Empty the memory (and the device copy). */
export function memoryClear(): Promise<boolean> {
  rows = [];
  return port.memoryClear().then(
    () => true,
    () => false,
  );
}

/** Test hook: forget the loaded copy so the next read hits storage again. */
export function memoryResetForTests(): void {
  rows = null;
}

export type { MemoryRow };
