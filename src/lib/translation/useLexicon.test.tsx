import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.fn();
vi.mock("../native/rpc", () => ({ callLexicon: (...args: unknown[]) => lookup(...args) }));
const { useLexicon } = await import("./useLexicon");
const { resetEnrichmentQueueForTests } = await import("./enrichment");

const entry = (sourceTerm: string) => ({
  sourceTerm,
  sourceLanguage: "en",
  targetLanguage: "ar",
  entries: [
    {
      term: "ساحر",
      partOfSpeech: "noun" as const,
      meanings: ["مشعوذ"],
      definition: "",
      example: "",
      exampleTranslation: "",
      primary: true,
      forms: [],
      synonyms: [],
      frequency: 1,
      register: "",
    },
  ],
});
const opts = (text: string, settled = true) => ({
  text,
  source: "en",
  target: "ar",
  uiLocale: "ar" as const,
  settled,
});
const flush = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  lookup.mockReset();
  // Quiet work goes through a shared queue; each test starts from an empty one.
  resetEnrichmentQueueForTests(0, 250);
});
afterEach(() => vi.useRealTimers());

describe("useLexicon", () => {
  it("uses translation context in lookup identity and cache", async () => {
    lookup.mockImplementation(({ data }) =>
      Promise.resolve({ ok: true, lexicon: entry(data.translation) }),
    );
    const { result, rerender } = renderHook((p) => useLexicon(p), {
      initialProps: { ...opts("bank"), translation: "مصرف" },
    });
    await flush(400);
    rerender({ ...opts("bank"), translation: "ضفة" });
    await flush(400);
    expect(result.current.lexicon?.sourceTerm).toBe("ضفة");
    expect(lookup).toHaveBeenCalledTimes(2);
    rerender({ ...opts("bank"), translation: "مصرف" });
    await flush(400);
    expect(result.current.lexicon?.sourceTerm).toBe("مصرف");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("waits for a settled short term and skips sentences", async () => {
    lookup.mockResolvedValue({ ok: true, lexicon: entry("sorcerer") });
    const { result, rerender } = renderHook((p) => useLexicon(p), {
      initialProps: opts("sorcerer", false),
    });
    await flush(400);
    expect(lookup).not.toHaveBeenCalled();
    rerender(opts("sorcerer"));
    await flush(400);
    expect(result.current.lexicon?.sourceTerm).toBe("sorcerer");
    rerender(opts("Can you help me tomorrow?"));
    await flush(400);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(result.current.lexicon).toBeNull();
  });

  it("never lets an older lookup appear under newer text", async () => {
    let finishOld: (value: unknown) => void = () => {};
    lookup
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true, lexicon: entry("wizard") });
    const { result, rerender } = renderHook((p) => useLexicon(p), {
      initialProps: opts("sorcerer"),
    });
    await flush(300);
    rerender(opts("wizard"));
    await flush(300);
    expect(result.current.lexicon?.sourceTerm).toBe("wizard");
    finishOld({ ok: true, lexicon: entry("sorcerer") });
    await flush(10);
    expect(result.current.lexicon?.sourceTerm).toBe("wizard");
  });
});
