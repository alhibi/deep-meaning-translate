/**
 * Pure scheduling intelligence for realtime translation.
 * Decides *whether* and *when* a translation request is worthwhile.
 * No side effects, no network — easy to reason about and test.
 */

/** Harmless formatting noise out, meaningful structure (paragraphs, lists) kept. */
export function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SENTENCE_END = /[.!?؟…。](?:["'»”’)\]]*)$/u;
const SOFT_BOUNDARY = /[,;:،؛–—]\s*$/u;

export type Maturity = "fragment" | "phrase" | "sentence" | "paragraph" | "document";

export function maturity(text: string): Maturity {
  if (/\n\s*\n/.test(text)) return "document";
  const complete = SENTENCE_END.test(text);
  if (complete) return text.length > 280 ? "paragraph" : "sentence";
  return wordCount(text) >= 3 ? "phrase" : "fragment";
}

/** Text the user is still in the middle of writing. */
export function isProvisional(normalized: string, raw: string, deliberate: boolean): boolean {
  if (deliberate) return false;
  if (SENTENCE_END.test(normalized)) return false;
  if (/\n$/.test(raw)) return false;
  return true;
}

/** Minimum meaningful input: something with letters or digits, beyond a single stray character. */
export function worthTranslating(text: string): boolean {
  if (text.length < 2) return /[\u0600-\u06FF\u4E00-\u9FFF]/.test(text);
  return /[\p{L}\p{N}]/u.test(text);
}

function wordCount(t: string) {
  return t ? t.split(/\s+/).length : 0;
}

function slowConnection(): boolean {
  const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } })
    .connection;
  return !!c && (c.saveData === true || /(^|-)2g|3g/.test(c.effectiveType ?? ""));
}

/**
 * Adaptive delay: quick at semantic boundaries, patient mid-word and for fast typists,
 * a little more patient for long text and slow connections.
 */
export function delayFor(opts: {
  normalized: string;
  raw: string;
  intervals: number[];
  hasResult: boolean;
}): number {
  const { normalized, raw, intervals, hasResult } = opts;
  const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 400;

  let d: number;
  if (SENTENCE_END.test(normalized) || /\n$/.test(raw)) d = 200;
  else if (SOFT_BOUNDARY.test(raw)) d = 380;
  else if (/\s$/.test(raw)) d = 460;
  else d = 720; // mid-word: most likely still typing

  if (avg < 160) d += 180; // fast typist — wait for the real pause
  if (!hasResult && wordCount(normalized) < 2 && !SENTENCE_END.test(normalized)) d = Math.max(d, 900);
  if (normalized.length > 600) d += 180;
  if (typeof navigator !== "undefined" && slowConnection()) d += 250;
  return d;
}
