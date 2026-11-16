/**
 * The data contract shared by every persistence backend.
 *
 * These are the exact shapes the app already validates: moving them here lets the web
 * and native adapters agree without either one importing the other. Dates are epoch
 * milliseconds, ids are strings, and every value that crosses the bridge is validated
 * again on read — device storage is never trusted.
 */
import type { Brain, Dialect, StyleOverride, TranslationResult } from "../translation/types";
import { isResult } from "../translation/result";
import { matchesTarget } from "../translation/view";
import {
  isDomain,
  isIntent,
  isKind,
  isRegister,
  type Domain,
  type Intent,
  type Kind,
  type Register,
} from "../stats/taxonomy";

export const HISTORY_LIMIT = 2000;
export const SAVED_LIMIT = 300;
export const MEMORY_MAX_ENTRIES = 120;
export const MEMORY_MAX_BYTES = 200_000;
export const MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_TEXT = 5000;

/* ------------------------------------------------------------------ preferences */

const STYLES: readonly string[] = ["natural", "formal", "casual"];
const DIALECTS: readonly string[] = ["auto", "msa", "levant", "egypt", "gulf", "iraq", "maghreb"];

export interface Prefs {
  source: string;
  target: string;
  style: StyleOverride;
  dialect?: Dialect;
  brain?: Brain;
  /** Sentence shadow on/off (default on). */
  shadow?: boolean;
}

export interface Session {
  text: string;
  result: TranslationResult | null;
  source: string;
  target: string;
  style: StyleOverride;
}

export const isSourceCode = (v: unknown): v is string =>
  typeof v === "string" && /^([a-z]{2}|auto)$/.test(v);
export const isTargetCode = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z]{2}$/.test(v);
const isStyle = (v: unknown): v is StyleOverride => typeof v === "string" && STYLES.includes(v);

export function parsePrefs(v: unknown): Prefs | null {
  const p = v as { [K in keyof Prefs]?: unknown } | null;
  if (!p || typeof p !== "object") return null;
  if (!isSourceCode(p.source) || !isTargetCode(p.target) || !isStyle(p.style)) return null;
  if (p.source === p.target) return null;
  const out: Prefs = { source: p.source, target: p.target, style: p.style };
  if (typeof p.dialect === "string" && DIALECTS.includes(p.dialect))
    out.dialect = p.dialect as Dialect;
  if (p.brain === "deepseek" || p.brain === "luna") out.brain = p.brain;
  if (typeof p.shadow === "boolean") out.shadow = p.shadow;
  return out;
}

export function parseSession(v: unknown): Session | null {
  const s = v as { [K in keyof Session]?: unknown } | null;
  if (!s || typeof s !== "object") return null;
  if (typeof s.text !== "string" || !s.text.trim()) return null;
  if (!isSourceCode(s.source) || !isTargetCode(s.target) || !isStyle(s.style)) return null;
  return {
    text: s.text.slice(0, MAX_TEXT),
    // A damaged cached result is discarded, and so is one written into another target
    // language; the text is simply translated again.
    result: isResult(s.result) && matchesTarget(s.result, s.target) ? s.result : null,
    source: s.source,
    target: s.target,
    style: s.style,
  };
}

/* ------------------------------------------------------------------- history rows */

export interface EntryTags {
  kind?: Kind;
  domain?: Domain;
  intent?: Intent;
  register?: Register;
}

export interface HistoryEntry {
  id: string;
  source: string;
  target: string;
  original: string;
  translated: string;
  createdAt: number;
  v?: 2;
  updatedAt?: number | undefined;
  uses?: number | undefined;
  style?: string | undefined;
  formality?: string | undefined;
  situation?: string | undefined;
  tags?: EntryTags | undefined;
  fix?: EntryTags | undefined;
}

export const validDate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15;

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
    validDate(e.createdAt)
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
  if (validDate(e.updatedAt)) out.updatedAt = e.updatedAt;
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

/* ---------------------------------------------------------------------- phrases */

export interface SavedPhrase {
  id: string;
  source: string;
  target: string;
  original: string;
  translated: string;
  createdAt: number;
  known: number;
  reviewedAt: number;
}

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

/* ------------------------------------------------------------- translation memory */

export interface MemoryRow {
  /** The exact cache key `useTranslator` computes — one definition, not two. */
  k: string;
  v: TranslationResult;
  /** Written at, epoch ms. Drives both expiry and eviction order. */
  at: number;
}

export function isMemoryRow(v: unknown): v is MemoryRow {
  const r = v as MemoryRow | null;
  return (
    !!r &&
    typeof r === "object" &&
    typeof r.k === "string" &&
    typeof r.at === "number" &&
    isResult(r.v)
  );
}

export const normalizeText = (s: string) => s.trim().replace(/\s+/g, " ");

/* ------------------------------------------------------------------------ backup */

/** The only `lingua.*` keys a backup may contain: an explicit whitelist, never a dump. */
export const BACKUP_SETTING_KEYS = [
  "lingua.theme.v1",
  "lingua.ui-locale",
  "lingua.voice.v1",
  "lingua.voice.v2",
  "lingua.feel.v1",
  "lingua.recent-langs",
  "lingua.language-favorites.v1",
  "lingua.stats.v1",
  "lingua.intro.seen.v1",
  "lingua.install.dismissed",
] as const;

export type BackupSettingKey = (typeof BACKUP_SETTING_KEYS)[number];

export interface BackupData {
  settings: Partial<Record<BackupSettingKey, string>>;
  prefs: Prefs | null;
  session: Session | null;
  history: HistoryEntry[];
  saved: SavedPhrase[];
  memory: MemoryRow[];
}

export interface BackupEnvelope {
  format: "today-backup";
  schemaVersion: 1;
  appVersion: string;
  createdAt: string;
  encrypted: boolean;
  /** SHA-256 of the canonical JSON of `data` (or of the ciphertext when encrypted). */
  digest: string;
  data: BackupData | null;
  /** AES-GCM payload, present only when a password was supplied. */
  cipher?: {
    algorithm: "AES-GCM";
    kdf: "PBKDF2";
    iterations: number;
    salt: string;
    iv: string;
    text: string;
  };
}

export interface ImportReport {
  added: { history: number; saved: number; memory: number; settings: number };
  skipped: { history: number; saved: number; memory: number };
  replaced: boolean;
}

export interface Dataset extends BackupData {
  /** Total rows held before a merge; the report needs the difference. */
  historyTotal?: number;
}
