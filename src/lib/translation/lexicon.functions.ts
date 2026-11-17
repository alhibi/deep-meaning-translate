import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { takeEnrichmentToken } from "./throttle";
import { getRequest } from "@tanstack/react-start/server";
import { clientAddress, sameOrigin } from "../requestSafety";
import {
  LEXICON_MAX_CONTEXT_INPUT,
  LEXICON_MAX_TERM_INPUT,
  LEXICON_MAX_TRANSLATION_INPUT,
  applyLexiconRequestContext,
  type LexiconQuery,
  type LexiconResult,
} from "./lexicon";

/**
 * The lexicon server surface.
 *
 * This module knows nothing about a provider: the reading is produced through
 * `engine.runAnalysis`, the single entry point for semantic analysis, and the prompt,
 * parser and ranking live in `lexicon.ts` so they can never drift apart.
 *
 * Input is bounded twice: the zod schema is the transport stop and `isLexiconCandidate` is
 * the semantic gate (code points and words). The transport bounds sit at twice the
 * semantic caps, so an over-long string becomes a quiet `null` instead of a schema error
 * while a legitimate astral character still counts once.
 */
export const LexiconInput = z
  .object({
    text: z.string().trim().min(1).max(LEXICON_MAX_TERM_INPUT),
    source: z.string().regex(/^[a-z]{2}$|^auto$/),
    target: z.string().regex(/^[a-z]{2}$/),
    uiLocale: z.enum(["ar", "en", "de"]),
    /** Ranks readings for the sentence; twice the 200-code-point ranking cap. */
    translation: z.string().trim().max(LEXICON_MAX_TRANSLATION_INPUT).optional(),
    /** The full source sentence, when a caller has one beyond the term itself. */
    context: z.string().trim().max(LEXICON_MAX_CONTEXT_INPUT).optional(),
    /** Register the reading must fit; "natural" when omitted (older clients). */
    style: z.enum(["natural", "formal", "casual"]).optional(),
    dialect: z.enum(["auto", "msa", "levant", "egypt", "gulf", "iraq", "maghreb"]).optional(),
  })
  .strict();

export type LexiconRequest = z.infer<typeof LexiconInput>;

/** The analysis model profile can think for a while; a hung provider must not hold the queue. */
const ANALYSIS_TIMEOUT_MS = 45_000;

/**
 * One dictionary analysis for an already-admissible request.
 *
 * Any failure is a quiet `null`: a dictionary reading is optional enrichment and must
 * never touch the translation on screen.
 */
export async function runLexiconAnalysis(data: LexiconRequest): Promise<LexiconResult | null> {
  const { runAnalysis } = await import("./engine.server");
  const { LEXICON_SYSTEM, lexiconUserPrompt, readLexiconReply } = await import("./lexicon");
  const query: LexiconQuery = {
    text: data.text,
    source: data.source,
    target: data.target,
    uiLocale: data.uiLocale,
    ...(data.translation ? { translation: data.translation } : {}),
    ...(data.context ? { context: data.context } : {}),
    style: data.style ?? "natural",
    ...(data.dialect ? { dialect: data.dialect } : {}),
  };
  try {
    // The analysis profile (thinking, effort max, JSON mode) is the verified capability
    // contract for a semantic task; chars bounds the runaway output ceiling.
    const raw = await runAnalysis(LEXICON_SYSTEM, lexiconUserPrompt(query), {
      signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
      chars: data.text.length + (data.context?.length ?? 0),
    });
    return readLexiconReply(raw);
  } catch {
    return null;
  }
}

export interface LexiconAdmission {
  /** The incoming request: same-origin check and enrichment budget are keyed from it. */
  request: Request;
  /**
   * The installed app's exact origin allowlist already authorized the call at its route
   * gate, so the second same-origin check is skipped (browser calls keep it).
   */
  crossOrigin?: boolean;
}

/**
 * The one dictionary path, shared by the browser server function and the native handler:
 * cheap gate → admission → provider-agnostic analysis → request-context echo. Keeping it
 * here means a change to admission or to the echo can never land on one transport only.
 */
export async function analyzeLexiconFor(
  data: LexiconRequest,
  admission: LexiconAdmission,
): Promise<LexiconResult | null> {
  const { isLexiconCandidate } = await import("./lexicon");
  if (!isLexiconCandidate(data.text)) return null;
  if (!admission.crossOrigin && !sameOrigin(admission.request)) return null;
  if (!takeEnrichmentToken(clientAddress(admission.request))) return null;
  const lexicon = await runLexiconAnalysis(data);
  if (!lexicon) return null;
  // Echo the request's register/variety/sentence for the panel; the model never sets them.
  return applyLexiconRequestContext(lexicon, data);
}

export const lookupLexicon = createServerFn({ method: "POST" })
  .validator((input: unknown) => LexiconInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; lexicon: LexiconResult | null }> => ({
    ok: true,
    lexicon: await analyzeLexiconFor(data, { request: getRequest() }),
  }));
