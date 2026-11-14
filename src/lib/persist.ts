import type { Brain, Dialect, StyleOverride, TranslationResult } from "./translation/types";
import { isResult } from "./translation/result";
import { matchesTarget } from "./translation/view";

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

const STYLES: readonly string[] = ["natural", "formal", "casual"];
const DIALECTS: readonly string[] = ["auto", "msa", "levant", "egypt", "gulf", "iraq", "maghreb"];
// Mirrors the server input schema so a restored pair can never be rejected by it.
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

/**
 * In-memory memory of this tab's own last values.
 *
 * Route components unmount on navigation; the translator must not remount empty.
 * This copy lives as long as the tab, is never read during server rendering, and is
 * only an initial value: storage stays the single source of truth across reloads.
 */
let rememberedPrefs: Prefs | null = null;
let rememberedSession: Session | null = null;

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
  savePrefs: (p: Prefs) => {
    rememberedPrefs = p;
    return set(PREFS, p);
  },
  session: () => parseSession(get(SESSION)),
  saveSession: (s: Session | null) => {
    const valid = s && s.text.trim() ? s : null;
    rememberedSession = valid;
    return set(SESSION, valid);
  },
  /**
   * The last values this tab held, for a route that is being mounted again.
   * Empty on server rendering and on the first visit; never a substitute for storage.
   */
  remembered: (): { prefs: Prefs | null; session: Session | null } => ({
    prefs: rememberedPrefs,
    session: rememberedSession,
  }),
  /** Remove everything Lingua keeps on this device. */
  clearAll() {
    rememberedPrefs = null;
    rememberedSession = null;
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
