import type { TranslationRequest, TranslationResult } from "./types";

const URL_RE = /https?:\/\/[^\s)]+/g;
const NUM_RE = /\d+(?:[.,]\d+)*/g;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function multiset(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of list) m.set(item, (m.get(item) ?? 0) + 1);
  return m;
}

function missing(src: string[], out: string[]): string[] {
  const outSet = multiset(out);
  const gone: string[] = [];
  for (const [value, count] of multiset(src)) {
    const have = outSet.get(value) ?? 0;
    if (have < count) gone.push(value);
  }
  return gone;
}

/**
 * Lightweight, deterministic post-generation checks. Never surfaced to the user;
 * a failure triggers one repair pass in the provider layer.
 */
export function verifyTranslation(req: TranslationRequest, res: TranslationResult): string[] {
  const issues: string[] = [];
  const src = req.text;
  const out = res.translation ?? "";

  if (!out.trim()) {
    issues.push("The translation is empty.");
    return issues;
  }

  const lostUrls = missing(src.match(URL_RE) ?? [], out.match(URL_RE) ?? []);
  if (lostUrls.length) issues.push(`URLs dropped or altered: ${lostUrls.join(", ")}`);

  const lostNums = missing(
    (src.match(NUM_RE) ?? []).map((n) => n.replace(/[.,]/g, "")),
    (out.match(NUM_RE) ?? []).map((n) => n.replace(/[.,]/g, "")),
  );
  if (lostNums.length) issues.push(`Numbers missing from the translation: ${lostNums.join(", ")}`);

  const lostEmoji = missing(src.match(EMOJI_RE) ?? [], out.match(EMOJI_RE) ?? []);
  if (lostEmoji.length) issues.push(`Emojis dropped: ${lostEmoji.join(" ")}`);

  const srcLines = src.trim().split(/\n{2,}/).length;
  const outLines = out.trim().split(/\n{2,}/).length;
  if (srcLines > 1 && outLines < srcLines) issues.push("Paragraph structure was not preserved.");

  const ratio = out.length / Math.max(src.length, 1);
  if (src.length > 40 && ratio > 2.6)
    issues.push("The translation is far longer than the source; it may add invented content.");
  if (src.length > 40 && ratio < 0.35)
    issues.push("The translation is far shorter than the source; content may be missing.");

  if (/^(translation|übersetzung|ترجمة)\s*[:：]/i.test(out.trim()))
    issues.push("The translation contains a label prefix instead of plain text.");

  return issues;
}
