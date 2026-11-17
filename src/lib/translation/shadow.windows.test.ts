import { describe, expect, it } from "vitest";
import {
  MAX_LOSSES,
  MAX_SOURCE,
  mergeWindowLosses,
  planShadowWindows,
  readWindowShadowReply,
  sentenceSpans,
  SHADOW_MAX_WINDOWS,
  SHADOW_WINDOW_TARGET,
  type Loss,
} from "./shadow";

/** "Satz nummer N ist gut." — a sentence boundary after every number. */
const paragraph = (count: number) =>
  Array.from({ length: count }, (_value, index) => `Satz nummer ${index + 1} ist gut.`).join(" ");

const lossAt = (o: Partial<Loss> & { id: string }): Loss => ({
  kind: "loss",
  category: "warmth",
  severity: 2,
  confidence: 0.9,
  source: { start: 0, end: 3 },
  target: { start: 0, end: 3 },
  sourceQuote: "",
  targetQuote: "",
  explanation: "e",
  restores: [],
  ...o,
});

describe("sentence windows", () => {
  it("keeps a short text as one whole-text window", () => {
    const source = "Das ist ein kurzer Satz.";
    const windows = planShadowWindows(source);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ index: 0, total: 1, start: 0, end: source.length });
    expect(windows[0]!.text).toBe(source);
    expect(windows[0]!.contextBefore).toBe("");
    expect(windows[0]!.contextAfter).toBe("");
  });

  it("returns no windows for empty or oversized text", () => {
    expect(planShadowWindows("")).toEqual([]);
    expect(planShadowWindows("   \n\t ")).toEqual([]);
    expect(planShadowWindows("wort ".repeat(MAX_SOURCE))).toEqual([]);
  });

  it("splits a long paragraph into ordered, overlapping sentence windows", () => {
    const source = paragraph(40);
    expect(source.length).toBeGreaterThan(SHADOW_WINDOW_TARGET);
    const windows = planShadowWindows(source);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.length).toBeLessThanOrEqual(SHADOW_MAX_WINDOWS);
    // Absolute, ordered offsets.
    expect(windows[0]!.start).toBe(0);
    expect(windows[windows.length - 1]!.end).toBe(source.length);
    windows.forEach((window, index) => {
      expect(window.index).toBe(index);
      expect(window.total).toBe(windows.length);
      expect(window.text).toBe(source.slice(window.start, window.end));
      expect(window.start).toBeLessThan(window.end);
      if (index > 0) expect(window.start).toBeLessThanOrEqual(windows[index - 1]!.end);
    });
    // The overlap is the previous window's final sentence, so a boundary nuance is judged
    // in both windows and deduped by the merge step.
    expect(windows[1]!.start).toBeLessThan(windows[0]!.end);
    // Every character is covered by at least one window.
    for (let index = 0; index < source.length; index += 1) {
      expect(windows.some((window) => window.start <= index && index < window.end)).toBe(true);
    }
  });

  it("bounds the call count instead of multiplying it with the text length", () => {
    const source = paragraph(200);
    expect(source.length).toBeGreaterThan(4000);
    const windows = planShadowWindows(source);
    expect(windows.length).toBeLessThanOrEqual(SHADOW_MAX_WINDOWS);
    expect(windows.every((window) => window.text.length <= MAX_SOURCE)).toBe(true);
  });

  it("cuts only at sentence boundaries", () => {
    const source = paragraph(40);
    const starts = new Set(sentenceSpans(source).map((span) => span.start));
    const ends = new Set(sentenceSpans(source).map((span) => span.end));
    for (const window of planShadowWindows(source)) {
      expect(starts.has(window.start) || window.start === 0).toBe(true);
      expect(ends.has(window.end)).toBe(true);
    }
  });

  it("does not split a single long sentence into more calls", () => {
    const source = "wort ".repeat(400).trim();
    const windows = planShadowWindows(source);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.text).toBe(source);
  });

  it("neighbouring context is trimmed and bounded", () => {
    const source = paragraph(40);
    const windows = planShadowWindows(source);
    const middle = windows[1]!;
    expect(middle.contextBefore.length).toBeGreaterThan(0);
    expect(source.slice(0, middle.start).trimEnd().endsWith(middle.contextBefore)).toBe(true);
    expect(source.slice(middle.end).trimStart().startsWith(middle.contextAfter)).toBe(true);
    expect(middle.contextAfter.length).toBeLessThanOrEqual(240);
  });

  it("plans deterministically", () => {
    const source = paragraph(60);
    expect(planShadowWindows(source)).toEqual(planShadowWindows(source));
  });
});

describe("parsing one window", () => {
  const source = paragraph(40);
  // The translation is the same sentences; a synthetic critic points at one whole
  // sentence per window, which is unique because of its number.
  const reply = (quote: string) =>
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

  it("moves a window's source span to absolute offsets", () => {
    const windows = planShadowWindows(source);
    expect(windows.length).toBeGreaterThan(1);
    const window = windows[1]!;
    const sentence = window.text.split(". ")[0]! + ".";
    const losses = readWindowShadowReply(reply(sentence), window, source)!;
    expect(losses).toHaveLength(1);
    const loss = losses[0]!;
    // The source quote is unique, so the absolute span must point at the same sentence.
    expect(source.slice(loss.source.start, loss.source.end)).toBe(sentence);
    expect(loss.source.start).toBeGreaterThanOrEqual(window.start);
    expect(loss.target.start).toBe(source.indexOf(sentence));
    expect(loss.targetQuote).toBe(sentence);
  });

  it("compares repeated quotes on the whole text, not inside the window", () => {
    // A repeated "Wort" appears twice inside one window. Positioned relative to the
    // window, the later occurrence looked closest to the target; only positions on the
    // whole source pair the finding with its real counterpart (the earlier one).
    const filler = (n: number) => `Füllsatz Nummer ${n} ist lang genug.`;
    const sentences = [
      ...Array.from({ length: 19 }, (_value, index) => filler(index + 1)),
      "Wort am Anfang ist gut.",
      ...Array.from({ length: 4 }, (_value, index) => filler(index + 20)),
      "Wort am Ende ist gut.",
      ...Array.from({ length: 4 }, (_value, index) => filler(index + 30)),
    ];
    const source = sentences.join(" ");
    const translation = [
      ...sentences.slice(0, 19),
      "Ziel ist hier erreicht.",
      sentences[19]!,
      ...sentences.slice(21),
    ].join(" ");
    const window = planShadowWindows(source).find(
      (candidate) =>
        candidate.text.includes("Wort am Anfang") && candidate.text.includes("Wort am Ende"),
    );
    expect(window).toBeDefined();
    expect(window!.start).toBeGreaterThan(0);
    const losses = readWindowShadowReply(
      JSON.stringify({
        losses: [
          {
            kind: "loss",
            category: "warmth",
            severity: 2,
            confidence: 0.9,
            source_quote: "Wort",
            target_quote: "Ziel",
            explanation: "e",
          },
        ],
      }),
      window!,
      translation,
    )!;
    expect(losses).toHaveLength(1);
    expect(losses[0]!.source.start).toBe(source.indexOf("Wort am Anfang ist gut."));
    expect(losses[0]!.target.start).toBe(translation.indexOf("Ziel"));
  });

  it("rejects a broken reply instead of inventing an empty result", () => {
    const window = planShadowWindows(source)[0]!;
    expect(readWindowShadowReply("not json", window, source)).toBeNull();
    expect(readWindowShadowReply('{"losses":[{"category":"mood"}]}', window, source)).toBeNull();
  });
});

describe("merging window results", () => {
  it("keeps one finding per lost place, strongest first", () => {
    const weaker = lossAt({
      id: "a",
      confidence: 0.7,
      source: { start: 0, end: 3 },
      target: { start: 0, end: 3 },
    });
    const stronger = lossAt({
      id: "b",
      severity: 3,
      confidence: 0.95,
      source: { start: 10, end: 13 },
      target: { start: 0, end: 3 },
    });
    const merged = mergeWindowLosses([[weaker], [stronger]]);
    expect(merged.losses).toHaveLength(1);
    expect(merged.losses[0]!.severity).toBe(3);
  });

  it("applies the global cap across all windows and orders by target", () => {
    const group = (offset: number) =>
      Array.from({ length: 3 }, (_value, index) =>
        lossAt({
          id: `g${offset + index}`,
          target: { start: offset + index * 2, end: offset + index * 2 + 1 },
          source: { start: offset + index * 2, end: offset + index * 2 + 1 },
        }),
      );
    const merged = mergeWindowLosses([group(0), group(6)]);
    expect(merged.losses).toHaveLength(MAX_LOSSES);
    const starts = merged.losses.map((loss) => loss.target.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("an honest empty set stays empty", () => {
    expect(mergeWindowLosses([[], []])).toEqual({ losses: [] });
  });
});
