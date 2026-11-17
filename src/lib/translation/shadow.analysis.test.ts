// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAnalysis } = vi.hoisted(() => ({ runAnalysis: vi.fn() }));
vi.mock("./engine.server", () => ({ runAnalysis }));

const { analyzeShadowFor } = await import("./shadow.functions");
const { capabilityRequest } = await import("./providers/capabilities");
const {
  SHADOW_ANALYSIS_MAX_OUTPUT_TOKENS,
  SHADOW_DEADLINE_MS,
  SHADOW_MAX_OUTPUT_TOKENS,
  SHADOW_MAX_PROMPT_CHARS,
  SHADOW_MAX_REQUESTS,
  planShadowAnalysis,
  planShadowWindows,
  shadowUserPrompt,
  SHADOW_SYSTEM,
} = await import("./shadow");

/** "Satz nummer N ist gut." — 40 sentences plan into two windows (about 960 chars). */
const paragraph = (count: number) =>
  Array.from({ length: count }, (_value, index) => `Satz nummer ${index + 1} ist gut.`).join(" ");

const request = () =>
  new Request("https://app.example/api/shadow", { method: "POST", headers: {} });

const base = {
  source: "de",
  target: "ar",
  style: "natural" as const,
  uiLocale: "en" as const,
};

/** A valid single-finding reply for the window whose prompt carries `quote`. */
const replyFor = (quote: string) =>
  JSON.stringify({
    losses: [
      {
        kind: "loss",
        category: "warmth",
        severity: 2,
        confidence: 0.9,
        source_quote: quote,
        target_quote: quote,
        explanation: "e",
      },
    ],
  });

beforeEach(() => {
  runAnalysis.mockReset();
});

describe("planning a bounded analysis", () => {
  it("never plans more requests than the documented cap", () => {
    // 200 sentences ≈ 4,700 characters: just under the 5,000-character source bound.
    const source = paragraph(200);
    const plan = planShadowAnalysis({ ...base, text: source, translation: source });
    expect(plan.requests).toBeLessThanOrEqual(SHADOW_MAX_REQUESTS);
    expect(plan.requests).toBe(plan.windows.length);
    expect(plan.requests).toBeGreaterThan(0);
  });

  it("keeps the total prompt characters inside the explicit budget", () => {
    const source = paragraph(300).slice(0, 4_900);
    // The schema allows a 15,000-character translation for a 5,000-character source:
    // every window repeats the whole translation, so this is the worst real cost.
    const translation = "كلمة ".repeat(3_000).slice(0, 15_000);
    const plan = planShadowAnalysis({ ...base, text: source, translation });
    expect(plan.promptChars).toBeGreaterThan(0);
    expect(plan.promptChars).toBeLessThanOrEqual(SHADOW_MAX_PROMPT_CHARS);
    expect(plan.depthLimited).toBe(true);
    expect(plan.requests).toBeLessThan(planShadowWindows(source).length);

    // The plan's character count is exactly what the requests would send.
    const measured = plan.windows.reduce((sum, window) => {
      const prompt = shadowUserPrompt({
        ...base,
        text: window.text,
        translation,
        part: { index: window.index + 1, total: plan.requests },
        contextBefore: window.contextBefore || undefined,
        contextAfter: window.contextAfter || undefined,
      });
      return sum + SHADOW_SYSTEM.length + prompt.length;
    }, 0);
    expect(plan.promptChars).toBe(measured);
  });

  it("keeps a short text at one request and never marks it depth-limited", () => {
    const text = "Das ist ein kurzer Satz.";
    const plan = planShadowAnalysis({ ...base, text, translation: text });
    expect(plan.requests).toBe(1);
    expect(plan.depthLimited).toBe(false);
  });

  it("refuses to plan anything when even one request exceeds the budget", () => {
    const plan = planShadowAnalysis({
      ...base,
      text: paragraph(3),
      translation: paragraph(3),
      maxPromptChars: 100,
    });
    expect(plan.requests).toBe(0);
    expect(plan.windows).toEqual([]);
  });

  it("declares the analysis-profile output ceiling it budgets against", () => {
    expect(SHADOW_ANALYSIS_MAX_OUTPUT_TOKENS).toBe(capabilityRequest("analysis", 0).max_tokens);
    expect(SHADOW_MAX_OUTPUT_TOKENS).toBe(SHADOW_MAX_REQUESTS * SHADOW_ANALYSIS_MAX_OUTPUT_TOKENS);
    expect(SHADOW_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(262_144);
  });
});

describe("per-window failure isolation", () => {
  const source = paragraph(40);
  const translation = source;
  const windows = planShadowWindows(source);
  const quoteIn = (windowIndex: number) => {
    const window = windows[windowIndex]!;
    return /^[^.]*\./u.exec(window.text.trim())![0]!;
  };

  it("keeps the findings of the windows that answered and says the analysis is incomplete", async () => {
    const good = quoteIn(0);
    runAnalysis.mockImplementation(async (_system: string, prompt: string) => {
      if (prompt.includes("PART 1 of ")) return replyFor(good);
      throw new Error("provider down");
    });
    const result = await analyzeShadowFor(
      { ...base, text: source, translation },
      { request: request() },
    );
    // The old all-or-nothing path returned null and threw away the good window.
    expect(result).not.toBeNull();
    expect(result!.losses.length).toBeGreaterThan(0);
    expect(result!.incomplete).toMatchObject({
      requests: windows.length,
      completed: windows.length - 1,
      reasons: ["provider"],
    });
  });

  it("reports an unreadable reply as an invalid window, never as nothing lost", async () => {
    runAnalysis.mockImplementation(async (_system: string, prompt: string) => {
      if (prompt.includes("PART 1 of ")) return replyFor(quoteIn(0));
      return "not json";
    });
    const result = await analyzeShadowFor(
      { ...base, text: source, translation },
      { request: request() },
    );
    expect(result!.incomplete?.reasons).toEqual(["invalid_reply"]);
  });

  it("stays null when no window answered: a partial result needs one real finding", async () => {
    runAnalysis.mockRejectedValue(new Error("provider down"));
    expect(
      await analyzeShadowFor({ ...base, text: source, translation }, { request: request() }),
    ).toBeNull();
  });

  it("a complete analysis carries no incomplete marker (backward-compatible result)", async () => {
    runAnalysis.mockImplementation(async (_system: string, prompt: string) =>
      prompt.includes("PART 1 of ") ? replyFor(quoteIn(0)) : JSON.stringify({ losses: [] }),
    );
    const result = await analyzeShadowFor(
      { ...base, text: source, translation },
      { request: request() },
    );
    expect(result!.losses.length).toBeGreaterThan(0);
    expect("incomplete" in result!).toBe(false);
  });
});

describe("cancellation and time bound", () => {
  it("propagates a caller abort to every provider call", async () => {
    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    runAnalysis.mockImplementation(
      async (_system: string, _prompt: string, options: { signal?: AbortSignal }) => {
        const signal = options.signal!;
        seen.push(signal);
        // Abort the caller from inside the first request; later windows must see it too.
        controller.abort();
        if (signal.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
        return JSON.stringify({ losses: [] });
      },
    );
    const result = await analyzeShadowFor(
      { ...base, text: paragraph(40), translation: paragraph(40) },
      { request: request() },
      { signal: controller.signal },
    );
    expect(result).toBeNull();
    expect(runAnalysis.mock.calls.length).toBeLessThanOrEqual(
      planShadowWindows(paragraph(40)).length,
    );
    for (const signal of seen) expect(signal.aborted).toBe(true);
  });

  it("uses the incoming request's abort signal as caller cancellation", async () => {
    const controller = new AbortController();
    const incoming = new Request("https://app.example/api/shadow", {
      method: "POST",
      signal: controller.signal,
    });
    const seen: AbortSignal[] = [];
    runAnalysis.mockImplementation(
      async (_system: string, _prompt: string, options: { signal?: AbortSignal }) => {
        seen.push(options.signal!);
        controller.abort();
        throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      },
    );
    const result = await analyzeShadowFor(
      { ...base, text: paragraph(40), translation: paragraph(40) },
      { request: incoming },
    );
    expect(result).toBeNull();
    expect(seen.length).toBeGreaterThan(0);
    for (const signal of seen) expect(signal.aborted).toBe(true);
  });

  it("returns within the analysis deadline even when a provider never answers", async () => {
    const hanging: AbortSignal[] = [];
    runAnalysis.mockImplementation(
      (_system: string, _prompt: string, options: { signal?: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          hanging.push(options.signal!);
          options.signal!.addEventListener("abort", () =>
            reject(Object.assign(new Error("timeout"), { name: "AbortError" })),
          );
        }),
    );
    const started = Date.now();
    const result = await analyzeShadowFor(
      { ...base, text: paragraph(40), translation: paragraph(40) },
      { request: request() },
      { deadlineMs: 30 },
    );
    const elapsed = Date.now() - started;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(2_000);
    expect(hanging.length).toBeGreaterThan(0);
    for (const signal of hanging) expect(signal.aborted).toBe(true);
  });

  it("classifies a deadline hit as a timeout on the windows that did answer", async () => {
    let call = 0;
    runAnalysis.mockImplementation(
      (_system: string, _prompt: string, options: { signal?: AbortSignal }) => {
        call += 1;
        if (call === 1) {
          const window = planShadowWindows(paragraph(40))[0]!;
          const quote = /^[^.]*\./u.exec(window.text.trim())![0]!;
          return Promise.resolve(replyFor(quote));
        }
        return new Promise<string>((_resolve, reject) => {
          options.signal!.addEventListener("abort", () =>
            reject(Object.assign(new Error("timeout"), { name: "AbortError" })),
          );
        });
      },
    );
    const result = await analyzeShadowFor(
      { ...base, text: paragraph(40), translation: paragraph(40) },
      { request: request() },
      { deadlineMs: 30 },
    );
    expect(result).not.toBeNull();
    expect(result!.losses.length).toBe(1);
    expect(result!.incomplete?.reasons).toEqual(["timeout"]);
  });

  it("exposes the default whole-analysis deadline constant", () => {
    expect(SHADOW_DEADLINE_MS).toBeGreaterThan(0);
    expect(SHADOW_DEADLINE_MS).toBeLessThanOrEqual(45_000);
  });
});

describe("budget enforcement at the request boundary", () => {
  it("spends no request when the budget cannot fit one", async () => {
    const result = await analyzeShadowFor(
      { ...base, text: paragraph(3), translation: paragraph(3) },
      { request: request() },
      { maxPromptChars: 100 },
    );
    expect(result).toBeNull();
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("sizes every request from its window plus the whole translation", async () => {
    const source = paragraph(40);
    const translation = source;
    runAnalysis.mockResolvedValue(JSON.stringify({ losses: [] }));
    await analyzeShadowFor({ ...base, text: source, translation }, { request: request() });
    const windows = planShadowWindows(source);
    expect(runAnalysis).toHaveBeenCalledTimes(windows.length);
    runAnalysis.mock.calls.forEach((call, index) => {
      const options = call[2] as { chars?: number };
      expect(options.chars).toBe(windows[index]!.text.length + translation.length);
    });
  });
});
