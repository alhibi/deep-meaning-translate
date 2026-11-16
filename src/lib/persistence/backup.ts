/**
 * Portable, self-checking device backup.
 *
 * The file is a small envelope around a validated dataset: schema version, app version,
 * creation date, counts and a SHA-256 digest. A password upgrades the payload to
 * AES-GCM with a PBKDF2-derived key (WebCrypto, never a home-made cipher). Import
 * refuses a damaged, foreign or future file before touching a single stored row.
 *
 * Merge semantics are defined once here and run against a full snapshot; the native
 * adapter then writes the result in one Room transaction. That keeps "merge" out of
 * Kotlin, where it would inevitably drift from the app's archive rules.
 */
import {
  BACKUP_SETTING_KEYS,
  HISTORY_LIMIT,
  MAX_TEXT,
  MEMORY_MAX_BYTES,
  MEMORY_MAX_ENTRIES,
  MEMORY_TTL_MS,
  SAVED_LIMIT,
  isEntry,
  isMemoryRow,
  isPhrase,
  normalizeText,
  parsePrefs,
  parseSession,
  sanitizeEntry,
  type BackupData,
  type BackupEnvelope,
  type BackupSettingKey,
  type Dataset,
  type ImportReport,
} from "./contracts";

export const BACKUP_FORMAT = "today-backup";
export const BACKUP_SCHEMA_VERSION = 1;
const TEXT_ENCODER = typeof TextEncoder === "undefined" ? null : new TextEncoder();

function bytes(value: string): number {
  return TEXT_ENCODER ? TEXT_ENCODER.encode(value).length : value.length;
}

/** Stable JSON: sorted object keys, so a whitespace or key-order change cannot fail a digest. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort())
        out[k] = walk((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) throw new Error("bad hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("crypto-unavailable");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(digest);
}

function withoutCounts(data: BackupData): BackupData {
  return {
    settings: data.settings,
    prefs: data.prefs,
    session: data.session,
    history: data.history,
    saved: data.saved,
    memory: data.memory,
  };
}

/** Drop everything that does not pass the app's own validators. */
export function cleanData(input: Partial<BackupData>): BackupData {
  const now = Date.now();
  const seenIds = new Set<string>();
  const history = (Array.isArray(input.history) ? input.history : [])
    .filter(isEntry)
    .filter((e) => (seenIds.has(e.id) ? false : (seenIds.add(e.id), true)))
    .map(sanitizeEntry)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, HISTORY_LIMIT);
  const saved = (Array.isArray(input.saved) ? input.saved : [])
    .filter(isPhrase)
    .slice(0, SAVED_LIMIT);
  const memory = (Array.isArray(input.memory) ? input.memory : [])
    .filter(isMemoryRow)
    .filter((r) => now - r.at <= MEMORY_TTL_MS)
    .slice(0, MEMORY_MAX_ENTRIES);
  const settings: Partial<Record<BackupSettingKey, string>> = {};
  for (const key of BACKUP_SETTING_KEYS) {
    const value = input.settings?.[key];
    if (typeof value === "string" && value.length <= 20_000) settings[key] = value;
  }
  return {
    settings,
    prefs: parsePrefs(input.prefs),
    session: parseSession(input.session),
    history,
    saved,
    memory,
  };
}

export async function createBackup(
  raw: Partial<BackupData>,
  opts: { appVersion: string; password?: string; createdAt?: string },
): Promise<BackupEnvelope> {
  const data = cleanData(raw);
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const digest = await sha256(canonicalJson(data));
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: opts.appVersion,
    createdAt,
    encrypted: false,
    digest,
    data,
  };
  if (!opts.password) return envelope;
  const cipher = await encryptPayload(canonicalJson(data), opts.password);
  if (!cipher) throw new Error("crypto-unavailable");
  return {
    ...envelope,
    encrypted: true,
    data: null,
    digest: await sha256(cipher.text),
    cipher,
  };
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("crypto-unavailable");
  const base = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptPayload(plain: string, password: string): Promise<BackupEnvelope["cipher"]> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("crypto-unavailable");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 210_000;
  const key = await deriveKey(password, salt, iterations);
  const encrypted = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  return {
    algorithm: "AES-GCM",
    kdf: "PBKDF2",
    iterations,
    salt: toHex(salt.buffer as ArrayBuffer),
    iv: toHex(iv.buffer as ArrayBuffer),
    text: toHex(encrypted),
  };
}

export type ParseResult =
  | { ok: true; envelope: BackupEnvelope; data: BackupData; counts: Counts }
  | { ok: false; reason: "format" | "version" | "integrity" | "damaged" | "password" };

export interface Counts {
  history: number;
  saved: number;
  memory: number;
  settings: number;
}

export function countOf(data: BackupData): Counts {
  return {
    history: data.history.length,
    saved: data.saved.length,
    memory: data.memory.length,
    settings: Object.keys(data.settings).length,
  };
}

/** Validate the envelope, verify the digest, and (when needed) decrypt the payload. */
export async function parseBackup(text: string, password?: string): Promise<ParseResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "damaged" };
  }
  const envelope = raw as BackupEnvelope;
  if (!envelope || envelope.format !== BACKUP_FORMAT || typeof envelope.schemaVersion !== "number")
    return { ok: false, reason: "format" };
  if (envelope.schemaVersion > BACKUP_SCHEMA_VERSION) return { ok: false, reason: "version" };
  if (envelope.schemaVersion < 1) return { ok: false, reason: "damaged" };

  let payload: unknown = envelope.data;
  try {
    if (envelope.encrypted) {
      if (!password || !envelope.cipher) return { ok: false, reason: "password" };
      if (envelope.cipher.algorithm !== "AES-GCM" || envelope.cipher.kdf !== "PBKDF2")
        return { ok: false, reason: "format" };
      const key = await deriveKey(
        password,
        fromHex(envelope.cipher.salt),
        Math.min(600_000, Math.max(100_000, envelope.cipher.iterations)),
      );
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromHex(envelope.cipher.iv) as BufferSource },
        key,
        fromHex(envelope.cipher.text) as BufferSource,
      );
      if ((await sha256(envelope.cipher.text)) !== envelope.digest)
        return { ok: false, reason: "integrity" };
      payload = JSON.parse(new TextDecoder().decode(plain));
    } else {
      if ((await sha256(canonicalJson(envelope.data))) !== envelope.digest)
        return { ok: false, reason: "integrity" };
    }
  } catch {
    return { ok: false, reason: "password" };
  }
  const data = cleanData((payload ?? {}) as Partial<BackupData>);
  return { ok: true, envelope, data, counts: countOf(data) };
}

/** Merge by identity, keeping the newer row. Never duplicates an id or a sentence. */
export function mergeData(
  local: Dataset,
  incoming: BackupData,
): { data: BackupData; report: ImportReport } {
  const historyById = new Map<string, (typeof local.history)[number]>();
  const historyByText = new Map<string, string>();
  for (const row of local.history) {
    historyById.set(row.id, row);
    historyByText.set(`${row.target}|${normalizeText(row.original)}`, row.id);
  }
  let addedHistory = 0;
  let skippedHistory = 0;
  for (const row of incoming.history) {
    const key = `${row.target}|${normalizeText(row.original)}`;
    const existingId = historyByText.get(key);
    if (existingId) {
      const existing = historyById.get(existingId);
      if (
        !existing ||
        (row.updatedAt ?? row.createdAt) > (existing.updatedAt ?? existing.createdAt)
      ) {
        historyById.set(existingId, {
          ...existing,
          ...row,
          id: existingId,
          createdAt: existing?.createdAt ?? row.createdAt,
        });
      }
      skippedHistory++;
      continue;
    }
    historyById.set(row.id, row);
    historyByText.set(key, row.id);
    addedHistory++;
  }
  const history = [...historyById.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, HISTORY_LIMIT);

  const savedKey = (p: { target: string; original: string }) =>
    `${p.target}|${normalizeText(p.original)}`;
  const savedMap = new Map(local.saved.map((p) => [savedKey(p), p]));
  let addedSaved = 0;
  let skippedSaved = 0;
  for (const p of incoming.saved) {
    const key = savedKey(p);
    const existing = savedMap.get(key);
    if (!existing) {
      savedMap.set(key, p);
      addedSaved++;
    } else {
      if (p.reviewedAt > existing.reviewedAt)
        savedMap.set(key, { ...existing, ...p, id: existing.id });
      skippedSaved++;
    }
  }
  const saved = [...savedMap.values()].slice(0, SAVED_LIMIT);

  const memoryMap = new Map(local.memory.map((r) => [r.k, r]));
  let addedMemory = 0;
  let skippedMemory = 0;
  for (const row of incoming.memory) {
    const existing = memoryMap.get(row.k);
    if (!existing) {
      memoryMap.set(row.k, row);
      addedMemory++;
    } else {
      if (row.at > existing.at) memoryMap.set(row.k, row);
      skippedMemory++;
    }
  }
  const memory = [...memoryMap.values()]
    .sort((a, b) => b.at - a.at)
    .filter((r) => Date.now() - r.at <= MEMORY_TTL_MS)
    .slice(0, MEMORY_MAX_ENTRIES);
  // The byte budget is part of the memory contract, not a nicety.
  while (bytes(JSON.stringify(memory)) > MEMORY_MAX_BYTES && memory.length > 1) memory.pop();

  const settings = { ...local.settings };
  let addedSettings = 0;
  for (const [k, v] of Object.entries(incoming.settings)) {
    if (typeof v !== "string") continue;
    if (settings[k as BackupSettingKey] === undefined) addedSettings++;
    settings[k as BackupSettingKey] = v;
  }

  return {
    data: {
      settings,
      prefs: local.prefs ?? incoming.prefs,
      session: local.session ?? incoming.session,
      history,
      saved,
      memory,
    },
    report: {
      added: {
        history: addedHistory,
        saved: addedSaved,
        memory: addedMemory,
        settings: addedSettings,
      },
      skipped: { history: skippedHistory, saved: skippedSaved, memory: skippedMemory },
      replaced: false,
    },
  };
}

/** Strict replacement: the backup becomes this device's dataset. */
export function replaceData(
  incoming: BackupData,
  previous: Dataset,
): { data: BackupData; report: ImportReport } {
  return {
    data: {
      settings: incoming.settings,
      prefs: incoming.prefs,
      session: incoming.session,
      history: incoming.history.slice(0, HISTORY_LIMIT),
      saved: incoming.saved.slice(0, SAVED_LIMIT),
      memory: incoming.memory.slice(0, MEMORY_MAX_ENTRIES),
    },
    report: {
      added: {
        history: incoming.history.length,
        saved: incoming.saved.length,
        memory: incoming.memory.length,
        settings: Object.keys(incoming.settings).length,
      },
      skipped: { history: 0, saved: 0, memory: 0 },
      replaced: true,
    },
  };
}

/** Download in the browser. The native path uses the Storage Access Framework instead. */
export function downloadBackup(filename: string, text: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function backupFilename(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `today-backup-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(
    date.getHours(),
  )}${p(date.getMinutes())}.json`;
}

export { MAX_TEXT };
