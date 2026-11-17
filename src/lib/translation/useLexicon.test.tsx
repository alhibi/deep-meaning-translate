import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.fn();
vi.mock("../native/rpc", () => ({ callLexicon: (...args: unknown[]) => lookup(...args) }));
const { useLexicon } = await import("./useLexicon");
const { enqueueEnrichment, resetEnrichmentQueueForTests } = await import("./enrichment");

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
afterEach(() => {
  resetEnrichmentQueueForTests(0);
  vi.useRealTimers();
});

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

  it("treats the register as part of the cached identity", async () => {
    lookup.mockImplementation(({ data }) =>
      Promise.resolve({ ok: true, lexicon: entry(data.text) }),
    );
    const { result, rerender } = renderHook((p) => useLexicon(p), {
      initialProps: { ...opts("bank"), style: "natural" as "natural" | "formal" | "casual" },
    });
    await flush(400);
    expect(result.current.lexicon?.sourceTerm).toBe("bank");
    rerender({ ...opts("bank"), style: "formal" as "natural" | "formal" | "casual" });
    await flush(400);
    // A result for "natural" must not answer for "formal": the register is part of the key.
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("cuts long translation context at a whole character, never through an emoji", async () => {
    lookup.mockResolvedValue({ ok: true, lexicon: null });
    const translation = "a".repeat(199) + "\u{1F600}";
    renderHook((p) => useLexicon(p), {
      initialProps: { ...opts("Bank"), translation },
    });
    await flush(400);
    const sent = lookup.mock.calls[0]?.[0]?.data?.translation as string;
    // A UTF-16 slice returned 199 "a" + half of the emoji pair; the server then received
    // an invalid lone surrogate instead of the word context.
    expect(sent).not.toMatch(/[\uD800-\uDBFF]$/);
    expect([...sent]).toHaveLength(200);
    expect([...sent].at(-1)).toBe("\u{1F600}");
  });

  it("aborts the running lookup's transport when the screen goes away", async () => {
    resetEnrichmentQueueForTests(0, 5_000);
    lookup.mockImplementation(
      () =>
        new Promise(() => {
          // a provider that never answers: only the forwarded signal can stop it
        }),
    );
    const { unmount } = renderHook((p) => useLexicon(p), { initialProps: opts("sorcerer") });
    await flush(300);
    expect(lookup).toHaveBeenCalledTimes(1);
    const forwarded = lookup.mock.calls[0]![0].signal as AbortSignal | undefined;
    // The queue hands its task a signal; the hook must forward it to the transport
    // instead of dropping it (TD38: cancellation reached the queue, not the wire).
    expect(forwarded).toBeInstanceOf(AbortSignal);
    expect(forwarded!.aborted).toBe(false);
    unmount();
    expect(forwarded!.aborted).toBe(true);
  });

  it("joins an identical in-flight lookup instead of paying twice", async () => {
    resetEnrichmentQueueForTests(0, 5_000);
    lookup.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, lexicon: entry("sorcerer") }), 20);
        }),
    );
    const first = renderHook((p) => useLexicon(p), { initialProps: opts("sorcerer") });
    const second = renderHook((p) => useLexicon(p), { initialProps: opts("sorcerer") });
    await flush(400);
    // Two mounted hooks, one semantic request identity: one wire call.
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(first.result.current.lexicon?.sourceTerm).toBe("sorcerer");
    expect(second.result.current.lexicon?.sourceTerm).toBe("sorcerer");
  });

  it("cancels a queued lookup when the hook unmounts, before any request", async () => {
    resetEnrichmentQueueForTests(0, 5_000);
    let releaseBlocker: () => void = () => {};
    const blocker = enqueueEnrichment(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve)),
    );
    await flush(10); // the shared door is busy
    lookup.mockResolvedValue({ ok: true, lexicon: entry("sorcerer") });
    const { unmount } = renderHook((p) => useLexicon(p), {
      initialProps: opts("sorcerer"),
    });
    await flush(300); // the hook queued its lookup behind the blocker
    expect(lookup).not.toHaveBeenCalled();
    unmount();
    releaseBlocker();
    await blocker;
    await flush(100);
    // Nothing was spent on a dictionary entry for a screen that is gone.
    expect(lookup).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not leave its debounce timer behind on unmount", async () => {
    lookup.mockResolvedValue({ ok: true, lexicon: null });
    const { unmount } = renderHook((p) => useLexicon(p), { initialProps: opts("sorcerer") });
    await flush(100); // the 260 ms dictionary delay is still pending
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isolates a dictionary failure: no value, no loading, no throw", async () => {
    lookup.mockRejectedValue(new Error("provider down"));
    const { result } = renderHook((p) => useLexicon(p), { initialProps: opts("bank") });
    await flush(400);
    expect(result.current.lexicon).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("distinguishes a failed lookup from a term with no reading", async () => {
    lookup.mockRejectedValue(new Error("provider down"));
    const { result } = renderHook((p) => useLexicon(p), { initialProps: opts("bank") });
    await flush(400);
    expect(result.current.failed).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.lexicon).toBeNull();
  });

  it("clears the failure on a later success and on a later cached hit", async () => {
    lookup
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce({ ok: true, lexicon: entry("wizard") })
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce({ ok: true, lexicon: entry("wizard") });
    const { result, rerender } = renderHook((p) => useLexicon(p), {
      initialProps: opts("bank"),
    });
    await flush(400);
    expect(result.current.failed).toBe(true);
    rerender(opts("wizard"));
    await flush(400);
    expect(result.current.failed).toBe(false);
    expect(result.current.lexicon?.sourceTerm).toBe("wizard");
    rerender(opts("ghost"));
    await flush(400);
    expect(result.current.failed).toBe(true);
    // Back to the term that already has a cached reading: the failure state is gone even
    // though no request is made.
    rerender(opts("wizard"));
    await flush(400);
    expect(result.current.failed).toBe(false);
    expect(result.current.lexicon?.sourceTerm).toBe("wizard");
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("never paints a failure for a superseded lookup", async () => {
    let rejectOld: (reason: unknown) => void = () => {};
    lookup
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject;
          }),
      )
      .mockResolvedValueOnce({ ok: true, lexicon: entry("wizard") });
    const { result, rerender } = renderHook((p) => useLexicon(p), {
      initialProps: opts("bank"),
    });
    await flush(300); // the first lookup is in flight
    rerender(opts("wizard"));
    await flush(300); // the replacement succeeds
    rejectOld(new Error("late provider failure"));
    await flush(20);
    expect(result.current.failed).toBe(false);
    expect(result.current.lexicon?.sourceTerm).toBe("wizard");
  });

  it("keeps the cache bounded and evicts the least recently used entry", async () => {
    lookup.mockImplementation(({ data }) =>
      Promise.resolve({ ok: true, lexicon: entry(data.text) }),
    );
    const terms = Array.from({ length: 40 }, (_, i) => "word" + i);
    const { rerender } = renderHook((p) => useLexicon(p), { initialProps: opts(terms[0]!) });
    for (let i = 0; i < terms.length; i++) {
      rerender(opts(terms[i]!));
      await flush(300);
    }
    expect(lookup).toHaveBeenCalledTimes(40);
    // Touch the first-inserted entry: it is now the most recently used.
    rerender(opts(terms[0]!));
    await flush(300);
    expect(lookup).toHaveBeenCalledTimes(40);
    // One more unique word must evict the least recently used (word1), not word0.
    rerender(opts("newword"));
    await flush(300);
    expect(lookup).toHaveBeenCalledTimes(41);
    rerender(opts(terms[0]!));
    await flush(300);
    expect(lookup).toHaveBeenCalledTimes(41);
    rerender(opts(terms[1]!));
    await flush(300);
    expect(lookup).toHaveBeenCalledTimes(42);
  });
});
