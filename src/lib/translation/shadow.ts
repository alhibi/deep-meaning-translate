import { z } from "zod";

/**
 * Sentence Shadow: what a correct translation may have lost (warmth, intensity…).
 * The model only quotes fragments; every offset is recomputed here, and anything
 * that cannot be anchored in BOTH texts is dropped — a shadow never points at nothing.
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

export const MAX_LOSSES = 4;
export const MIN_CONFIDENCE = 0.55;
export const MAX_SOURCE = 600;

const RawLoss = z.object({
  category: z.enum(SHADOW_CATEGORIES),
  severity: z.coerce.number(),
  confidence: z.coerce.number(),
  source_quote: z.string(),
  target_quote: z.string(),
  explanation: z.string(),
  restores: z
    .array(z.object({ text: z.string(), note: z.string().optional().default("") }))
    .optional()
    .default([]),
});

/** Sentences only: one or two words belong to the dictionary. */
export function isShadowCandidate(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_SOURCE) return false;
  return t.split(/\s+/u).length >= 3;
}

/** Locates a quote; tolerant of case and inner whitespace, never of different words. */
export function anchor(text: string, quote: string): Span | null {
  const q = quote.trim();
  if (!q) return null;
  let i = text.indexOf(q);
  if (i === -1) i = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  if (i !== -1) return { start: i, end: i + q.length };
  const parts = q.split(/\s+/u).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const m = new RegExp(parts.join("\\s+"), "iu").exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
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

const overlaps = (x: Span, y: Span) => x.start < y.end && y.start < x.end;

/** Validates and re-anchors a raw model reply. Returns `{losses: []}` for an honest "nothing lost". */
export function parseShadow(raw: unknown, source: string, translation: string): ShadowResult | null {
  const list = (raw as { losses?: unknown } | null)?.losses;
  if (!Array.isArray(list)) return null;
  const out: Loss[] = [];
  const candidates: Loss[] = [];
  for (const item of list) {
    const r = RawLoss.safeParse(item);
    if (!r.success) continue;
    const v = r.data;
    const confidence = Math.min(1, Math.max(0, v.confidence));
    if (!(confidence >= MIN_CONFIDENCE)) continue;
    const src = anchor(source, v.source_quote);
    const tgt = anchor(translation, v.target_quote);
    const explanation = v.explanation.trim().slice(0, 280);
    if (!src || !tgt || !explanation) continue;
    const seen = new Set<string>();
    const restores: Restore[] = [];
    for (const rs of v.restores) {
      const text = rs.text.trim();
      if (!text || text === translation.trim() || seen.has(text)) continue;
      if (text.length > translation.length * 2 + 80) continue;
      seen.add(text);
      restores.push({ text, note: rs.note.trim().slice(0, 140), changed: changedSpan(translation, text) });
      if (restores.length === 3) break;
    }
    const severity = Math.min(3, Math.max(1, Math.round(v.severity))) as 1 | 2 | 3;
    candidates.push({
      id: `${v.category}-${tgt.start}-${tgt.end}`,
      category: v.category,
      severity,
      confidence,
      source: src,
      target: tgt,
      sourceQuote: source.slice(src.start, src.end),
      targetQuote: translation.slice(tgt.start, tgt.end),
      explanation,
      restores,
    });
  }
  // Strongest first; overlapping shadows on the same words keep only the strongest.
  candidates.sort((a, b) => b.severity * b.confidence - a.severity * a.confidence);
  for (const c of candidates) {
    if (out.some((o) => overlaps(o.target, c.target))) continue;
    out.push(c);
    if (out.length === MAX_LOSSES) break;
  }
  out.sort((a, b) => a.target.start - b.target.start);
  return { losses: out };
}

/** Keeps losses still present in an edited translation (after applying one fix). */
export function carryLosses(losses: Loss[], translation: string, without: string): Loss[] {
  const kept: Loss[] = [];
  for (const l of losses) {
    if (l.id === without) continue;
    const tgt = anchor(translation, l.targetQuote);
    if (!tgt || kept.some((k) => overlaps(k.target, tgt))) continue;
    kept.push({ ...l, target: tgt, restores: [] });
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
  for (const l of [...losses].sort((a, b) => a.target.start - b.target.start)) {
    if (l.target.start < pos || l.target.end > text.length) continue;
    if (l.target.start > pos) out.push({ text: text.slice(pos, l.target.start) });
    out.push({ text: text.slice(l.target.start, l.target.end), loss: l });
    pos = l.target.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

export const SHADOW_SYSTEM = `You are a translation critic. Given a SOURCE and its TRANSLATION, list only what the translation genuinely LOST from the source's meaning — not errors of fact, but nuance that did not survive.
Categories (use exactly these keys):
- warmth: affection, tenderness, closeness ("يا روحي" → "my dear" keeps it; "Hi" loses it)
- intensity: emphasis, exaggeration, emotional force ("يا حسرتاه" → "Schade" loses grief)
- respect: politeness, deference, formality, Sie/du, honorifics ("حضرتك" → "du" loses respect)
- humor: irony, sarcasm, playfulness ("شاطر!" said ironically → "Gut gemacht" loses irony)
- ambiguity: intended double meaning collapsed into one reading
- culture: religious, social or culture-bound reference flattened ("إن شاء الله" → "hopefully" loses faith & hedging)
- rhythm: rhyme, proverb form, sound play, conciseness
- implied: unspoken subtext (reproach, invitation, refusal) made neutral ("براحتك" as reproach → "as you like")
Rules:
- Most good translations lose little. If nothing meaningful was lost, return {"losses":[]}. Never invent losses.
- At most 4 losses. Each must quote EXACT text copied from the source (source_quote) and EXACT text copied from the translation (target_quote), as short as possible.
- severity: 1 slight, 2 clear, 3 major. confidence 0–1 (how sure this is really lost, given context).
- explanation: one plain sentence in the UI language, phrased as possibility ("may sound…", "قد يبدو…"), naming what was lost.
- restores: 1–3 full alternative translations of the WHOLE source that recover the loss, in the same target language, style, register and dialect; change as little as needed. note: a few words on the trade-off, in the UI language.
Return JSON only: {"losses":[{"category":"...","severity":2,"confidence":0.8,"source_quote":"...","target_quote":"...","explanation":"...","restores":[{"text":"...","note":"..."}]}]}`;

export function shadowUserPrompt(i: {
  text: string;
  translation: string;
  source: string;
  target: string;
  style: string;
  uiLocale: string;
  dialect?: string | undefined;
}): string {
  return `UI language: ${i.uiLocale}\nDirection: ${i.source}→${i.target}\nStyle: ${i.style}${
    i.dialect && i.dialect !== "auto" ? `\nArabic dialect: ${i.dialect}` : ""
  }\n<source>\n${i.text}\n</source>\n<translation>\n${i.translation}\n</translation>`;
}

/** Extracts JSON from a model reply and validates it. */
export function readShadowReply(raw: string, source: string, translation: string): ShadowResult | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return parseShadow(JSON.parse(raw.slice(start, end + 1)), source, translation);
  } catch {
    return null;
  }
}
