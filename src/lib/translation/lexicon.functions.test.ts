// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAnalysis } = vi.hoisted(() => ({ runAnalysis: vi.fn() }));
vi.mock("./engine.server", () => ({ runAnalysis }));

const { analyzeLexiconFor, LexiconInput } = await import("./lexicon.functions");

const reply = JSON.stringify({
  sourceTerm: "bank",
  sourceLanguage: "en",
  targetLanguage: "ar",
  translation: "بنك",
  entries: [
    {
      term: "بنك",
      lemma: "bank",
      partOfSpeech: "noun",
      meanings: ["مصرف", "بنك"],
      definition: "مؤسسة مالية",
      primary: true,
      frequency: 0.9,
    },
  ],
});

let address = 0;
const query = {
  text: "bank",
  source: "en",
  target: "ar",
  uiLocale: "en" as const,
  context: "He sat on the bank of the river.",
  style: "formal" as const,
  dialect: "levant" as const,
};
const request = () =>
  new Request("https://app.test/_serverFn/lexicon", {
    method: "POST",
    headers: { "x-forwarded-for": `lexicon-test-${address++}`, origin: "https://app.test" },
  });

beforeEach(() => {
  runAnalysis.mockReset();
  runAnalysis.mockResolvedValue(reply);
});

describe("analyzeLexiconFor", () => {
  it("runs the shared analysis, echoes the request context and marks the source", async () => {
    const lexicon = await analyzeLexiconFor(query, { request: request() });
    expect(lexicon?.source).toBe("model");
    expect(lexicon?.entries[0]?.term).toBe("بنك");
    expect(lexicon?.style).toBe("formal");
    expect(lexicon?.dialect).toBe("levant");
    expect(lexicon?.context).toBe("He sat on the bank of the river.");
    // The prompt and parser are the module pair, never a provider string.
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    const [system, user, options] = runAnalysis.mock.calls[0]!;
    expect(system).toContain("multilingual lexicographer");
    expect(user).toContain("Direction: en→ar");
    expect(user).toContain("<term>\nbank\n</term>");
    expect(user).toContain("<sentence>\nHe sat on the bank of the river.\n</sentence>");
    expect(options).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal), chars: expect.any(Number) }),
    );
  });

  it("refuses prose before spending a request", async () => {
    const lexicon = await analyzeLexiconFor(
      { ...query, text: "Can you help me tomorrow?" },
      { request: request() },
    );
    expect(lexicon).toBeNull();
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin browser call before spending a request", async () => {
    const crossSite = new Request("https://app.test/_serverFn/lexicon", {
      method: "POST",
      headers: { origin: "https://evil.test", "x-forwarded-for": "lexicon-test-cross" },
    });
    expect(await analyzeLexiconFor(query, { request: crossSite })).toBeNull();
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("skips the browser same-origin check for the installed app's gated transport", async () => {
    const native = new Request("https://worker.test/api/native/v1/lexicon", {
      method: "POST",
      headers: { origin: "https://localhost", "x-forwarded-for": "lexicon-test-native" },
    });
    expect(await analyzeLexiconFor(query, { request: native, crossOrigin: true })).not.toBeNull();
  });

  it("turns an analysis failure into a quiet null", async () => {
    runAnalysis.mockRejectedValue(new Error("provider down"));
    expect(await analyzeLexiconFor(query, { request: request() })).toBeNull();
  });
});

describe("LexiconInput", () => {
  it("accepts the widening fields but stays strict about shapes", () => {
    expect(LexiconInput.safeParse(query).success).toBe(true);
    expect(LexiconInput.safeParse({ ...query, style: undefined, context: undefined }).success).toBe(
      true,
    );
    // Unknown fields are rejected: the transport contract is exact.
    expect(LexiconInput.safeParse({ ...query, extra: "x" }).success).toBe(false);
    expect(LexiconInput.safeParse({ ...query, style: "poetic" }).success).toBe(false);
    expect(LexiconInput.safeParse({ ...query, dialect: "mars" }).success).toBe(false);
    expect(LexiconInput.safeParse({ ...query, uiLocale: "fr" }).success).toBe(false);
  });

  it("bounds the body before the semantic gate runs, counting a character once", () => {
    // zod v4 counts code points, so an astral character is one unit and a term of 96
    // astral code points is accepted by the transport bound.
    expect(LexiconInput.safeParse({ ...query, text: "😀".repeat(101) }).success).toBe(true);
    expect(LexiconInput.safeParse({ ...query, text: "a".repeat(201) }).success).toBe(false);
    expect(LexiconInput.safeParse({ ...query, context: "x".repeat(801) }).success).toBe(false);
    expect(LexiconInput.safeParse({ ...query, translation: "x".repeat(401) }).success).toBe(false);
  });
});

describe("lexicon cancellation", () => {
  const requestWithSignal = (signal: AbortSignal) =>
    new Request("https://app.test/_serverFn/lexicon", {
      method: "POST",
      headers: { "x-forwarded-for": `lexicon-test-${address++}`, origin: "https://app.test" },
      signal,
    });

  it("returns null without a provider request when the caller is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await analyzeLexiconFor(query, { request: request() }, { signal: controller.signal }),
    ).toBeNull();
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("aborts the provider call when the caller's signal aborts mid-analysis", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    runAnalysis.mockImplementation((_system, _user, options) => {
      seen = options.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        seen?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
    });
    const pending = analyzeLexiconFor(query, { request: request() }, { signal: controller.signal });
    await vi.waitFor(() => expect(runAnalysis).toHaveBeenCalledTimes(1));
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
    controller.abort();
    expect(await pending).toBeNull();
    expect(seen?.aborted).toBe(true);
  });

  it("defaults to the incoming request's own signal (native and web transports)", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    runAnalysis.mockImplementation((_system, _user, options) => {
      seen = options.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        seen?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
    });
    const pending = analyzeLexiconFor(query, {
      request: requestWithSignal(controller.signal),
      crossOrigin: true,
    });
    await vi.waitFor(() => expect(runAnalysis).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toBeNull();
    expect(seen?.aborted).toBe(true);
  });

  it("keeps the documented timeout when no caller signal exists", async () => {
    const lexicon = await analyzeLexiconFor(query, { request: request() });
    expect(lexicon).not.toBeNull();
    const [, , options] = runAnalysis.mock.calls[0]!;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});
