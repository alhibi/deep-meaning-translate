import { describe, expect, it } from "vitest";
import {
  CONTEXT_WINDOW_TOKENS,
  MAX_OUTPUT_TOKENS,
  PROMPT_OVERHEAD_TOKENS,
  TOKENS_PER_CHAR,
  assertContextFits,
  capabilityRequest,
  type TaskProfile,
} from "./capabilities";
import { outputTokenBudget } from "../budget";
import { TranslationError } from "../types";

/**
 * The shape each task class sends is a capability claim. These tests pin it to the
 * documented DeepSeek API (see capabilities.ts for the URLs and access date) and to the
 * product rule that a ceiling is a runaway guard, never a clamp under a real answer.
 */
describe("documented deepseek-flash capability profiles", () => {
  it("keeps the live path non-thinking, plain text and exactly as cheap as before", () => {
    const request = capabilityRequest("live", 5_000);
    // Thinking defaults ON in the API, so a disabled live request must say so explicitly.
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.temperature).toBe(0.3);
    expect(request.reasoning_effort).toBeUndefined();
    expect(request.response_format).toBeUndefined();
    expect(request.max_tokens).toBe(7_500);
    expect(request.max_tokens).toBe(outputTokenBudget(5_000, false));
  });

  it("keeps the settled full answer non-thinking JSON at its existing ceiling", () => {
    const request = capabilityRequest("full", 5_000);
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.temperature).toBe(0.3);
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.max_tokens).toBe(13_000);
    expect(request.max_tokens).toBe(outputTokenBudget(5_000, true));
  });

  it("allows deeper documented reasoning for repair and review, without clamping the answer", () => {
    for (const profile of ["repair", "review"] as const) {
      const request = capabilityRequest(profile, 5_000);
      expect(request.thinking).toEqual({ type: "enabled" });
      expect(request.reasoning_effort).toBe("high");
      // The docs say thinking mode ignores temperature: not pretending otherwise.
      expect(request.temperature).toBeUndefined();
      expect(request.response_format).toEqual({ type: "json_object" });
      // A 5,000-character structured answer needs 13,000 plain tokens; reasoning shares the
      // generation, so the ceiling must sit above that.
      expect(request.max_tokens).toBe(32_768);
      expect(request.max_tokens).toBeGreaterThan(outputTokenBudget(5_000, true));
    }
  });

  it("gives dictionary/shadow analysis the deepest effort and a ceiling above a plain answer", () => {
    const request = capabilityRequest("analysis", 1_900);
    expect(request.thinking).toEqual({ type: "enabled" });
    expect(request.reasoning_effort).toBe("max");
    expect(request.temperature).toBeUndefined();
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.max_tokens).toBe(65_536);
    expect(request.max_tokens).toBeGreaterThan(outputTokenBudget(1_900, true));
  });

  it("never lowers a translation ceiling and never exceeds the documented provider bound", () => {
    const profiles: TaskProfile[] = ["live", "full", "repair", "review", "analysis"];
    for (const profile of profiles) {
      for (let chars = 0; chars <= 7_000; chars += 251) {
        const request = capabilityRequest(profile, chars);
        const json = request.response_format !== undefined;
        expect(request.max_tokens).toBeGreaterThanOrEqual(outputTokenBudget(chars, json));
        expect(request.max_tokens).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
        expect(request.max_tokens).toBeGreaterThan(0);
      }
    }
  });
});

describe("long input: one request or a loud failure", () => {
  it("accepts the app's bounded translation input with more than 60x headroom", () => {
    // 5,000 characters is the request schema's cap; the documented context is 1M tokens.
    expect(() => assertContextFits(5_000, 16_384)).not.toThrow();
    expect(() => assertContextFits(20_000, 65_536)).not.toThrow();
    expect(CONTEXT_WINDOW_TOKENS / (5_000 * TOKENS_PER_CHAR)).toBeGreaterThan(60);
  });

  it("draws the boundary at the documented context, not at an arbitrary truncation point", () => {
    const output = 65_536;
    const available = CONTEXT_WINDOW_TOKENS - PROMPT_OVERHEAD_TOKENS - output;
    const maxChars = Math.floor(available / TOKENS_PER_CHAR);
    expect(() => assertContextFits(maxChars, output)).not.toThrow();
    expect(() => assertContextFits(maxChars + 1, output)).toThrow(TranslationError);
  });

  it("classifies an oversized source as an input error instead of truncating it", () => {
    const error = (() => {
      try {
        assertContextFits(400_000, 65_536);
        return null;
      } catch (caught) {
        return caught as TranslationError;
      }
    })();
    expect(error).toBeInstanceOf(TranslationError);
    expect(error?.kind).toBe("input");
    // The message is shown as calm product copy upstream: no tokens, counts or provider body.
    expect(error?.message).not.toMatch(/\d/);
  });
});
