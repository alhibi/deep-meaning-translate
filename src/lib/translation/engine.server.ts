import { createOpenCodeLunaProvider } from "./providers/opencode.server";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "./types";
import { DEFAULT_BRAIN, LUNA_ENABLED, TranslationError, effectiveBrain, type Brain } from "./types";
import { verifyTranslation } from "./verify";

/**
 * Two brains:
 * - The request's `brain` picks the writer — DeepSeek by default, Luna when selected —
 *   and the other model is the automatic fallback.
 * - DeepSeek reviews Luna-written settled sentences; it never reviews its own writing.
 * The app still works when only one provider key is configured.
 */
function luna(): TranslationProvider | null {
  const apiKey = process.env["OPENCODE_API_KEY"];
  return LUNA_ENABLED && apiKey ? createOpenCodeLunaProvider(apiKey) : null;
}
async function deepseek(): Promise<TranslationProvider | null> {
  const { deepseekKey, createDeepSeekProvider } = await import("./providers/deepseek.server");
  const key = deepseekKey();
  return key ? createDeepSeekProvider(key) : null;
}

/**
 * One-shot quiet analysis against the active provider: dictionary readings, the sentence
 * shadow, and any future semantic task that is pure text-in / JSON-out.
 *
 * This is the single place that knows which model answers an analysis request, so the
 * dictionary and shadow modules own a prompt and a parser and nothing about a provider.
 *
 * Analysis deliberately stays on DeepSeek while Luna is enabled: its capability profile
 * (thinking at max effort, JSON mode, 65,536-token ceiling) is verified against DeepSeek
 * only, and enrichment must not gain a second, unverified provider path. Luna is the
 * translation/review brain.
 */
export async function runAnalysis(
  system: string,
  user: string,
  opts: { signal?: AbortSignal | undefined; chars?: number | undefined } = {},
): Promise<string> {
  const { chat, deepseekKey } = await import("./providers/deepseek.server");
  const key = deepseekKey();
  if (!key) throw new TranslationError("auth", "The analysis provider is not configured.");
  return chat(key, system, user, {
    profile: "analysis",
    signal: opts.signal,
    chars: opts.chars ?? user.length,
  });
}

/** Failures where the other brain can help; bad input or cancellation never fall back. */
export const shouldFallBack = (err: unknown) =>
  err instanceof TranslationError && err.kind !== "input";

/** A caller-owned cancellation signal, passed through to the provider request. */
export interface CallOptions {
  signal?: AbortSignal | undefined;
}

async function withFallback<T>(
  run: (p: TranslationProvider, signal?: AbortSignal) => Promise<T>,
  brain: Brain = DEFAULT_BRAIN,
  signal?: AbortSignal,
): Promise<T> {
  const lunaFirst = effectiveBrain(brain) === "luna";
  const primary = lunaFirst ? luna() : await deepseek();
  const other = async () => (lunaFirst ? deepseek() : luna());
  if (primary) {
    try {
      return await run(primary, signal);
    } catch (err) {
      const backup = shouldFallBack(err) ? await other() : null;
      if (!backup) throw err;
      return run(backup, signal);
    }
  }
  const backup = await other();
  if (!backup)
    throw new TranslationError("auth", "The translation provider is not configured yet.");
  return run(backup, signal);
}

export async function runTranslation(
  req: TranslationRequest,
): Promise<{ result: TranslationResult; issues: string[] }> {
  const result = await withFallback((p) => p.translate(req), req.brain);
  const issues = req.partial ? [] : verifyTranslation(req, result);
  return { result, issues };
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * Quiet second pass for a finished sentence. Deterministic problems (lost
 * numbers, links) get a repair; otherwise the second brain reviews it.
 * Returns null when nothing is clearly better.
 */
export async function runRepair(
  req: TranslationRequest,
  previous: TranslationResult,
  opts: CallOptions = {},
): Promise<TranslationResult | null> {
  const issues = verifyTranslation(req, previous);
  if (issues.length > 0) {
    try {
      const repaired = await withFallback(
        (p, signal) => p.repair(req, previous, issues, signal),
        req.brain,
        opts.signal,
      );
      return verifyTranslation(req, repaired).length < issues.length ? repaired : null;
    } catch {
      return null;
    }
  }
  return runReview(req, previous, opts);
}

export async function runReview(
  req: TranslationRequest,
  previous: TranslationResult,
  opts: CallOptions = {},
): Promise<TranslationResult | null> {
  const { deepseekKey, reviewTranslation } = await import("./providers/deepseek.server");
  const key = deepseekKey();
  // DeepSeek never reviews its own writing. Prefer the recorded writer: a Luna request that
  // DeepSeek rescued is DeepSeek's writing, and a Luna-written answer is reviewed even when
  // the request named DeepSeek as the requested brain.
  const writer = req.writer ?? effectiveBrain(req.brain ?? DEFAULT_BRAIN);
  if (!key || req.partial || writer === "deepseek" || !req.text.trim()) return null;
  try {
    const reviewed = await reviewTranslation(key, req, previous, opts.signal);
    if (!reviewed || norm(reviewed.translation) === norm(previous.translation)) return null;
    // Never accept a "fix" that breaks a number, link or emoji the original kept.
    if (verifyTranslation(req, reviewed).length > 0) return null;
    return { ...previous, ...reviewed };
  } catch {
    return null;
  }
}
