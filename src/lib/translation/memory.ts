import { isResult } from "../persist";
import type { TranslationResult } from "./types";

/**
 * Translation memory: the sentence you already translated comes back instantly.
 *
 * The in-memory cache in `useTranslator` only lives as long as the tab. This one lives
 * on the device, so re-opening the app and pasting last week's message costs **zero
 * requests and zero milliseconds** — the single most visible speed win available to a
 * translation app, and the one nobody notices until it is missing.
 *
 * Deliberate constraints:
 * - **device-only.** Nothing is uploaded; this is the same class of storage the
 *   phrasebook and history already use, and the privacy page says so.
 * - **bounded twice**: at most `MAX_ENTRIES` rows *and* at most `MAX_BYTES` of JSON,
 *   whichever comes first. A localStorage quota error must never be able to break a
 *   translation, so a failed write is dropped, not retried.
 * - **validated on read.** A row whose payload no longer passes `isResult` (schema
 *   changed, storage tampered with, a half-written value) is discarded rather than
 *   rendered. Trusting device storage is how a UI ends up showing `undefined`.
 * - **expired.** A 30-day ceiling keeps a stale model answer from outliving its model.
 *
 * Rows are kept newest-first, so position *is* the recency order: reading is a scan
 * that stops at the first match, evicting is a pop, and touching a row is a move to
 * the front. One array, one invariant, no map to keep in sync with it.
 */

const KEY = "lingua.memory.v1";
const MAX_ENTRIES = 120;
const MAX_BYTES = 200_000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface Row {
  /** The exact cache key `useTranslator` already computes — one definition, not two. */
  k: string;
  v: TranslationResult;
  /** Written at, epoch ms. Drives both expiry and eviction order. */
  at: number;
}

/** null = not read yet, so an empty device is not re-read on every request. */
let rows: Row[] | null = null;

function isRow(v: unknown): v is Row {
  const r = v as Row | null;
  return (
    !!r &&
    typeof r === "object" &&
    typeof r.k === "string" &&
    typeof r.at === "number" &&
    isResult(r.v)
  );
}

/** Damaged JSON must start clean, not throw in the middle of a keystroke. */
function readStored(): unknown {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}

function load(): Row[] {
  if (rows) return rows;
  rows = [];
  if (typeof window === "undefined") return rows;
  const raw = readStored();
  if (!Array.isArray(raw)) return rows;
  const now = Date.now();
  const kept: Row[] = [];
  for (const item of raw) {
    if (!isRow(item)) continue; // foreign or stale shape
    if (now - item.at > TTL_MS) continue;
    if (kept.some((r) => r.k === item.k)) continue; // a duplicate key is older data
    kept.push(item);
    if (kept.length >= MAX_ENTRIES) break;
  }
  rows = kept;
  return rows;
}

function flush(): void {
  if (typeof window === "undefined" || !rows) return;
  // Trim to the byte budget from the oldest end before writing, never after:
  // a value that does not fit must not be written at all.
  let out = rows;
  let json = JSON.stringify(out);
  while (json.length > MAX_BYTES && out.length > 1) {
    out = out.slice(0, -1);
    json = JSON.stringify(out);
  }
  rows = out;
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* quota or private mode: the memory simply stays in RAM for this session */
  }
}

/** A settled translation for this key, or null when it is unknown or too old. */
export function memoryGet(key: string): TranslationResult | null {
  if (!key) return null;
  const list = load();
  const i = list.findIndex((r) => r.k === key);
  const row = i < 0 ? undefined : list[i];
  if (!row) return null;
  if (Date.now() - row.at > TTL_MS) {
    list.splice(i, 1);
    flush();
    return null;
  }
  if (i > 0) {
    // Recency is the array order, so a hit has to move to the front or the
    // least-used row would be the one that is read most often.
    list.splice(i, 1);
    list.unshift(row);
    flush();
  }
  return row.v;
}

/** Remember a settled translation. Provisional/live text must never be stored. */
export function memorySet(key: string, value: TranslationResult): void {
  if (!key || !isResult(value)) return;
  const list = load();
  const at = Date.now();
  const i = list.findIndex((r) => r.k === key);
  const row: Row = { k: key, v: value, at };
  if (i >= 0) list.splice(i, 1);
  list.unshift(row);
  while (list.length > MAX_ENTRIES) list.pop();
  flush();
}

/** Forget one key — used when a translation is superseded by a repair. */
export function memoryDrop(key: string): void {
  const list = load();
  const i = list.findIndex((r) => r.k === key);
  if (i < 0) return;
  list.splice(i, 1);
  flush();
}

/** How many rows are held. Used by tests and by any future "storage used" line. */
export function memorySize(): number {
  return load().length;
}

/** Empty the memory (and the disk copy). */
export function memoryClear(): void {
  rows = [];
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

/** Test hook: forget the loaded copy so the next read hits storage again. */
export function memoryResetForTests(): void {
  rows = null;
}
