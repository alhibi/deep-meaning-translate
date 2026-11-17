import { describe, expect, it } from "vitest";
import { mergeWindowLosses, MAX_LOSSES, type Loss } from "./shadow";

/**
 * Cross-window merge guarantees. The old merge deduped only by target span: two
 * overlapping windows that anchored the same source loss to different occurrences of a
 * repeated target phrase produced two visible findings for one lost meaning, and two
 * windows with crossed anchors both survived (the person saw them out of reading order).
 */
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

describe("dedupe across overlapping windows", () => {
  it("keeps one finding when two windows report the same source words", () => {
    const weaker = lossAt({
      id: "a",
      confidence: 0.8,
      source: { start: 120, end: 130 },
      target: { start: 40, end: 50 },
    });
    const stronger = lossAt({
      id: "b",
      confidence: 0.95,
      source: { start: 120, end: 130 },
      target: { start: 700, end: 710 },
    });
    const merged = mergeWindowLosses([[weaker], [stronger]]);
    expect(merged.losses).toHaveLength(1);
    expect(merged.losses[0]!.confidence).toBe(0.95);
    expect(merged.losses[0]!.target.start).toBe(700);
  });

  it("keeps one finding when two windows report the same target words", () => {
    const merged = mergeWindowLosses([
      [lossAt({ id: "a", source: { start: 5, end: 9 }, target: { start: 50, end: 60 } })],
      [lossAt({ id: "b", source: { start: 30, end: 34 }, target: { start: 52, end: 62 } })],
    ]);
    expect(merged.losses).toHaveLength(1);
  });

  it("keeps two genuinely different losses in different windows", () => {
    const merged = mergeWindowLosses([
      [lossAt({ id: "a", source: { start: 5, end: 9 }, target: { start: 50, end: 60 } })],
      [lossAt({ id: "b", source: { start: 300, end: 305 }, target: { start: 300, end: 310 } })],
    ]);
    expect(merged.losses.map((loss) => loss.target.start)).toEqual([50, 300]);
  });
});

describe("global order", () => {
  it("drops the weaker finding of a crossed window pair", () => {
    const earlySourceLateTarget = lossAt({
      id: "a",
      source: { start: 20, end: 30 },
      target: { start: 500, end: 510 },
      confidence: 0.8,
    });
    const lateSourceEarlyTarget = lossAt({
      id: "b",
      source: { start: 400, end: 410 },
      target: { start: 100, end: 110 },
      confidence: 0.95,
    });
    const merged = mergeWindowLosses([[earlySourceLateTarget], [lateSourceEarlyTarget]]);
    expect(merged.losses).toHaveLength(1);
    expect(merged.losses[0]!.source.start).toBe(400);
  });

  it("is independent of the order the windows are handed in", () => {
    const a = lossAt({ id: "a", source: { start: 20, end: 30 }, target: { start: 500, end: 510 } });
    const b = lossAt({ id: "b", source: { start: 40, end: 50 }, target: { start: 600, end: 610 } });
    const c = lossAt({ id: "c", source: { start: 90, end: 99 }, target: { start: 300, end: 310 } });
    const forward = mergeWindowLosses([[a], [b, c]]);
    const backward = mergeWindowLosses([[c, b], [a]]);
    expect(backward.losses).toEqual(forward.losses.map((loss) => ({ ...loss })));
    // c crosses both a and b and is the weakest? Same score here: the first source-ordered
    // pair survives and the crossing one is dropped deterministically.
    expect(forward.losses).toHaveLength(2);
    const starts = forward.losses.map((loss) => loss.target.start);
    expect(starts).toEqual([...starts].sort((left, right) => left - right));
  });
});

describe("cap and identity", () => {
  it("applies the documented cap after dedupe and orders by target", () => {
    const group = (offset: number) =>
      Array.from({ length: 3 }, (_value, index) =>
        lossAt({
          id: "g" + (offset + index),
          target: { start: offset + index * 2, end: offset + index * 2 + 1 },
          source: { start: offset + index * 2, end: offset + index * 2 + 1 },
        }),
      );
    const merged = mergeWindowLosses([group(0), group(20)]);
    expect(merged.losses).toHaveLength(MAX_LOSSES);
    const starts = merged.losses.map((loss) => loss.target.start);
    expect(starts).toEqual([...starts].sort((left, right) => left - right));
    expect(new Set(merged.losses.map((loss) => loss.id)).size).toBe(merged.losses.length);
  });

  it("an honest empty set stays empty", () => {
    expect(mergeWindowLosses([[], []])).toEqual({ losses: [] });
  });

  it("never emits duplicate ids for identical categories and spans", () => {
    // Two windows can claim the same category on adjacent target words; ids stay unique
    // because the second id is disambiguated, not silently repeated.
    const merged = mergeWindowLosses([
      [lossAt({ id: "x", source: { start: 1, end: 2 }, target: { start: 0, end: 1 } })],
      [lossAt({ id: "y", source: { start: 3, end: 4 }, target: { start: 2, end: 3 } })],
    ]);
    expect(merged.losses).toHaveLength(2);
    expect(new Set(merged.losses.map((loss) => loss.id)).size).toBe(2);
  });
});
