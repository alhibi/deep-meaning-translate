import { outputTokenBudget } from "../budget";
import { TranslationError } from "../types";

/**
 * What the active writer can actually do, and the request shape each task class uses.
 *
 * Verified against the official DeepSeek API documentation on 2026-11-17:
 * - model ids, 1M-token context, 384K maximum output, thinking support, JSON Output:
 *   https://api-docs.deepseek.com/quick_start/pricing.md
 * - thinking toggle shape `{"thinking":{"type":"enabled"|"disabled"}}`, effort control
 *   `{"reasoning_effort":"low"|"high"|"max"}`, and the fact that thinking is ON by default
 *   with effort high — a non-thinking call that omits the toggle silently becomes slower:
 *   https://api-docs.deepseek.com/guides/thinking_mode.md
 * - `temperature` (0–2) has no effect in thinking mode (it is silently ignored):
 *   the same thinking-mode page
 * - `max_tokens` accepts 1..393,216, defaults to 8K non-thinking / 64K thinking / 128K at
 *   effort max, and input+generated tokens share the context window:
 *   https://api-docs.deepseek.com/api/create-chat-completion.md
 * - `response_format:{"type":"json_object"}` guarantees valid JSON, but content can still
 *   be blank with `finish_reason:"stop"` when the model answered non-JSON, and a
 *   `length` finish cuts the JSON string:
 *   https://api-docs.deepseek.com/guides/json_mode.md
 *
 * The documentation does not say whether chain-of-thought tokens count against
 * `max_tokens`. A live probe of the configured model on 2026-11-17 settled it: with
 * `max_tokens: 10` and thinking enabled the provider returned `finish_reason: "length"`,
 * 10 completion tokens all charged as reasoning, and an empty answer, while the same
 * request without thinking completed normally. Reasoning therefore shares the generation
 * budget, which is why the thinking profiles below keep a ceiling well above what the plain
 * answer needs: an answer must never be cut merely because the model reasoned first.
 *
 * Re-verified live before this evaluation (same deployed model, key not printed):
 * GET /models returned exactly `deepseek-flash` and `deepseek-v4-pro`; `max_tokens: 393216`
 * was accepted and `393217` returned the documented 400 with range `[1, 393216]`; an
 * omitted `thinking` toggle returned `reasoning_tokens` while `{"type":"disabled"}`
 * returned none; JSON mode returned valid JSON; the SSE stream ended with `[DONE]` and
 * carried usage on its final chunk; a client abort stopped the stream after ~0.3 s.
 * Capability/evaluation commands and real results: `tests/eval/README.md`.
 */

/** Task classes the app makes provider calls for. */
export type TaskProfile = "live" | "full" | "repair" | "analysis";

/** Documented `reasoning_effort` values; `none` is expressed as thinking disabled here. */
export type ReasoningEffort = "low" | "high" | "max";

/** Documented context window of `deepseek-flash` (1M tokens). */
export const CONTEXT_WINDOW_TOKENS = 1_000_000;

/** Documented upper bound of `max_tokens` on `deepseek-flash` (384K). */
export const MAX_OUTPUT_TOKENS = 393_216;

/**
 * Conservative characters-to-tokens conversion for the context guard.
 *
 * The docs estimate ~0.3 token per English character and ~0.6 per Chinese character.
 * Arabic, German compounds and markup tokenize worse, so the guard assumes 3 tokens per
 * character: it only has to fail loudly for input that cannot fit, never predict a bill.
 */
export const TOKENS_PER_CHAR = 3;

/** Room for chat framing, the system prompt and the JSON schema instructions. */
export const PROMPT_OVERHEAD_TOKENS = 8_192;

interface ProfileSpec {
  /** Thinking is ON by default in the API, so "disabled" must be sent explicitly. */
  thinking: boolean;
  /** Only sent with thinking enabled, matching the documented effort-control example. */
  effort?: ReasoningEffort;
  /** Only sent when thinking is disabled: the documented API ignores it otherwise. */
  temperature?: number;
  json: boolean;
  /**
   * Lowest ceiling this task class may use. Repair and analysis reason before
   * answering, so their runaway ceiling must cover reasoning plus the structured answer;
   * the plain-answer budget alone would clamp them below what the model can answer.
   */
  minCeiling: number;
}

const PROFILES: Record<TaskProfile, ProfileSpec> = {
  // Provisional text while someone is still typing: first words must arrive fast, so no
  // thinking and no JSON envelope. This is the shape the live path always had.
  live: { thinking: false, temperature: 0.3, json: false, minCeiling: 0 },
  // The settled answer. Thinking stays explicitly disabled: the JSON envelope plus the
  // deterministic verifier are the correctness contract, and turning on the model's
  // default thinking would add reasoning latency to the answer the person is waiting
  // for. No measured quality gain exists in this environment (TD1), so it is left off.
  full: { thinking: false, temperature: 0.3, json: true, minCeiling: 0 },
  // A quiet second pass runs only after deterministic checks found a real loss (a dropped
  // number, link or emoji). Correcting that benefits from reasoning, and nothing is
  // waiting on the result, so reasoning is allowed here.
  repair: { thinking: true, effort: "high", json: true, minCeiling: 32_768 },
  // Dictionary/shadow analysis is short input with a rich structured answer (readings,
  // forms, examples, offsets) in the background: the deepest documented effort. No higher
  // temperature is sent because the docs say thinking mode ignores temperature.
  analysis: { thinking: true, effort: "max", json: true, minCeiling: 65_536 },
};

/** The documented provider fields one task class sends, minus model/messages/stream. */
export interface CapabilityRequest {
  thinking: { type: "enabled" | "disabled" };
  reasoning_effort?: ReasoningEffort;
  temperature?: number;
  max_tokens: number;
  response_format?: { type: "json_object" };
}

/**
 * The request fragment for one task class.
 *
 * `max_tokens` is a runaway ceiling, never a target: it grows with the source (through
 * budget.ts) and never drops below the class minimum, but it also never exceeds the
 * documented provider bound. A cap below what the answer needs is a truncation defect.
 */
export function capabilityRequest(profile: TaskProfile, chars: number): CapabilityRequest {
  const spec = PROFILES[profile];
  const ceiling = Math.max(outputTokenBudget(chars, spec.json), spec.minCeiling);
  const request: CapabilityRequest = {
    thinking: { type: spec.thinking ? "enabled" : "disabled" },
    max_tokens: Math.min(MAX_OUTPUT_TOKENS, ceiling),
  };
  if (spec.json) request.response_format = { type: "json_object" };
  if (spec.thinking) {
    if (spec.effort) request.reasoning_effort = spec.effort;
  } else if (spec.temperature !== undefined) {
    request.temperature = spec.temperature;
  }
  return request;
}

/**
 * Long input: one request or a loud failure, never a silent truncation.
 *
 * The documented context is 1M tokens; the app's own request schemas cap a translation at
 * 5,000 characters and every enrichment prompt at well under 20,000 characters. Even the
 * pessimistic 3-tokens-per-character bound leaves more than 60× headroom, so splitting a
 * source would add ordering, paragraph-boundary and term-consistency risks for an input
 * that cannot exist. This guard is the documented alternative: anything that cannot fit is
 * an `input` provider error before a byte is sent.
 */
export function assertContextFits(inputChars: number, maxOutputTokens: number): void {
  const estimated =
    Math.ceil(Math.max(0, inputChars) * TOKENS_PER_CHAR) + PROMPT_OVERHEAD_TOKENS + maxOutputTokens;
  if (estimated > CONTEXT_WINDOW_TOKENS) {
    throw new TranslationError("input", "The source is too long for the model's context window.");
  }
}
