import {
  isDomain,
  isIntent,
  isKind,
  isRegister,
  type Domain,
  type Intent,
  type Kind,
  type Register,
} from "./stats/taxonomy";

/** Classification tags. `tags` come from the model; `fix` are the user's own corrections and always win. */
export interface EntryTags {
  kind?: Kind;
  domain?: Domain;
  intent?: Intent;
  register?: Register;
}

/**
 * One translation archive, shared by the translator and Translation Statistics.
 * Rows written before statistics existed have no `v`; they stay valid and are
 * counted as imported ("legacy") rows — never copied, so nothing is counted twice.
 */
export interface HistoryEntry {
  id: string;
  source: string;
  target: string;
  original: string;
  translated: string;
  /** First time this thought was translated. Never changed afterwards. */
  createdAt: number;
  v?: 2;
  /** Last time it was translated or re-used. */
  updatedAt?: number | undefined;
  /** Separate occasions the same text was translated again (≥ 1). */
  uses?: number | undefined;
  style?: string | undefined;
  formality?: string | undefined;
  situation?: string | undefined;
  tags?: EntryTags | undefined;
  fix?: EntryTags | undefined;
}

const KEY = "lingua.history.v1";
/** ~2 000 rows ≈ 1–2 MB, well inside the device's local storage budget. */
export const HISTORY_LIMIT = 2000;
const MAX_TEXT = 5000;
/** Re-translating the same text sooner than this is the same occasion, not a new use. */
const NEW_USE_AFTER = 30 * 60_000;
/** A sentence that grows while typing within this window is the same thought. */
const GROW_WINDOW = 3 * 60_000;

function cleanTags(v: unknown): EntryTags | undefined {
  if (!v || typeof v !== "object") return undefined;
  const t = v as Record<string, unknown>;
  const out: EntryTags = {};
  if (isKind(t["kind"])) out.kind = t["kind"];
  if (isDomain(t["domain"])) out.domain = t["domain"];
  if (isIntent(t["intent"])) out.intent = t["intent"];
  if (isRegister(t["register"])) out.register = t["register"];
  return Object.keys(out).length ? out : undefined;
}

/** Damaged or foreign rows in storage are dropped, never allowed to crash the app. */
export function isEntry(v: unknown): v is HistoryEntry {
  const e = v as HistoryEntry;
  return (
    !!e &&
    typeof e === "object" &&
    typeof e.id === "string" &&
    typeof e.original === "string" &&
    typeof e.translated === "string" &&
    typeof e.target === "string" &&
    typeof e.source === "string" &&
    Number.isFinite(e.createdAt)
  );
}

/** Keeps the valid core and only the optional fields that pass validation. */
export function sanitizeEntry(e: HistoryEntry): HistoryEntry {
  const out: HistoryEntry = {
    id: e.id,
    source: e.source,
    target: e.target,
    original: e.original.slice(0, MAX_TEXT),
    translated: e.translated.slice(0, MAX_TEXT),
    createdAt: e.createdAt,
  };
  if (e.v === 2) out.v = 2;
  if (typeof e.updatedAt === "number" && Number.isFinite(e.updatedAt)) out.updatedAt = e.updatedAt;
  if (typeof e.uses === "number" && Number.isInteger(e.uses) && e.uses >= 1) out.uses = e.uses;
  if (typeof e.style === "string") out.style = e.style;
  if (typeof e.formality === "string") out.formality = e.formality;
  if (typeof e.situation === "string") out.situation = e.situation;
  const tags = cleanTags(e.tags);
  if (tags) out.tags = tags;
  const fix = cleanTags(e.fix);
  if (fix) out.fix = fix;
  return out;
}

export type HistoryStatus = "ok" | "unavailable";
let status: HistoryStatus = "ok";
let lastWriteOk = true;
let cache: HistoryEntry[] | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function read(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
    status = "ok";
  } catch {
    status = "unavailable"; // storage blocked by the browser — reported, never faked
    return [];
  }
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: HistoryEntry[] = [];
    for (const row of parsed as unknown[]) {
      if (!isEntry(row) || seen.has(row.id)) continue; // one row per id, ever
      seen.add(row.id);
      out.push(sanitizeEntry(row));
    }
    return out;
  } catch {
    return [];
  }
}

function current(): HistoryEntry[] {
  if (cache === null) cache = read();
  return cache;
}

function write(entries: HistoryEntry[]): HistoryEntry[] {
  const next = entries.slice(0, HISTORY_LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    lastWriteOk = true;
  } catch {
    lastWriteOk = false; // storage full or blocked — the in-memory list still reflects reality
  }
  cache = next;
  emit();
  return next;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

export interface NewEntry {
  source: string;
  target: string;
  original: string;
  translated: string;
  style?: string | undefined;
  formality?: string | undefined;
  situation?: string | undefined;
  tags?: EntryTags | undefined;
}

if (typeof window !== "undefined") {
  // Another tab changed the archive: re-read so statistics never show stale numbers.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) {
      cache = null;
      emit();
    }
  });
}

export const history = {
  list: (): HistoryEntry[] => current(),
  status: (): HistoryStatus => (current(), status),
  lastWriteOk: () => lastWriteOk,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  /** Forces a fresh read from storage (used by "try again"). */
  reload() {
    cache = null;
    emit();
  },
  /**
   * Records a settled translation. The same text again updates its row in place
   * (no duplicate, original date kept); a sentence that grew while typing replaces
   * its shorter versions. `quiet` re-displays (e.g. a restored draft) never count as a use.
   */
  add(entry: NewEntry, opts: { quiet?: boolean } = {}): HistoryEntry[] {
    // Only real, finished translations into a real language are archived.
    if (!/^[a-z]{2}$/.test(entry.target) || !entry.translated.trim() || !entry.original.trim())
      return current();
    const now = Date.now();
    const original = entry.original.slice(0, MAX_TEXT);
    const key = norm(original);
    const rows = current();
    const merged: HistoryEntry[] = [];
    const rest: HistoryEntry[] = [];
    for (const e of rows) {
      if (e.target !== entry.target) {
        rest.push(e);
        continue;
      }
      const ek = norm(e.original);
      const recent = now - (e.updatedAt ?? e.createdAt) < GROW_WINDOW;
      if (ek === key || (recent && (key.startsWith(ek) || ek.startsWith(key)))) merged.push(e);
      else rest.push(e);
    }
    const same = merged.find((e) => norm(e.original) === key);
    const base = same ?? merged[0];
    let uses = Math.max(1, ...merged.map((e) => e.uses ?? 1));
    if (same && !opts.quiet && now - (same.updatedAt ?? same.createdAt) >= NEW_USE_AFTER) uses += 1;
    const row = sanitizeEntry({
      id: base?.id ?? `${now}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: merged.length ? Math.min(...merged.map((e) => e.createdAt)) : now,
      v: 2,
      updatedAt: now,
      uses,
      source: entry.source,
      target: entry.target,
      original,
      translated: entry.translated,
      style: entry.style ?? base?.style,
      formality: entry.formality || base?.formality,
      situation: entry.situation ?? base?.situation,
      // A provisional settle carries no tags; keep the model's earlier ones.
      tags: entry.tags ?? (same ? base?.tags : undefined),
      fix: same?.fix,
    });
    return write([row, ...rest]);
  },
  /** Corrects classification without touching dates, text or counts. `null` resets a field to automatic. */
  retag(id: string, fix: { [K in keyof EntryTags]?: EntryTags[K] | null }): HistoryEntry[] {
    return write(
      current().map((e) => {
        if (e.id !== id) return e;
        const next: Record<string, unknown> = { ...e.fix };
        for (const [k, v] of Object.entries(fix)) {
          if (v === null) delete next[k];
          else next[k] = v;
        }
        return sanitizeEntry({ ...e, fix: next as EntryTags });
      }),
    );
  },
  remove(id: string): HistoryEntry[] {
    return write(current().filter((e) => e.id !== id));
  },
  clear(): HistoryEntry[] {
    return write([]);
  },
};
