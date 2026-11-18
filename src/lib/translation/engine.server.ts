import { createOpenCodeLunaProvider } from "./providers/opencode.server";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "./types";
import { DEFAULT_BRAIN, LUNA_ENABLED, TranslationError, effectiveBrain, type Brain } from "./types";
import { verifyTranslation } from "./verify";

/**
 * Strict model selection.
 *
 * The request's `brain` is the only provider that may write the answer. There is no
 * automatic second-model fallback: a person who chose Sona must never silently receive
 * Velo's wording, and a person who chose Velo must never wait for Sona. An unavailable
 * or rejecting model fails its own request and the client shows a calm, retryable error.
 * DeepSeek analysis (dictionary/shadow) is a separate, optional reading path and is not
 * allowed to modify a translation.
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

/** The one provider selected by the request; never a substitute for it. */
async function providerFor(brain: Brain = DEFAULT_BRAIN): Promise<TranslationProvider> {
  const selected = effectiveBrain(brain);
  if (selected === "luna") {
    const provider = luna();
    if (provider) return provider;
    throw new TranslationError("auth", "The selected model is not configured.");
  }
  const provider = await deepseek();
  if (provider) return provider;
  throw new TranslationError("auth", "The selected model is not configured.");
}

/**
 * One-shot quiet analysis against the analysis provider: dictionary readings, the sentence
 * shadow, and any future semantic task that is pure text-in / JSON-out.
 *
 * This is the single place that knows which model answers an analysis request, so the
 * dictionary and shadow modules own a prompt and a parser and nothing about a provider.
 * Analysis deliberately stays on DeepSeek: its capability profile (thinking at max effort,
 * JSON mode, 65,536-token ceiling) is verified there only, and it never edits the chosen
 * model's translation.
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

/** A caller-owned cancellation signal, passed through to the provider request. */
export interface CallOptions {
  signal?: AbortSignal | undefined;
}

export async function runTranslation(
  req: TranslationRequest,
): Promise<{ result: TranslationResult; issues: string[] }> {
  const provider = await providerFor(req.brain);
  const result = await provider.translate(req);
  const issues = req.partial ? [] : verifyTranslation(req, result);
  return { result, issues };
}

/**
 * Quiet second pass for a finished sentence, on the same selected model. Deterministic
 * problems (lost numbers, links) get a repair; nothing else is rewritten, and no other
 * model is consulted. Returns null when nothing is clearly better.
 */
export async function runRepair(
  req: TranslationRequest,
  previous: TranslationResult,
  opts: CallOptions = {},
): Promise<TranslationResult | null> {
  const issues = verifyTranslation(req, previous);
  if (issues.length === 0) return null;
  try {
    const provider = await providerFor(req.brain);
    const repaired = await provider.repair(req, previous, issues, opts.signal);
    return verifyTranslation(req, repaired).length < issues.length ? repaired : null;
  } catch {
    return null;
  }
}
