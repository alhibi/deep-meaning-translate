import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LexiconResult } from "./lexicon";

const lookup = vi.fn();
vi.mock("../native/rpc", () => ({ callLexicon: (...args: unknown[]) => lookup(...args) }));
const { useLexicon } = await import("./useLexicon");
const { resetEnrichmentQueueForTests } = await import("./enrichment");

const entry = (sourceTerm: string): LexiconResult => ({
  source: "model",
  sourceTerm,
  sourceLanguage: "en",
  targetLanguage: "ar",
  translation: "",
  entries: [
    {
      term: "ضفة",
      lemma: "",
      partOfSpeech: "noun",
      meanings: ["ضفة النهر"],
      definition: "",
      example: "",
      exampleTranslation: "",
      primary: true,
      forms: [],
      synonyms: [],
      frequency: 0.5,
      register: "",
      variety: "",
      collocations: [],
      examples: [],
      nuances: [],
      pronunciation: "",
    },
  ],
});

type Options = Parameters<typeof useLexicon>[0];
const opts = (overrides: Partial<Options> = {}): Options => ({
  text: "bank",
  source: "en",
  target: "ar",
  uiLocale: "en",
  settled: true,
  ...overrides,
});
const flush = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const sentPayload = (index: number) =>
  lookup.mock.calls[index]?.[0]?.data as Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  lookup.mockReset();
  resetEnrichmentQueueForTests(0, 250);
});
afterEach(() => {
  resetEnrichmentQueueForTests(0);
  vi.useRealTimers();
});

/**
 * The cache is the only thing that makes the dictionary feel instant. Its identity must
 * include every input that changes the reading — direction, register, variety, the model
 * translation and now the full sentence context — and the data-model version, or a stale
 * reading answers under a different question.
 */
describe("useLexicon request identity", () => {
  it("sends the full sentence and treats it as part of the cache identity", async () => {
    lookup.mockImplementation(({ data }: { data: { context?: string; text: string } }) =>
      Promise.resolve({ ok: true, lexicon: entry(data.context ?? data.text) }),
    );
    const { result, rerender } = renderHook((p) => useLexicon(p), {
      initialProps: opts({ context: "He sat on the bank of the river." }),
    });
    await flush(400);
    expect(sentPayload(0)?.["context"]).toBe("He sat on the bank of the river.");
    expect(result.current.lexicon?.sourceTerm).toBe("He sat on the bank of the river.");

    rerender(opts({ context: "She works at the bank downtown." }));
    await flush(400);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(result.current.lexicon?.sourceTerm).toBe("She works at the bank downtown.");

    // The first sentence is remembered as its own identity, not overwritten by the second.
    rerender(opts({ context: "He sat on the bank of the river." }));
    await flush(400);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(result.current.lexicon?.sourceTerm).toBe("He sat on the bank of the river.");
  });

  it("does not send or duplicate a context that is only the term itself", async () => {
    lookup.mockResolvedValue({ ok: true, lexicon: entry("bank") });
    const { rerender } = renderHook((p) => useLexicon(p), {
      initialProps: opts({ context: "  bank " }),
    });
    await flush(400);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(sentPayload(0)?.["context"]).toBeUndefined();
    rerender(opts());
    await flush(400);
    // Same identity as "no context": the sentence added no information.
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("sends the register and treats it as part of the cache identity", async () => {
    lookup.mockResolvedValue({ ok: true, lexicon: null });
    const { rerender } = renderHook((p) => useLexicon(p), {
      initialProps: opts({ style: "natural" }),
    });
    await flush(400);
    expect(sentPayload(0)?.["style"]).toBe("natural");
    rerender(opts({ style: "formal" }));
    await flush(400);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(sentPayload(1)?.["style"]).toBe("formal");
  });

  it("keeps the direction in the identity", async () => {
    lookup.mockResolvedValue({ ok: true, lexicon: null });
    const { rerender } = renderHook((p) => useLexicon(p), { initialProps: opts() });
    await flush(400);
    rerender(opts({ target: "de" }));
    await flush(400);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(sentPayload(1)?.["target"]).toBe("de");
  });

  it("adds the Arabic variety for Arabic target and forces it neutral otherwise", async () => {
    lookup.mockResolvedValue({ ok: true, lexicon: null });
    const { rerender } = renderHook((p) => useLexicon(p), {
      initialProps: opts({ dialect: "levant" }),
    });
    await flush(400);
    expect(sentPayload(0)?.["dialect"]).toBe("levant");
    rerender(opts({ dialect: "auto" }));
    await flush(400);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(sentPayload(1)?.["dialect"]).toBe("auto");
    rerender(opts({ target: "de", dialect: "levant" }));
    await flush(400);
    expect(sentPayload(2)?.["dialect"]).toBe("auto");
  });

  it("cuts the sentence at a whole character, never through an emoji", async () => {
    lookup.mockResolvedValue({ ok: true, lexicon: null });
    const context = "a".repeat(399) + "\u{1F600}" + "tail";
    renderHook((p) => useLexicon(p), { initialProps: opts({ context }) });
    await flush(400);
    const sent = sentPayload(0)?.["context"] as string;
    expect([...sent]).toHaveLength(400);
    expect([...sent].at(-1)).toBe("\u{1F600}");
    expect(sent).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});
