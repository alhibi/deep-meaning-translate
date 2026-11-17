import { z } from "zod";

/**
 * Sentence Shadow: what a correct translation may have lost (warmth, intensity…).
 *
 * The shadow's contract is negative-first: an empty list is the common, correct answer,
 * and every reported finding must point at a real span in BOTH texts. The model only
 * quotes fragments; all offsets are recomputed here, and anything that cannot be anchored
 * confidently is dropped — a shadow never points at wrong words, and never invents a loss
 * to look active.
 *
 * Two precision decisions live here rather than in the prompt alone:
 * - a finding must say whether meaning was genuinely lost or a tone merely weakened;
 *   stylistic and normal cross-language differences are accepted from the model but are
 *   never rendered as losses (see `kind` below);
 * - restores are validated against the translation (facts, script, size, and whether the
 *   change actually touches the lost words), so a suggested alternative always has a
 *   defensible gain over the current sentence.
 */

export const SHADOW_CATEGORIES = [
  "warmth",
  "intensity",
  "respect",
  "humor",
  "ambiguity",
  "culture",
  "rhythm",
  "implied",
] as const;
export type ShadowCategory = (typeof SHADOW_CATEGORIES)[number];

/**
 * What kind of difference a finding is. Only `loss` and `weakened` describe something
 * that did not survive; the raw model vocabulary also has the judgements that must NOT be
 * shown as losses, and those are filtered before a `Loss` exists.
 */
export const SHADOW_KINDS = ["loss", "weakened"] as const;
export type ShadowKind = (typeof SHADOW_KINDS)[number];

export interface Span {
  start: number;
  end: number;
}
export interface Restore {
  text: string;
  note: string;
  /** Changed region in `text` (relative to the current translation). */
  changed: Span;
}
export interface Loss {
  id: string;
  /** Genuinely lost meaning, or a tone/intensity that came out weaker. */
  kind: ShadowKind;
  category: ShadowCategory;
  severity: 1 | 2 | 3;
  confidence: number;
  source: Span;
  target: Span;
  sourceQuote: string;
  targetQuote: string;
  explanation: string;
  restores: Restore[];
}
export interface ShadowResult {
  losses: Loss[];
}

/** Output cap: a long text must not produce a longer list, only better-anchored ones. */
export const MAX_LOSSES = 4;
/** A genuine loss must be at least this confident to be shown. */
export const MIN_CONFIDENCE = 0.6;
/** Severity-1 findings are the noisiest, so they need stronger evidence. */
export const MIN_CONFIDENCE_SLIGHT = 0.75;
/** A weakened tone is a subtle judgement: show it only when the model is sure. */
export const MIN_CONFIDENCE_WEAKENED = 0.7;
/** Weakening is by definition smaller than a clear loss, whatever severity was claimed. */
export const MAX_WEAKENED_SEVERITY = 2;
/** A quote longer than this cannot be a short anchor, and would only hide the words. */
export const MAX_QUOTE = 400;
/** Whole-text input bound (matches the draft limit); windowing keeps every call bounded. */
export const MAX_SOURCE = 5000;
/** Source characters one analysis call aims at. */
export const SHADOW_WINDOW_TARGET = 600;
/** Bounded call count for one shadow: a longer text gets larger windows, not more calls. */
export const SHADOW_MAX_WINDOWS = 4;
/** Neighbouring source text handed to the model only so it can judge tone in context. */
export const SHADOW_CONTEXT_CHARS = 240;
/** Per-call provider budget: analysis runs thinking at max effort, so it is not fast. */
export const SHADOW_TIMEOUT_MS = 45_000;
/** Translation side is bounded too: an Arabic answer to a 5,000-char German source fits. */
export const MAX_TRANSLATION = 15_000;

/* ------------------------------------------------------------------ anchoring */

/**
 * Arabic diacritics and Quranic marks are optional in writing: a model quotes the bare
 * letters while the source carries harakat, or the other way round. They must not decide
 * whether a finding can be anchored.
 */
const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08E1\u08E3-\u08FF]/u;
const TATWEEL = "\u0640";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";

interface Folded {
  /** Case-folded, whitespace-collapsed text with optional Arabic marks removed. */
  text: string;
  /** Original offset of each folded code unit. */
  starts: number[];
  /** Original offset just after each folded code unit. */
  ends: number[];
}

/**
 * Folds text for tolerant matching while keeping an exact map back to the original.
 *
 * Every folded code unit remembers where it came from, so a match can be reported on the
 * real source string (including the diacritics it skipped). Case folding is per code unit
 * on purpose: a locale-aware lower-case of a whole string can change its length, and then
 * every offset after it would be wrong.
 */
function fold(text: string): Folded {
  const out: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpace = false;
  const push = (value: string, start: number, end: number) => {
    out.push(value);
    starts.push(start);
    ends.push(end);
  };
  // Unicode first, per grapheme-ish cluster: decomposed German ("u" + combining
  // diaeresis) and composed "ü" must be the same letter, and the cluster's original
  // extent is what a mapped span should cover.
  const cluster = /\P{M}\p{M}*/gu;
  const process = (clusterText: string, start: number, end: number) => {
    const normalized = clusterText.normalize("NFC");
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i]!;
      if (/\s/u.test(ch)) {
        pendingSpace = true;
        continue;
      }
      if (pendingSpace && out.length > 0) push(" ", start, end);
      pendingSpace = false;
      if (ARABIC_MARKS.test(ch) || ch === TATWEEL) continue;
      const digit = ARABIC_DIGITS.indexOf(ch);
      if (digit !== -1) {
        push(digit < 10 ? String(digit) : String(digit - 10), start, end);
        continue;
      }
      const lower = ch.toLowerCase();
      // A lowercase that expands ("İ" → "i̇") would desynchronise the map, so such a
      // code unit is matched case-sensitively instead of corrupting every later offset.
      push(lower.length === 1 ? lower : ch, start, end);
    }
  };
  let pos = 0;
  while (pos < text.length) {
    cluster.lastIndex = pos;
    const match = cluster.exec(text);
    if (!match) {
      process(text.slice(pos), pos, text.length);
      break;
    }
    if (match.index > pos) process(text.slice(pos, match.index), pos, match.index);
    process(match[0], match.index, match.index + match[0].length);
    pos = match.index + match[0].length;
  }
  return { text: out.join(""), starts, ends };
}

function spanAt(folded: Folded, start: number, length: number): Span {
  return { start: folded.starts[start]!, end: folded.ends[start + length - 1]! };
}

function collectOccurrences(folded: Folded, needle: string, out: Span[], limit = 16): void {
  if (!needle) return;
  let from = 0;
  while (out.length < limit) {
    const index = folded.text.indexOf(needle, from);
    if (index === -1) break;
    out.push(spanAt(folded, index, needle.length));
    from = index + Math.max(1, needle.length);
  }
}

/** Removes punctuation at the edges: a quote may omit a comma the text has, or add one. */
function stripEdgePunctuation(value: string): string {
  return value.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
}

/**
 * Last-resort match: the quoted words must appear in order, separated only by
 * punctuation/whitespace. This covers "Schade, dass" ↔ "Schade dass" and Arabic
 * punctuation differences without ever skipping a word.
 */
function tokenPattern(value: string): RegExp | null {
  const tokens = value.match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length < 2) return null;
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("[^\\p{L}\\p{N}]{0,6}"), "iu");
}

/**
 * Every place `quote` can confidently refer to in `text`, in reading order.
 *
 * Tolerant of case, whitespace (including newlines), Arabic diacritics/tatweel, Arabic
 * versus Western digits, composed versus decomposed German letters (NFC), and edge
 * punctuation. Never tolerant of different words: if the letters do not match, there is
 * no candidate and the finding is dropped.
 */
export function anchorCandidates(text: string, quote: string): Span[] {
  const q = quote.trim();
  if (!q || q.length > MAX_QUOTE || !text) return [];
  const folded = fold(text);
  const foldedQuote = fold(q);
  if (!folded.text || !foldedQuote.text) return [];
  const out: Span[] = [];
  collectOccurrences(folded, foldedQuote.text, out);
  if (!out.length && /^[^\p{L}\p{N}]|[^\p{L}\p{N}]$/u.test(foldedQuote.text)) {
    const core = stripEdgePunctuation(foldedQuote.text);
    if (core && core !== foldedQuote.text) collectOccurrences(folded, core, out);
  }
  if (!out.length) {
    const pattern = tokenPattern(foldedQuote.text);
    if (pattern) {
      const match = pattern.exec(folded.text);
      if (match) out.push(spanAt(folded, match.index, match[0].length));
    }
  }
  out.sort((a, b) => a.start - b.start);
  // Overlapping candidates cannot both be real occurrences; the longer one wins.
  return out.filter((span, index) => {
    const prev = out[index - 1];
    return !prev || span.start >= prev.end;
  });
}

/** First occurrence: kept for callers that have no context to disambiguate with. */
export function anchor(text: string, quote: string): Span | null {
  return anchorCandidates(text, quote)[0] ?? null;
}

/**
 * The occurrence closest to a known position. Used when one fix is applied and the other
 * findings must keep pointing at the same words in the edited translation: with a repeated
 * phrase, "first occurrence" silently moved a finding to the wrong sentence.
 */
export function anchorNearest(text: string, quote: string, near: number): Span | null {
  const candidates = anchorCandidates(text, quote);
  if (!candidates.length) return null;
  let best = candidates[0]!;
  let bestDistance = Math.abs(best.start - near);
  for (const candidate of candidates.slice(1)) {
    const distance = Math.abs(candidate.start - near);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/* --------------------------------------------------------------- span helpers */

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

function clampSpan(span: Span, length: number): Span {
  return {
    start: Math.max(0, Math.min(length, span.start)),
    end: Math.max(0, Math.min(length, span.end)),
  };
}

/** Smallest region of `next` that differs from `prev` (common prefix/suffix trimmed). */
export function changedSpan(prev: string, next: string): Span {
  let a = 0;
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  let b = 0;
  while (
    b < prev.length - a &&
    b < next.length - a &&
    prev[prev.length - 1 - b] === next[next.length - 1 - b]
  )
    b++;
  // Widen to whole words so the highlight never cuts a word in half.
  let start = a;
  while (start > 0 && !/\s/u.test(next[start - 1] ?? "")) start--;
  let end = next.length - b;
  while (end < next.length && !/\s/u.test(next[end] ?? "")) end++;
  return { start, end: Math.max(start, end) };
}

export interface WordDiff {
  /** Words that the alternative removes from the current translation. */
  removed: Span | null;
  /** Words that it adds in their place. */
  added: Span | null;
}

/**
 * Word-level preview of what an alternative changes. The detail sheet shows it before
 * Apply, so the visible translation is never rewritten by a diff the person could not see.
 */
export function wordDiff(prev: string, next: string): WordDiff {
  const tokens = (value: string) => {
    const out: { text: string; start: number; end: number }[] = [];
    const re = /\S+/gu;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value))) {
      out.push({ text: match[0], start: match.index, end: match.index + match[0].length });
    }
    return out;
  };
  const a = tokens(prev);
  const b = tokens(next);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix]!.text === b[prefix]!.text) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix]!.text === b[b.length - 1 - suffix]!.text
  )
    suffix++;
  const removed =
    prefix < a.length - suffix
      ? { start: a[prefix]!.start, end: a[a.length - 1 - suffix]!.end }
      : null;
  const added =
    prefix < b.length - suffix
      ? { start: b[prefix]!.start, end: b[b.length - 1 - suffix]!.end }
      : null;
  return { removed, added };
}

/* ------------------------------------------------------------------- sentences */

/**
 * Sentence spans of `text`, with absolute offsets. Used only to cut long sources into
 * whole-sentence windows: a window must never split an idiom or leave a dangling clause
 * that the model would then judge without its context.
 */
export function sentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  const push = (from: number, to: number) => {
    let start = from;
    let end = to;
    while (start < end && /\s/u.test(text[start]!)) start++;
    while (end > start && /\s/u.test(text[end - 1]!)) end--;
    if (end > start) spans.push({ start, end });
  };
  const terminators = new Set([".", "!", "?", "؟", "…"]);
  const closers = new Set(['"', "'", "”", "’", "»", ")", "]", "}", "\u00BB"]);
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (terminators.has(ch)) {
      i += 1;
      while (i < text.length && (terminators.has(text[i]!) || closers.has(text[i]!))) i += 1;
      push(start, i);
      start = i;
      continue;
    }
    if (ch === "\n") {
      push(start, i);
      i += 1;
      while (i < text.length && /\s/u.test(text[i]!)) i += 1;
      start = i;
      continue;
    }
    i += 1;
  }
  push(start, text.length);
  return spans;
}

/* -------------------------------------------------------------------- windows */

export interface ShadowWindow {
  index: number;
  total: number;
  /** Absolute offsets in the whole source. */
  start: number;
  end: number;
  /** Length of the whole source, so pairing can compare absolute positions. */
  sourceLength: number;
  text: string;
  /** Neighbouring text for tone context only; the model must not report findings for it. */
  contextBefore: string;
  contextAfter: string;
}

function trimBounds(text: string): Span {
  let start = 0;
  let end = text.length;
  while (start < end && /\s/u.test(text[start]!)) start++;
  while (end > start && /\s/u.test(text[end - 1]!)) end--;
  return { start, end };
}

function contextSlice(source: string, from: number, to: number): string {
  if (to <= from) return "";
  let start = Math.max(0, from);
  const raw = source.slice(start, to);
  // Keep whole words at the context edges: a half word would only distract the model.
  const firstSpace = raw.indexOf(" ");
  if (start > 0 && firstSpace > 0) start += firstSpace + 1;
  return source.slice(start, to).trim();
}

/**
 * Sentence-aligned source windows with overlap and absolute offsets.
 *
 * The number of calls is bounded (at most `SHADOW_MAX_WINDOWS`): a longer text gets
 * larger windows instead of more model calls, so a paste cannot multiply cost without
 * limit. Adjacent windows overlap by the previous window's last sentence, so a nuance on
 * a boundary is still judged with its neighbour present; the merge step removes the
 * duplicate. Ordered windows let the model read each part as part of a longer text rather
 * than as an isolated fragment.
 */
export function planShadowWindows(source: string): ShadowWindow[] {
  const bounds = trimBounds(source);
  if (bounds.end <= bounds.start || bounds.end - bounds.start > MAX_SOURCE) return [];
  const length = bounds.end - bounds.start;
  const sentences = sentenceSpans(source.slice(bounds.start, bounds.end)).map((span) => ({
    start: span.start + bounds.start,
    end: span.end + bounds.start,
  }));
  if (!sentences.length) {
    return [
      {
        index: 0,
        total: 1,
        start: bounds.start,
        end: bounds.end,
        sourceLength: source.length,
        text: source.slice(bounds.start, bounds.end),
        contextBefore: "",
        contextAfter: "",
      },
    ];
  }
  const wanted = Math.min(
    SHADOW_MAX_WINDOWS,
    Math.max(1, Math.ceil(length / SHADOW_WINDOW_TARGET)),
    sentences.length,
  );
  const groups: { from: number; to: number }[] = [];
  if (wanted >= sentences.length) {
    sentences.forEach((_sentence, index) => groups.push({ from: index, to: index + 1 }));
  } else {
    const splits: number[] = [];
    for (let group = 1; group < wanted; group++) {
      const target = bounds.start + (length * group) / wanted;
      const min = (splits[splits.length - 1] ?? 0) + 1;
      const max = sentences.length - (wanted - group);
      let best = min;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = min; index <= max; index++) {
        const distance = Math.abs(sentences[index]!.start - target);
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      }
      splits.push(best);
    }
    let from = 0;
    for (const split of splits) {
      groups.push({ from, to: split });
      from = split;
    }
    groups.push({ from, to: sentences.length });
  }
  return groups.map((group, index) => {
    const ownStart = sentences[group.from]!.start;
    // The overlap is the previous group's final sentence, so every boundary is seen in
    // both the window that ends there and the one that begins there.
    const start = index === 0 ? ownStart : (sentences[group.from - 1]?.start ?? ownStart);
    const end = sentences[group.to - 1]!.end;
    return {
      index,
      total: groups.length,
      start,
      end,
      sourceLength: source.length,
      text: source.slice(start, end),
      contextBefore: contextSlice(
        source,
        Math.max(bounds.start, start - SHADOW_CONTEXT_CHARS),
        start,
      ),
      contextAfter: contextSlice(source, end, Math.min(bounds.end, end + SHADOW_CONTEXT_CHARS)),
    };
  });
}

/* --------------------------------------------------------------------- parsing */

const RAW_KINDS = ["loss", "weakened", "style", "normal", "unclear"] as const;

const RawLoss = z.object({
  kind: z.enum(RAW_KINDS).optional().default("loss"),
  category: z.enum(SHADOW_CATEGORIES),
  severity: z.coerce.number(),
  confidence: z.coerce.number(),
  source_quote: z.string(),
  target_quote: z.string(),
  source_occurrence: z.coerce.number().int().positive().optional(),
  target_occurrence: z.coerce.number().int().positive().optional(),
  explanation: z.string(),
  restores: z
    .array(z.object({ text: z.string(), note: z.string().optional().default("") }))
    .optional()
    .default([]),
});

interface Candidate {
  kind: ShadowKind;
  category: ShadowCategory;
  severity: 1 | 2 | 3;
  confidence: number;
  sourceCands: Span[];
  targetCands: Span[];
  sourceOccurrence: number | undefined;
  targetOccurrence: number | undefined;
  explanation: string;
  restores: { text: string; note: string }[];
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function severityOf(value: number): 1 | 2 | 3 {
  return Math.min(3, Math.max(1, Math.round(value))) as 1 | 2 | 3;
}

/** Reads a model reply into candidates, keeping only the judgements that are real losses. */
function readCandidates(
  raw: unknown,
  source: string,
  translation: string,
): { candidates: Candidate[]; schemaValid: number; listLength: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { losses?: unknown }).losses;
  if (!Array.isArray(list)) return null;
  const candidates: Candidate[] = [];
  let schemaValid = 0;
  // A generous but finite read: a runaway reply must not cost quadratic anchoring work.
  for (const item of list.slice(0, 12)) {
    const parsed = RawLoss.safeParse(item);
    if (!parsed.success) continue;
    schemaValid += 1;
    const value = parsed.data;
    // The model is allowed to think in five judgements, but only two are losses. A
    // stylistic or normal cross-language difference, or an "unclear" guess, is a correct
    // "nothing was lost" answer — never a finding to show over the translation.
    if (value.kind !== "loss" && value.kind !== "weakened") continue;
    const confidence = clampUnit(value.confidence);
    let severity = severityOf(value.severity);
    if (value.kind === "weakened") {
      if (confidence < MIN_CONFIDENCE_WEAKENED) continue;
      severity = Math.min(MAX_WEAKENED_SEVERITY, severity) as 1 | 2 | 3;
    } else {
      if (confidence < MIN_CONFIDENCE) continue;
      if (severity === 1 && confidence < MIN_CONFIDENCE_SLIGHT) continue;
    }
    const explanation = value.explanation.trim().slice(0, 280);
    if (!explanation) continue;
    const sourceQuote = value.source_quote.trim();
    const targetQuote = value.target_quote.trim();
    if (!sourceQuote || !targetQuote) continue;
    const sourceCands = anchorCandidates(source, sourceQuote).slice(0, 8);
    const targetCands = anchorCandidates(translation, targetQuote).slice(0, 8);
    if (!sourceCands.length || !targetCands.length) continue;
    candidates.push({
      kind: value.kind,
      category: value.category,
      severity,
      confidence,
      sourceCands,
      targetCands,
      sourceOccurrence: value.source_occurrence,
      targetOccurrence: value.target_occurrence,
      explanation,
      restores: value.restores,
    });
  }
  return { candidates, schemaValid, listLength: list.length };
}

/** Higher is stronger: a clear loss outranks a merely weakened tone at equal numbers. */
function scoreOf(candidate: { kind: ShadowKind; severity: number; confidence: number }): number {
  const kindFactor = candidate.kind === "weakened" ? 0.85 : 1;
  return candidate.severity * candidate.confidence * kindFactor;
}

interface Anchored extends Candidate {
  source: Span;
  target: Span;
  score: number;
}

/**
 * Chooses which occurrence of a repeated quote each finding means.
 *
 * A quote like "gut" or "الكلب" can appear several times; taking the first occurrence
 * pointed findings at the wrong sentence. Two context signals disambiguate:
 * - an occurrence hint from the model (the prompt asks for one when text repeats);
 * - relative position: source and translation preserve order, so a fragment at ~60% of
 *   the source is expected near ~60% of the translation. Pairing on that distance maps
 *   each source occurrence to its own target occurrence.
 * A windowed source passes its offset and whole-text length, so positions are compared on
 * the full text, never on a window that happens to start in the middle.
 * The result is then forced monotonic, so two findings can never cross.
 */
function chooseAnchors(
  candidates: Candidate[],
  sourceLength: number,
  translationLength: number,
  sourceOffset = 0,
): Anchored[] {
  const sourceScale = Math.max(1, sourceLength);
  const translationScale = Math.max(1, translationLength);
  const paired = candidates.map((candidate) => {
    let best: { source: Span; target: Span; cost: number } | null = null;
    candidate.sourceCands.forEach((source, sourceIndex) => {
      candidate.targetCands.forEach((target, targetIndex) => {
        let cost = Math.abs(
          (source.start + sourceOffset) / sourceScale - target.start / translationScale,
        );
        if (candidate.sourceOccurrence !== undefined)
          cost += sourceIndex + 1 === candidate.sourceOccurrence ? 0 : 0.6;
        if (candidate.targetOccurrence !== undefined)
          cost += targetIndex + 1 === candidate.targetOccurrence ? 0 : 0.6;
        // Earlier occurrences win ties, deterministically.
        cost += sourceIndex * 0.001 + targetIndex * 0.001;
        if (!best || cost < best.cost) best = { source, target, cost };
      });
    });
    const chosen = best as { source: Span; target: Span; cost: number } | null;
    return {
      ...candidate,
      source: chosen!.source,
      target: chosen!.target,
      score: scoreOf(candidate),
    };
  });
  // Source order is the one order the model and the person both see; a crossing target
  // means at least one of the two anchors is wrong, so the weaker one is dropped.
  const ordered = [...paired].sort((a, b) => a.source.start - b.source.start);
  const kept: Anchored[] = [];
  for (const candidate of ordered) {
    let discarded = false;
    while (kept.length) {
      const last = kept[kept.length - 1]!;
      if (candidate.target.start >= last.target.start) break;
      if (candidate.score > last.score) kept.pop();
      else {
        discarded = true;
        break;
      }
    }
    if (!discarded) kept.push(candidate);
  }
  return kept;
}

const DIGIT_FOLD: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};
const FACT_NUMBER = /[0-9٠-٩۰-۹]+(?:[.,][0-9٠-٩۰-۹]+)*/gu;
const FACT_URL = /https?:\/\/[^\s)»]+/gu;
const FACT_EMOJI = /\p{Extended_Pictographic}/gu;
const ARABIC_LETTER = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

function foldDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => DIGIT_FOLD[digit] ?? digit);
}

function multiset(values: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return map;
}

function missingFacts(from: string[], into: string[]): number {
  const available = multiset(into);
  let missing = 0;
  for (const [value, count] of multiset(from)) {
    if ((available.get(value) ?? 0) < count) missing += 1;
  }
  return missing;
}

/** A restore may rephrase, but it may never drop a fact the current translation keeps. */
function keepsFacts(translation: string, restore: string): boolean {
  const numbers = (value: string) => (value.match(FACT_NUMBER) ?? []).map(foldDigits);
  return (
    missingFacts(translation.match(FACT_URL) ?? [], restore.match(FACT_URL) ?? []) === 0 &&
    missingFacts(numbers(translation), numbers(restore)) === 0 &&
    missingFacts(translation.match(FACT_EMOJI) ?? [], restore.match(FACT_EMOJI) ?? []) === 0
  );
}

/**
 * The dominant writing system of a translation. An alternative in another script is not
 * an alternative in the requested language, whatever the model called it.
 */
function dominantScript(text: string): "arabic" | "latin" | null {
  const arabic = (text.match(ARABIC_LETTER) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  if (!arabic && !latin) return null;
  return arabic >= latin ? "arabic" : "latin";
}

function sameScript(translation: string, restore: string): boolean {
  const dominant = dominantScript(translation);
  if (!dominant) return true;
  return dominant === "arabic" ? ARABIC_LETTER.test(restore) : LATIN_LETTER.test(restore);
}

/**
 * Validates alternative translations for one finding.
 *
 * "Ways to restore" is a promise: each alternative must (a) still say what the current
 * translation says factually, (b) be in the target language's script, (c) not be a full
 * rewrite of the sentence, and (d) actually change the words named by the finding. An
 * alternative that fails any of these is not a suggestion with a defensible gain, so it is
 * not shown at all.
 */
function validateRestores(
  translation: string,
  target: Span,
  raw: { text: string; note: string }[],
): Restore[] {
  const kept: { restore: Restore; changedLength: number }[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 6)) {
    const text = item.text.trim();
    if (!text) continue;
    const key = text.toLocaleLowerCase().replace(/\s+/gu, " ");
    if (seen.has(key)) continue;
    if (text.length > translation.length * 2 + 120) continue;
    if (!keepsFacts(translation, text)) continue;
    if (!sameScript(translation, text)) continue;
    const changed = clampSpan(changedSpan(translation, text), text.length);
    const changedLength = changed.end - changed.start;
    if (changedLength <= 0) continue;
    // A whole-sentence rewrite is not a restore; it is a second translation, and the
    // person asked to keep this one.
    if (changedLength >= translation.length) continue;
    if (changedLength > Math.max(24, Math.floor(translation.length * 0.7))) continue;
    // The gain must be where the loss is; an unrelated edit elsewhere does not restore it.
    if (!overlaps(changed, target)) continue;
    seen.add(key);
    kept.push({
      restore: { text, note: item.note.trim().slice(0, 200), changed },
      changedLength,
    });
  }
  kept.sort((a, b) => a.changedLength - b.changedLength);
  return kept.slice(0, 3).map((item) => item.restore);
}

function buildLosses(anchors: Anchored[], translation: string): Loss[] {
  const ranked = [...anchors].sort((a, b) => b.score - a.score || a.target.start - b.target.start);
  const kept: Anchored[] = [];
  for (const candidate of ranked) {
    if (kept.some((existing) => overlaps(existing.target, candidate.target))) continue;
    kept.push(candidate);
    if (kept.length === MAX_LOSSES) break;
  }
  kept.sort((a, b) => a.target.start - b.target.start);
  const seenIds = new Set<string>();
  return kept.map((candidate) => {
    const id = `${candidate.category}-${candidate.source.start}-${candidate.target.start}`;
    const unique = seenIds.has(id) ? `${id}-${seenIds.size}` : id;
    seenIds.add(unique);
    return {
      id: unique,
      kind: candidate.kind,
      category: candidate.category,
      severity: candidate.severity,
      confidence: candidate.confidence,
      source: candidate.source,
      target: candidate.target,
      sourceQuote: "",
      targetQuote: "",
      explanation: candidate.explanation,
      restores: validateRestores(translation, candidate.target, candidate.restores),
    };
  });
}

/**
 * Validates and re-anchors a raw model reply for one source/translation pair.
 *
 * Returns `{losses: []}` for a valid, honest "nothing was lost" and `null` when the
 * reply itself is unusable (not JSON-shaped, or every finding is structurally invalid) —
 * the caller must never turn a broken reply into a claim that nothing was lost.
 */
export function parseShadow(
  raw: unknown,
  source: string,
  translation: string,
  context: { sourceOffset?: number | undefined; sourceLength?: number | undefined } = {},
): ShadowResult | null {
  const read = readCandidates(raw, source, translation);
  if (!read) return null;
  // A structurally valid reply that mentions only stylistic/normal/unclear differences is
  // a valid "nothing lost"; a reply whose every item is malformed is a broken answer.
  if (read.schemaValid === 0 && read.listLength > 0) return null;
  const anchors = chooseAnchors(
    read.candidates,
    context.sourceLength ?? source.length,
    translation.length,
    context.sourceOffset ?? 0,
  );
  const losses = buildLosses(anchors, translation).map((loss) => ({
    ...loss,
    sourceQuote: source.slice(loss.source.start, loss.source.end),
    targetQuote: translation.slice(loss.target.start, loss.target.end),
  }));
  return { losses };
}

/** Extracts the JSON object from a model reply; model prose around it is tolerated. */
function replyObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Extracts JSON from a model reply and validates it for a single (unwindowed) pair. */
export function readShadowReply(
  raw: string,
  source: string,
  translation: string,
): ShadowResult | null {
  const parsed = replyObject(raw);
  if (!parsed) return null;
  return parseShadow(parsed, source, translation);
}

/**
 * Validates one window's reply. Spans are anchored inside the window and then moved to
 * absolute source offsets, so every finding keeps pointing at the same characters the
 * person sees in the full text.
 */
export function readWindowShadowReply(
  raw: string,
  window: ShadowWindow,
  translation: string,
): Loss[] | null {
  const parsed = replyObject(raw);
  if (!parsed) return null;
  const result = parseShadow(parsed, window.text, translation, {
    sourceOffset: window.start,
    sourceLength: window.sourceLength,
  });
  if (!result) return null;
  return result.losses.map((loss) => ({
    ...loss,
    source: { start: loss.source.start + window.start, end: loss.source.end + window.start },
    sourceQuote: window.text.slice(loss.source.start, loss.source.end),
  }));
}

/**
 * Merges per-window findings: overlapping findings (the same loss seen by two overlapping
 * windows, or two categories on the same words) keep only the strongest, then the global
 * cap applies. Dedupe is by target span first because that is what the person can see; a
 * second window pointing somewhere else is not the same finding even if the source
 * overlapped.
 */
export function mergeWindowLosses(groups: Loss[][]): ShadowResult {
  const all = groups.flat();
  const ranked = [...all].sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) || a.target.start - b.target.start || a.source.start - b.source.start,
  );
  const kept: Loss[] = [];
  for (const loss of ranked) {
    if (kept.some((existing) => overlaps(existing.target, loss.target))) continue;
    kept.push(loss);
    if (kept.length === MAX_LOSSES) break;
  }
  kept.sort((a, b) => a.target.start - b.target.start);
  const seen = new Set<string>();
  const unique = kept.map((loss) => {
    const id = `${loss.category}-${loss.source.start}-${loss.target.start}`;
    const finalId = seen.has(id) ? `${id}-${seen.size}` : id;
    seen.add(finalId);
    return { ...loss, id: finalId };
  });
  return { losses: unique };
}

/* ------------------------------------------------------------------- carry/segments */

/** Keeps losses still present in an edited translation (after applying one fix). */
export function carryLosses(losses: Loss[], translation: string, without: string): Loss[] {
  const kept: Loss[] = [];
  for (const loss of losses) {
    if (loss.id === without) continue;
    // Nearest to the old position: a repeated phrase must not move the finding to an
    // earlier sentence just because the restore changed the opening words.
    const target = anchorNearest(translation, loss.targetQuote, loss.target.start);
    if (!target || kept.some((existing) => overlaps(existing.target, target))) continue;
    kept.push({ ...loss, target, restores: [] });
  }
  return kept;
}

export interface Segment {
  text: string;
  loss?: Loss;
}
/** Splits the translation into clear text and shadowed parts. */
export function segments(text: string, losses: Loss[]): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  for (const loss of [...losses].sort((a, b) => a.target.start - b.target.start)) {
    if (loss.target.start < pos || loss.target.end > text.length) continue;
    if (loss.target.start > pos) out.push({ text: text.slice(pos, loss.target.start) });
    out.push({ text: text.slice(loss.target.start, loss.target.end), loss });
    pos = loss.target.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/* --------------------------------------------------------------------- prompting */

/**
 * The critic's brief. Deliberately written to make silence the expected answer: most good
 * translations lose little, and a stylistic or normal cross-language difference is not a
 * loss. The five-way judgement is internal; only `loss` and `weakened` are emitted, which
 * keeps the app from showing "differences" as small accusations.
 */
export const SHADOW_SYSTEM = `You are a careful translation critic. Given a SOURCE and its TRANSLATION, decide whether any meaning was genuinely lost.

Judge first, then report. Every difference is one of:
- loss: a piece of the source's meaning did not survive.
- weakened: the meaning survived but its tone, warmth or intensity came out softer.
- style: only the wording, rhythm or sentence shape differs; the meaning is intact.
- normal: a difference every good cross-language translation makes (grammar, gender, word order, punctuation conventions, idiom rendered naturally elsewhere).
- unclear: you cannot tell from the text alone. Never guess.

Report ONLY loss and weakened findings. Never report style, normal or unclear ones; those are not losses. Most good translations lose little: an empty list is the correct and common answer. Never invent a finding to look useful.

Categories (exact keys):
- warmth: affection, tenderness, closeness ("يا روحي" → "my dear" keeps it; a flat "Hi" loses it)
- intensity: emphasis, exaggeration, emotional force ("يا حسرتاه" → "Schade" loses grief)
- respect: politeness, deference, formality, Sie/du, honorifics ("حضرتك" → "du" loses respect)
- humor: irony, sarcasm, playfulness ("شاطر!" said ironically → "Gut gemacht" loses the irony)
- ambiguity: a deliberate double meaning collapsed into one reading
- culture: religious, social or culture-bound reference flattened ("إن شاء الله" → "hopefully" loses the faith and the hedging)
- rhythm: rhyme, proverb form, sound play, conciseness
- implied: unspoken subtext (reproach, invitation, refusal) neutralised ("براحتك" said as reproach → "as you like" loses the reproach)

For each finding provide:
- kind: "loss" or "weakened". A weakened tone is not a major loss: severity stays 1 or 2.
- category: one of the eight keys above.
- severity: 1 slight, 2 clear, 3 major.
- confidence: 0–1, how sure you are that this is really lost given this text (and the surrounding context, when provided).
- source_quote: EXACT text copied from the source, as short as possible.
- target_quote: EXACT text copied from the translation, as short as possible.
- source_occurrence / target_occurrence: 1-based occurrence numbers, only when the quoted text appears more than once in its text.
- explanation: one plain sentence in the UI language, phrased as a possibility ("may sound…", "قد يبدو…"), naming what was lost.
- restores: 0–3 complete alternative translations of the WHOLE source that recover the loss, in the same target language, style, register and dialect. Change as little as possible; keep every name, number, date, link and emoji. Each note must say in a few words what the alternative gains and what it risks losing. Omit restores when there is no safe alternative.

Rules:
- Every quote must be copied exactly from its text. If you cannot quote it, do not report it.
- At most 4 findings, strongest first. Fewer is better.
- Do not report translation errors of fact or grammar; this is not a proofreading pass.
- When a <source_part> is given, it is one part of a longer source; report only findings whose source_quote is inside it. <context_before>/<context_after> are for judging tone only.

Return JSON only:
{"losses":[{"kind":"loss","category":"intensity","severity":2,"confidence":0.8,"source_quote":"...","target_quote":"...","explanation":"...","restores":[{"text":"...","note":"..."}]}]}`;

export interface ShadowPromptInput {
  text: string;
  translation: string;
  source: string;
  target: string;
  style: string;
  uiLocale: string;
  dialect?: string | undefined;
  /** Set when the source was split; index is 1-based. */
  part?: { index: number; total: number } | undefined;
  contextBefore?: string | undefined;
  contextAfter?: string | undefined;
}

/** The one user prompt, for a whole short text or for one windowed part of a long one. */
export function shadowUserPrompt(input: ShadowPromptInput): string {
  const lines = [
    `UI language: ${input.uiLocale}`,
    `Direction: ${input.source}→${input.target}`,
    `Style: ${input.style}`,
  ];
  if (input.dialect && input.dialect !== "auto") lines.push(`Arabic dialect: ${input.dialect}`);
  if (input.part && input.part.total > 1) {
    lines.push(
      `This is PART ${input.part.index} of ${input.part.total} of a longer source. Judge this part in order; earlier parts are earlier in the text. Report only findings whose source_quote is inside <source_part>. Use the context only to understand tone; do not report findings from it.`,
    );
  }
  const sourceTag = input.part && input.part.total > 1 ? "source_part" : "source";
  lines.push(`<${sourceTag}>`, input.text, `</${sourceTag}>`);
  if (input.contextBefore) lines.push("<context_before>", input.contextBefore, "</context_before>");
  if (input.contextAfter) lines.push("<context_after>", input.contextAfter, "</context_after>");
  lines.push("<translation>", input.translation, "</translation>");
  return lines.join("\n");
}

/** True when the text can carry a meaningful shadow at all (sentence, bounded size). */
export function isShadowCandidate(raw: string): boolean {
  const text = raw.trim();
  if (!text || text.length > MAX_SOURCE) return false;
  return text.split(/\s+/u).length >= 3;
}
