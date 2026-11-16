import { callPromptDirect } from "./direct";
import { parseResult } from "./parse";
import { buildRepairPrompt, buildSystemPrompt } from "./prompt";
import type { TranslationRequest, TranslationResult } from "./types";
import { verifyTranslation } from "./verify";

/**
 * The deterministic second pass, issued from the device with the personal key.
 *
 * Same rule as the server path: only a repair that clears more issues than it creates is
 * accepted; otherwise the original answer stays. The model is never asked for a rewrite
 * for taste.
 */
export async function repairDirect(
  request: TranslationRequest,
  previous: TranslationResult,
): Promise<TranslationResult | null> {
  const issues = verifyTranslation(request, previous);
  if (!issues.length) return null;
  try {
    const raw = await callPromptDirect(
      buildSystemPrompt(),
      buildRepairPrompt(request, previous, issues),
      true,
      request.text.length,
    );
    const repaired = parseResult(raw, request);
    return verifyTranslation(request, repaired).length < issues.length ? repaired : null;
  } catch {
    return null;
  }
}
