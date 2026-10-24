import { describe, expect, it } from "vitest";
import {
  anchor,
  carryLosses,
  changedSpan,
  isShadowCandidate,
  parseShadow,
  readShadowReply,
  segments,
} from "./shadow";

const SRC = "يا حسرتاه على اللي فات، إن شاء الله نلتقي";
const TGT = "Schade, dass es vorbei ist, hoffentlich sehen wir uns";
const loss = (o: Record<string, unknown> = {}) => ({
  category: "intensity",
  severity: 3,
  confidence: 0.9,
  source_quote: "يا حسرتاه",
  target_quote: "Schade",
  explanation: "الحزن العميق صار أسفاً عادياً.",
  restores: [
    { text: "Ach, wie bitter, dass es vorbei ist, hoffentlich sehen wir uns", note: "أقوى" },
  ],
  ...o,
});

describe("sentence shadow contract", () => {
  it("only sentences of three or more words get a shadow", () => {
    expect(isShadowCandidate("Hallo")).toBe(false);
    expect(isShadowCandidate("guten Morgen")).toBe(false);
    expect(isShadowCandidate("wie geht es dir")).toBe(true);
    expect(isShadowCandidate("a ".repeat(400))).toBe(false);
  });

  it("re-anchors quotes locally instead of trusting model offsets", () => {
    const r = parseShadow({ losses: [loss()] }, SRC, TGT)!;
    expect(r.losses).toHaveLength(1);
    expect(r.losses[0]!.source).toEqual({ start: 0, end: 9 });
    expect(r.losses[0]!.target).toEqual({ start: 0, end: 6 });
  });

  it("drops a loss whose quote is not in the translation", () => {
    expect(parseShadow({ losses: [loss({ target_quote: "Leider" })] }, SRC, TGT)!.losses).toEqual(
      [],
    );
    expect(parseShadow({ losses: [loss({ source_quote: "مرحبا" })] }, SRC, TGT)!.losses).toEqual(
      [],
    );
  });

  it("hides findings below 0.55 confidence", () => {
    expect(parseShadow({ losses: [loss({ confidence: 0.5 })] }, SRC, TGT)!.losses).toEqual([]);
    expect(parseShadow({ losses: [loss({ confidence: 0.55 })] }, SRC, TGT)!.losses).toHaveLength(1);
  });

  it("a slight loss needs at least 0.7 confidence", () => {
    expect(
      parseShadow({ losses: [loss({ severity: 1, confidence: 0.65 })] }, SRC, TGT)!.losses,
    ).toEqual([]);
    expect(
      parseShadow({ losses: [loss({ severity: 1, confidence: 0.7 })] }, SRC, TGT)!.losses,
    ).toHaveLength(1);
  });

  it("an honest empty reply means nothing essential was lost", () => {
    expect(parseShadow({ losses: [] }, SRC, TGT)).toEqual({ losses: [] });
    expect(parseShadow({}, SRC, TGT)).toBeNull();
  });

  it("caps at four losses and keeps only the strongest on overlapping words", () => {
    const words = ["Schade", "dass", "vorbei", "hoffentlich", "sehen", "uns"];
    const many = words.map((w, i) => loss({ target_quote: w, severity: 1 + (i % 3) }));
    expect(parseShadow({ losses: many }, SRC, TGT)!.losses).toHaveLength(4);
    const over = [
      loss({ severity: 1 }),
      loss({ target_quote: "Schade, dass", severity: 3, category: "warmth" }),
    ];
    const r = parseShadow({ losses: over }, SRC, TGT)!;
    expect(r.losses).toHaveLength(1);
    expect(r.losses[0]!.category).toBe("warmth");
  });

  it("drops restores identical to the current translation, keeps at most three", () => {
    const restores = [TGT, "A b c", "A b c", "D e f", "G h i", "J k l"].map((text) => ({
      text,
      note: "",
    }));
    expect(
      parseShadow({ losses: [loss({ restores })] }, SRC, TGT)!.losses[0]!.restores.map(
        (r) => r.text,
      ),
    ).toEqual(["A b c", "D e f", "G h i"]);
  });

  it("clamps severity to 1–3 and rejects unknown categories", () => {
    expect(parseShadow({ losses: [loss({ severity: 9 })] }, SRC, TGT)!.losses[0]!.severity).toBe(3);
    expect(parseShadow({ losses: [loss({ category: "mood" })] }, SRC, TGT)!.losses).toEqual([]);
  });

  it("marks only the changed whole words of a restore", () => {
    const next = "Ach, wie bitter, dass es vorbei ist";
    const s = changedSpan("Schade, dass es vorbei ist", next);
    expect(next.slice(s.start, s.end)).toBe("Ach, wie bitter,");
  });

  it("anchors across case and spacing differences", () => {
    expect(anchor("Das  ist gut", "das ist")).toEqual({ start: 0, end: 8 });
  });

  it("carries untouched losses into an edited translation", () => {
    const r = parseShadow(
      { losses: [loss(), loss({ target_quote: "hoffentlich", category: "culture" })] },
      SRC,
      TGT,
    )!;
    const next = "Ach, wie bitter, dass es vorbei ist, hoffentlich sehen wir uns";
    const kept = carryLosses(r.losses, next, r.losses[0]!.id);
    expect(kept.map((l) => l.category)).toEqual(["culture"]);
    expect(next.slice(kept[0]!.target.start, kept[0]!.target.end)).toBe("hoffentlich");
  });

  it("splits the translation into clear and shadowed parts that rejoin exactly", () => {
    const r = parseShadow({ losses: [loss()] }, SRC, TGT)!;
    const seg = segments(TGT, r.losses);
    expect(seg.map((s) => s.text).join("")).toBe(TGT);
    expect(seg[0]!.loss?.category).toBe("intensity");
  });

  it("reads JSON wrapped in prose and survives garbage", () => {
    expect(
      readShadowReply(`ok ${JSON.stringify({ losses: [loss()] })} done`, SRC, TGT)!.losses,
    ).toHaveLength(1);
    expect(readShadowReply("not json", SRC, TGT)).toBeNull();
  });
});
