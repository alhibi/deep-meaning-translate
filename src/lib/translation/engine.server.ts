import { createOpenCodeLunaProvider } from "./providers/opencode.server";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "./types";
import { TranslationError } from "./types";
import { verifyTranslation } from "./verify";

/** Swap in another provider here without touching the UI or the server boundary. */
function resolveProvider(): TranslationProvider {
  const apiKey = process.env["OPENCODE_API_KEY"];
  if (!apiKey)
    throw new TranslationError("auth", "The translation provider is not configured yet.");
  return createOpenCodeLunaProvider(apiKey);
}

/**
 * First pass only. Returned issues let the client show the translation immediately
 * and run the repair in the background instead of making the user wait for it.
 */
export async function runTranslation(
  req: TranslationRequest,
): Promise<{ result: TranslationResult; issues: string[] }> {
  const provider = resolveProvider();
  const result = await provider.translate(req);
  // Provisional (still-typing) text: speed wins; the final sentence gets the full check.
  const issues = req.partial ? [] : verifyTranslation(req, result);
  return { result, issues };
}

/** Background repair: returns an improved translation, or null when it is not better. */
export async function runRepair(
  req: TranslationRequest,
  previous: TranslationResult,
): Promise<TranslationResult | null> {
  const issues = verifyTranslation(req, previous);
  if (issues.length === 0) return null;
  const provider = resolveProvider();
  try {
    const repaired = await provider.repair(req, previous, issues);
    return verifyTranslation(req, repaired).length < issues.length ? repaired : null;
  } catch {
    return null;
  }
}
