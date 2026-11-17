// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAnalysis } = vi.hoisted(() => ({ runAnalysis: vi.fn() }));
vi.mock("./engine.server", () => ({ runAnalysis }));

const { analyzeShadowFor, ShadowInput } = await import("./shadow.functions");
const { planShadowWindows } = await import("./shadow");

/** "Satz nummer N ist gut." — unique sentences and a sentence boundary after each. */
const paragraph = (count: number) =>
  Array.from({ length: count }, (_value, index) => `Satz nummer ${index + 1} ist gut.`).join(" ");

const request = (origin?: string) =>
  new Request("https://app.example/api/shadow", {
    method: "POST",
    headers: origin ? { Origin: origin } : {},
  });

/** Extracts the first sentence of the <source_part> the prompt carries. */
const firstSentenceOfSourcePart = (prompt: string): string => {
  // The instruction text mentions <source_part> too; the tag that owns the text is the
  // one on its own line, so match the newline as well.
  const opener = "<source_part>\n";
  const start = prompt.indexOf(opener);
  if (start === -1) return "";
  const end = prompt.indexOf("</source_part>");
  const part = prompt.slice(start + opener.length, end).trim();
  const match = /^[^.]*\./u.exec(part);
  return match ? match[0] : part;
};

beforeEach(() => {
  runAnalysis.mockReset();
});

describe("ShadowInput", () => {
  const valid = {
    text: "Das ist ein ganzer Satz",
    translation: "Das ist ein ganzer Satz",
    source: "de",
    target: "ar",
    style: "natural",
    uiLocale: "en",
  };

  it("bounds the whole text at the draft limit and rejects blank input", () => {
    expect(ShadowInput.safeParse(valid).success).toBe(true);
    expect(ShadowInput.safeParse({ ...valid, text: "x".repeat(4000) }).success).toBe(true);
    expect(ShadowInput.safeParse({ ...valid, text: "x".repeat(5001) }).success).toBe(false);
    expect(ShadowInput.safeParse({ ...valid, text: "   " }).success).toBe(false);
    expect(ShadowInput.safeParse({ ...valid, translation: "" }).success).toBe(false);
    expect(ShadowInput.safeParse({ ...valid, translation: "x".repeat(15001) }).success).toBe(false);
  });
});

describe("analyzeShadowFor", () => {
  it("does not spend a call on a fragment that belongs to the dictionary", async () => {
    expect(
      await analyzeShadowFor(
        {
          text: "zwei Worte",
          translation: "zwei Worte",
          source: "de",
          target: "ar",
          style: "natural",
          uiLocale: "en",
        },
        { request: request() },
      ),
    ).toBeNull();
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("refuses a cross-site browser request before any provider call", async () => {
    expect(
      await analyzeShadowFor(
        {
          text: paragraph(2),
          translation: paragraph(2),
          source: "de",
          target: "ar",
          style: "natural",
          uiLocale: "en",
        },
        { request: request("https://evil.example") },
      ),
    ).toBeNull();
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("windows a long text, uses the analysis path and keeps global offsets", async () => {
    const source = paragraph(40);
    const windows = planShadowWindows(source);
    expect(windows.length).toBeGreaterThan(1);
    runAnalysis.mockImplementation(async (_system: string, prompt: string, _options: unknown) =>
      JSON.stringify({
        losses: [
          {
            kind: "loss",
            category: "warmth",
            severity: 2,
            confidence: 0.9,
            source_quote: firstSentenceOfSourcePart(prompt),
            target_quote: firstSentenceOfSourcePart(prompt),
            explanation: "e",
          },
        ],
      }),
    );
    const result = await analyzeShadowFor(
      {
        text: source,
        translation: source,
        source: "de",
        target: "ar",
        style: "natural",
        uiLocale: "en",
      },
      { request: request() },
    );
    expect(result).not.toBeNull();
    expect(runAnalysis).toHaveBeenCalledTimes(windows.length);
    const prompts = runAnalysis.mock.calls.map((call) => String(call[1]));
    prompts.forEach((prompt) => expect(prompt).toContain("PART "));
    // Every call is bounded by the analysis profile's timeout signal and input size.
    for (const call of runAnalysis.mock.calls) {
      const options = call[2] as { signal?: AbortSignal; chars?: number };
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.chars).toBeGreaterThan(0);
    }
    expect(result!.losses).toHaveLength(windows.length);
    for (const loss of result!.losses) {
      expect(source.slice(loss.source.start, loss.source.end)).toBe(loss.sourceQuote);
      expect(source.slice(loss.target.start, loss.target.end)).toBe(loss.targetQuote);
    }
  });

  it("keeps a short text in a single call and reports an honest nothing-lost", async () => {
    runAnalysis.mockResolvedValue(JSON.stringify({ losses: [] }));
    const result = await analyzeShadowFor(
      {
        text: "Das ist ein kurzer Satz.",
        translation: "Dies ist ein kurzer Satz.",
        source: "de",
        target: "ar",
        style: "natural",
        uiLocale: "en",
      },
      { request: request() },
    )!;
    expect(result).toEqual({ losses: [] });
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    const prompt = String(runAnalysis.mock.calls[0]![1]);
    expect(prompt).not.toContain("PART");
    expect(prompt).toContain("<source>");
  });

  it("turns a broken window into no shadow at all, never an empty claim", async () => {
    runAnalysis.mockResolvedValueOnce(JSON.stringify({ losses: [] })).mockResolvedValue("not json");
    const source = paragraph(40);
    const result = await analyzeShadowFor(
      {
        text: source,
        translation: source,
        source: "de",
        target: "ar",
        style: "natural",
        uiLocale: "en",
      },
      { request: request() },
    );
    expect(result).toBeNull();
  });

  it("returns null when the provider fails", async () => {
    runAnalysis.mockRejectedValue(new Error("provider down"));
    const result = await analyzeShadowFor(
      {
        text: "Das ist ein kurzer Satz.",
        translation: "Dies ist ein kurzer Satz.",
        source: "de",
        target: "ar",
        style: "natural",
        uiLocale: "en",
      },
      { request: request() },
    );
    expect(result).toBeNull();
  });

  it("accepts the native surface's cross-origin transport once its gate authorized it", async () => {
    runAnalysis.mockResolvedValue(JSON.stringify({ losses: [] }));
    const result = await analyzeShadowFor(
      {
        text: "Das ist ein kurzer Satz.",
        translation: "Dies ist ein kurzer Satz.",
        source: "de",
        target: "ar",
        style: "natural",
        uiLocale: "en",
      },
      { request: request("https://localhost"), crossOrigin: true },
    );
    expect(result).toEqual({ losses: [] });
  });
});
