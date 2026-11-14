import type { TranslationResult } from "./types";

const lang2 = (code: string | undefined) => (code ?? "").slice(0, 2).toLowerCase();

/**
 * A model may name a different target language than the one that was requested. The
 * request is authoritative: a mismatched field is stale metadata, not an instruction to
 * re-route the screen.
 */
export function matchesTarget(result: TranslationResult | null, target: string): boolean {
  if (!result || !result.targetLanguage) return true;
  return lang2(result.targetLanguage) === lang2(target);
}

/**
 * What the result area should show, as one pure decision.
 *
 * `pending` means "a request is in flight, or a re-route is happening". It must never
 * mean "a stale result is being hidden": that conflation turned a model's wrong
 * `targetLanguage` into a skeleton with nothing running and no way out.
 */
export function resultState(args: {
  raw: TranslationResult | null;
  rawPending: boolean;
  rerouting: boolean;
  target: string;
}): { result: TranslationResult | null; stale: boolean; pending: boolean } {
  const stale = !!args.raw && !matchesTarget(args.raw, args.target);
  return {
    result: stale || args.rerouting ? null : args.raw,
    stale,
    pending: args.rawPending || args.rerouting,
  };
}
