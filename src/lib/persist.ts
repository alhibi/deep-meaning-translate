import type { Dialect, StyleOverride, TranslationResult } from "./translation/types";

/**
 * Intentional, device-only persistence. Nothing here leaves the device.
 * - prefs: language pair + style (not sensitive)
 * - session: the current draft and its latest translation, so the app feels continuous
 * Everything read back is validated: damaged or foreign values are dropped, never trusted.
 */
const PREFS = "lingua.prefs.v1";
const SESSION = "lingua.session.v1";
const MAX_TEXT = 5000;

export interface Prefs {
  source: string;
  target: string;
  style: StyleOverride;
  dialect?: Dialect;
}
export interface Session {
  text: string;
  result: TranslationResult | null;
  source: string;
  target: string;
  style: StyleOverride;
}

const STYLES: readonly string[] = ["natural", "formal", "casual"];
const DIALECTS: readonly string[] = ["auto", "msa", "levant", "egypt", "gulf", "iraq", "maghreb"];
// Mirrors the server input schema so a restored pair can never be rejected by it.
export const isSourceCode = (v: unknown): v is string =>
  typeof v === "string" && /^([a-z]{2}|auto)$/.test(v);
export const isTargetCode = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z]{2}$/.test(v);
const isStyle = (v: unknown): v is StyleOverride => typeof v === "string" && STYLES.includes(v);

export function parsePrefs(v: unknown): Prefs | null {
  const p = v as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return null;
  if (!isSourceCode(p.source) || !isTargetCode(p.target) || !isStyle(p.style)) return null;
  if (p.source === p.target) return null;
  const out: Prefs = { source: p.source, target: p.target, style: p.style };
  if (typeof p.dialect === "string" && DIALECTS.includes(p.dialect))
    out.dialect = p.dialect as Dialect;
  return out;
}

export function isResult(v: unknown): v is TranslationResult {
  const r = v as TranslationResult | null;
  return (
    !!r &&
    typeof r === "object" &&
    typeof r.translation === "string" &&
    typeof r.sourceLanguage === "string" &&
    typeof r.targetLanguage === "string" &&
    Array.isArray(r.alternativeTranslations) &&
    r.alternativeTranslations.every((a) => typeof a === "string")
  );
}

export function parseSession(v: unknown): Session | null {
  const s = v as Record<string, unknown> | null;
  if (!s || typeof s !== "object") return null;
  if (typeof s.text !== "string" || !s.text.trim()) return null;
  if (!isSourceCode(s.source) || !isTargetCode(s.target) || !isStyle(s.style)) return null;
  return {
    text: s.text.slice(0, MAX_TEXT),
    // A damaged cached result is discarded; the text is simply translated again.
    result: isResult(s.result) ? s.result : null,
    source: s.source,
    target: s.target,
    style: s.style,
  };
}

function get(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
/** Returns false when the device refused the write (full or blocked storage). */
function set(key: string, value: unknown): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const persist = {
  prefs: () => parsePrefs(get(PREFS)),
  savePrefs: (p: Prefs) => set(PREFS, p),
  session: () => parseSession(get(SESSION)),
  saveSession: (s: Session | null) => set(SESSION, s && s.text.trim() ? s : null),
  /** Remove everything Lingua keeps on this device. */
  clearAll() {
    try {
      for (const k of Object.keys(window.localStorage))
        if (k.startsWith("lingua.")) window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
  /**
   * Ask the browser not to evict our storage under pressure. Best effort: the
   * browser may decline, and the user can always clear site data themselves.
   */
  async requestDurable(): Promise<boolean> {
    try {
      if (!navigator.storage?.persist) return false;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  },
};
