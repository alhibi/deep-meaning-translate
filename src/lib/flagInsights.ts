import type { Flag } from "./flags";

export interface WordStat {
  word: string;
  target: string;
  count: number;
}

export type Tip =
  | { kind: "recurring"; word: string; count: number }
  | { kind: "short"; count: number }
  | { kind: "long"; count: number }
  | { kind: "brain"; brain: string; count: number }
  | { kind: "pair"; source: string; target: string; count: number };

/** Words the user marked most often, per target language. */
export function wordStats(list: Flag[]): WordStat[] {
  const map = new Map<string, WordStat>();
  for (const f of list)
    for (const w of f.words) {
      const k = `${f.target}|${w.toLowerCase()}`;
      const hit = map.get(k);
      if (hit) hit.count++;
      else map.set(k, { word: w, target: f.target, count: 1 });
    }
  return [...map.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Evidence-based suggestions for improving the model instructions.
 * Shown only — nothing changes automatically. Every tip needs at least 2 flags.
 */
export function tipsFor(list: Flag[]): Tip[] {
  const tips: Tip[] = [];
  for (const w of wordStats(list))
    if (w.count >= 2 && tips.length < 3)
      tips.push({ kind: "recurring", word: w.word, count: w.count });

  const short = list.filter((f) => wordCount(f.original) <= 3).length;
  if (short >= 2 && short * 2 >= list.length) tips.push({ kind: "short", count: short });
  const long = list.filter((f) => wordCount(f.original) >= 25).length;
  if (long >= 2 && long * 2 >= list.length) tips.push({ kind: "long", count: long });

  const byBrain = new Map<string, number>();
  for (const f of list) byBrain.set(f.brain, (byBrain.get(f.brain) ?? 0) + 1);
  for (const [brain, count] of byBrain)
    if (count >= 3 && count * 4 >= list.length * 3 && byBrain.size > 0 && list.length >= 3)
      tips.push({ kind: "brain", brain, count });

  const byPair = new Map<string, number>();
  for (const f of list) {
    const k = `${f.source}|${f.target}`;
    byPair.set(k, (byPair.get(k) ?? 0) + 1);
  }
  const top = [...byPair].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 3) {
    const [source, target] = top[0].split("|");
    tips.push({ kind: "pair", source: source!, target: target!, count: top[1] });
  }
  return tips;
}
