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

export async function runTranslation(req: TranslationRequest): Promise<TranslationResult> {
  const provider = resolveProvider();
  const first = await provider.translate(req);
  const issues = verifyTranslation(req, first);
  if (issues.length === 0) return first;

  try {
    const repaired = await provider.repair(req, first, issues);
    return verifyTranslation(req, repaired).length <= issues.length ? repaired : first;
  } catch {
    return first;
  }
}
