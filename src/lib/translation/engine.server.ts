import { createOpenCodeLunaProvider } from "./providers/opencode.server";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "./types";
import { DEFAULT_BRAIN, TranslationError, type Brain } from "./types";
import { verifyTranslation } from "./verify";

/**
 * Two brains:
 * - Luna (OpenCode) writes every translation — fastest first words.
 * - DeepSeek V4.1 Flash reviews each finished sentence and takes over when Luna fails.
 * Without DEEPSEEK_API_KEY the app runs on Luna alone, exactly as before.
 */
function luna(): TranslationProvider | null {
  const apiKey = process.env["OPENCODE_API_KEY"];
  return apiKey ? createOpenCodeLunaProvider(apiKey) : null;
}
async function deepseek(): Promise<TranslationProvider | null> {
  const { deepseekKey, createDeepSeekProvider } = await import("./providers/deepseek.server");
  const key = deepseekKey();
  return key ? createDeepSeekProvider(key) : null;
}

/** Failures where the other brain can help; bad input or cancellation never fall back. */
export const shouldFallBack = (err: unknown) =>
  err instanceof TranslationError && err.kind !== "input";

async function withFallback<T>(
  run: (p: TranslationProvider) => Promise<T>,
  brain: Brain = DEFAULT_BRAIN,
): Promise<T> {
  const lunaFirst = brain === "luna";
  const primary = lunaFirst ? luna() : await deepseek();
  const other = async () => (lunaFirst ? deepseek() : luna());
  if (primary) {
    try {
      return await run(primary);
    } catch (err) {
      const backup = shouldFallBack(err) ? await other() : null;
      if (!backup) throw err;
      return run(backup);
    }
  }
  const backup = await other();
  if (!backup)
    throw new TranslationError("auth", "The translation provider is not configured yet.");
  return run(backup);
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
): Promise<TranslationResult | null> {
  const issues = verifyTranslation(req, previous);
  if (issues.length > 0) {
    try {
      const repaired = await withFallback((p) => p.repair(req, previous, issues), req.brain);
      return verifyTranslation(req, repaired).length < issues.length ? repaired : null;
    } catch {
      return null;
    }
  }
  return runReview(req, previous);
}

export async function runReview(
  req: TranslationRequest,
  previous: TranslationResult,
): Promise<TranslationResult | null> {
  const { deepseekKey, reviewTranslation } = await import("./providers/deepseek.server");
  const key = deepseekKey();
  // DeepSeek never reviews its own writing.
  if (!key || req.partial || (req.brain ?? DEFAULT_BRAIN) === "deepseek" || !req.text.trim()) return null;
  try {
    const reviewed = await reviewTranslation(key, req, previous);
    if (!reviewed || norm(reviewed.translation) === norm(previous.translation)) return null;
    // Never accept a "fix" that breaks a number, link or emoji the original kept.
    if (verifyTranslation(req, reviewed).length > 0) return null;
    return { ...previous, ...reviewed };
  } catch {
    return null;
  }
}
