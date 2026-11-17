import { describe, expect, it } from "vitest";
import {
  anchor,
  carryLosses,
  changedSpan,
  isShadowCandidate,
  MAX_LOSSES,
  MAX_SOURCE,
  MIN_CONFIDENCE,
  MIN_CONFIDENCE_SLIGHT,
  MIN_CONFIDENCE_WEAKENED,
  parseShadow,
  readShadowReply,
  segments,
  SHADOW_SYSTEM,
  shadowUserPrompt,
  wordDiff,
} from "./shadow";

const SRC = "يا حسرتاه على اللي فات، إن شاء الله نلتقي";
const TGT = "Schade, dass es vorbei ist, hoffentlich sehen wir uns";
const loss = (o: Record<string, unknown> = {}) => ({
  kind: "loss",
  category: "intensity",
  severity: 3,
  confidence: 0.9,
  source_quote: "يا حسرتاه",
  target_quote: "Schade",
  explanation: "الحزن العميق صار أسفاً عادياً.",
  restores: [
    {
      text: "Ach, wie bitter, dass es vorbei ist, hoffentlich sehen wir uns",
      note: "أقوى",
    },
  ],
  ...o,
});

/** Valid alternative translations that all change the "Schade" region for `loss()`. */
const restoresFor = (words: string[]) =>
  words.map((word) => ({
    text: `${word}, dass es vorbei ist, hoffentlich sehen wir uns`,
    note: "trade-off",
  }));

describe("sentence shadow contract", () => {
  it("requires a sentence, but no longer refuses a long paragraph", () => {
    expect(isShadowCandidate("Hallo")).toBe(false);
    expect(isShadowCandidate("guten Morgen")).toBe(false);
    expect(isShadowCandidate("wie geht es dir")).toBe(true);
    // Regression: MAX_SOURCE 600 meant a normal long paragraph never got a shadow.
    expect(isShadowCandidate("a ".repeat(400))).toBe(true);
    // The whole-text server bound still holds; windowing splits it, it does not grow.
    expect(isShadowCandidate("a ".repeat(MAX_SOURCE / 2 + 5))).toBe(false);
  });

  it("re-anchors quotes locally instead of trusting model offsets", () => {
    const r = parseShadow({ losses: [loss()] }, SRC, TGT)!;
    expect(r.losses).toHaveLength(1);
    expect(r.losses[0]!.source).toEqual({ start: 0, end: 9 });
    expect(r.losses[0]!.target).toEqual({ start: 0, end: 6 });
    expect(r.losses[0]!.sourceQuote).toBe(SRC.slice(0, 9));
    expect(r.losses[0]!.targetQuote).toBe("Schade");
  });

  it("drops a loss whose quote is not in one of the two texts", () => {
    expect(parseShadow({ losses: [loss({ target_quote: "Leider" })] }, SRC, TGT)!.losses).toEqual(
      [],
    );
    expect(parseShadow({ losses: [loss({ source_quote: "مرحبا" })] }, SRC, TGT)!.losses).toEqual(
      [],
    );
  });

  it("hides findings below the confidence floor", () => {
    expect(
      parseShadow({ losses: [loss({ confidence: MIN_CONFIDENCE - 0.01 })] }, SRC, TGT)!.losses,
    ).toEqual([]);
    expect(
      parseShadow({ losses: [loss({ confidence: MIN_CONFIDENCE })] }, SRC, TGT)!.losses,
    ).toHaveLength(1);
  });

  it("a slight loss needs at least the slight-loss confidence", () => {
    expect(
      parseShadow(
        { losses: [loss({ severity: 1, confidence: MIN_CONFIDENCE_SLIGHT - 0.01 })] },
        SRC,
        TGT,
      )!.losses,
    ).toEqual([]);
    expect(
      parseShadow({ losses: [loss({ severity: 1, confidence: MIN_CONFIDENCE_SLIGHT })] }, SRC, TGT)!
        .losses,
    ).toHaveLength(1);
  });

  it("an honest empty reply means nothing essential was lost", () => {
    expect(parseShadow({ losses: [] }, SRC, TGT)).toEqual({ losses: [] });
    expect(parseShadow({}, SRC, TGT)).toBeNull();
    // A reply whose every item is malformed is not an empty answer; it is a broken one.
    expect(parseShadow({ losses: [{ category: "mood", severity: 2 }] }, SRC, TGT)).toBeNull();
  });

  it("treats a reply of only non-loss judgements as an honest nothing-lost", () => {
    const styleOnly = { losses: [loss({ kind: "style" })] };
    expect(parseShadow(styleOnly, SRC, TGT)).toEqual({ losses: [] });
    const mixed = { losses: [loss({ kind: "normal" }), loss({ kind: "unclear" })] };
    expect(parseShadow(mixed, SRC, TGT)).toEqual({ losses: [] });
  });

  it("caps at four losses and keeps only the strongest on overlapping words", () => {
    const words = ["Schade", "dass", "vorbei", "hoffentlich", "sehen", "uns"];
    const many = words.map((word, index) =>
      loss({ target_quote: word, severity: 1 + (index % 3) }),
    );
    expect(parseShadow({ losses: many }, SRC, TGT)!.losses).toHaveLength(MAX_LOSSES);
    const over = [
      loss({ severity: 1 }),
      loss({ target_quote: "Schade, dass", severity: 3, category: "warmth" }),
    ];
    const r = parseShadow({ losses: over }, SRC, TGT)!;
    expect(r.losses).toHaveLength(1);
    expect(r.losses[0]!.category).toBe("warmth");
  });

  it("drops restores identical to the current translation and keeps at most three", () => {
    const restores = [
      { text: TGT, note: "" },
      { text: "Ach, wie bitter, dass es vorbei ist, hoffentlich sehen wir uns", note: "" },
      { text: "Ach, wie bitter, dass es vorbei ist, hoffentlich sehen wir uns", note: "" },
      ...restoresFor(["Ach je", "Ach Gott", "Ach herrje", "Ach du je"]),
    ];
    const kept = parseShadow({ losses: [loss({ restores })] }, SRC, TGT)!.losses[0]!.restores;
    expect(kept).toHaveLength(3);
    expect(new Set(kept.map((r) => r.text)).size).toBe(3);
    expect(kept.map((r) => r.text)).not.toContain(TGT);
    // Ordered by the size of the change, so the most respectful alternative comes first.
    const sizes = kept.map((r) => {
      const span = changedSpan(TGT, r.text);
      return span.end - span.start;
    });
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(kept[0]!.text).toBe("Ach je, dass es vorbei ist, hoffentlich sehen wir uns");
  });

  it("clamps severity to 1–3 and rejects unknown categories", () => {
    expect(parseShadow({ losses: [loss({ severity: 9 })] }, SRC, TGT)!.losses[0]!.severity).toBe(3);
    // A reply with no recognisable finding at all is unusable, not "nothing was lost".
    expect(parseShadow({ losses: [loss({ category: "mood" })] }, SRC, TGT)).toBeNull();
  });

  it("marks only the changed whole words of a restore", () => {
    const next = "Ach, wie bitter, dass es vorbei ist";
    const s = changedSpan("Schade, dass es vorbei ist", next);
    expect(next.slice(s.start, s.end)).toBe("Ach, wie bitter,");
  });

  it("anchors across case and spacing differences", () => {
    expect(anchor("Das  ist gut", "das ist")).toEqual({ start: 0, end: 8 });
  });

  it("previews a restore as removed words and added words", () => {
    const next = "Ach, wie bitter, dass es vorbei ist";
    const diff = wordDiff("Schade, dass es vorbei ist", next);
    expect("Schade, dass es vorbei ist".slice(diff.removed!.start, diff.removed!.end)).toBe(
      "Schade,",
    );
    expect(next.slice(diff.added!.start, diff.added!.end)).toBe("Ach, wie bitter,");
    expect(wordDiff("gleich", "gleich")).toEqual({ removed: null, added: null });
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

describe("precision vocabulary", () => {
  it("reports a weakened tone as its own smaller kind", () => {
    const r = parseShadow(
      { losses: [loss({ kind: "weakened", severity: 3, confidence: 0.8 })] },
      SRC,
      TGT,
    )!;
    expect(r.losses[0]!.kind).toBe("weakened");
    expect(r.losses[0]!.severity).toBe(2);
  });

  it("needs a confident model before calling a tone weakened", () => {
    expect(
      parseShadow(
        { losses: [loss({ kind: "weakened", confidence: MIN_CONFIDENCE_WEAKENED - 0.01 })] },
        SRC,
        TGT,
      )!.losses,
    ).toEqual([]);
    expect(
      parseShadow(
        { losses: [loss({ kind: "weakened", confidence: MIN_CONFIDENCE_WEAKENED })] },
        SRC,
        TGT,
      )!.losses,
    ).toHaveLength(1);
  });

  it("never shows a stylistic, normal or unclear difference as a loss", () => {
    for (const kind of ["style", "normal", "unclear"] as const) {
      expect(
        parseShadow({ losses: [loss({ kind })] }, SRC, TGT)!.losses,
        `kind ${kind} must not be a loss`,
      ).toEqual([]);
    }
    // A non-loss judgement must not suppress a genuine finding next to it.
    const r = parseShadow(
      { losses: [loss({ kind: "style" }), loss({ kind: "loss", category: "warmth" })] },
      SRC,
      TGT,
    )!;
    expect(r.losses).toHaveLength(1);
    expect(r.losses[0]!.kind).toBe("loss");
  });
});

describe("restores with a defensible gain", () => {
  const LOSS = () =>
    loss({
      restores: [
        { text: "Ach, wie bitter, dass es vorbei ist, hoffentlich sehen wir uns", note: "" },
      ],
    });

  it("drops a full rewrite the person did not ask for", () => {
    const restores = [
      { text: "Ein ganz anderer deutscher Satz, der nichts mit dem Original zu tun hat", note: "" },
    ];
    expect(parseShadow({ losses: [loss({ restores })] }, SRC, TGT)!.losses[0]!.restores).toEqual(
      [],
    );
  });

  it("drops an alternative that loses a number the translation keeps", () => {
    const source = "Es waren drei schöne Tage";
    const translation = "كانت 3 أيام جميلة";
    const raw = {
      losses: [
        {
          ...loss({
            source_quote: "Es waren",
            target_quote: "أيام",
            severity: 2,
            restores: [
              { text: "كانت أياماً جميلة", note: "" },
              { text: "كانت ٣ أيام رائعة", note: "" },
            ],
          }),
        },
      ],
    };
    const kept = parseShadow(raw, source, translation)!.losses[0]!.restores;
    expect(kept.map((r) => r.text)).toEqual(["كانت ٣ أيام رائعة"]);
  });

  it("drops an alternative in the wrong writing system", () => {
    const restores = [{ text: "آسف، أن ذلك قد فات", note: "" }];
    expect(parseShadow({ losses: [loss({ restores })] }, SRC, TGT)!.losses[0]!.restores).toEqual(
      [],
    );
  });

  it("drops an edit that does not touch the lost words", () => {
    const restores = [
      { text: "Schade, dass es vorbei ist, hoffentlich sehen wir uns bald wieder", note: "" },
    ];
    expect(parseShadow({ losses: [loss({ restores })] }, SRC, TGT)!.losses[0]!.restores).toEqual(
      [],
    );
  });

  it("ranks the alternative with the smallest change first", () => {
    const restores = [
      { text: "Ach, wie bitter, dass es vorbei ist, hoffentlich sehen wir uns", note: "" },
      { text: "Wie schade, dass es vorbei ist, hoffentlich sehen wir uns", note: "" },
    ];
    const kept = parseShadow({ losses: [loss({ restores })] }, SRC, TGT)!.losses[0]!.restores;
    expect(kept.map((r) => r.text)[0]).toBe(
      "Wie schade, dass es vorbei ist, hoffentlich sehen wir uns",
    );
    const smaller = changedSpan(TGT, kept[0]!.text);
    const larger = changedSpan(TGT, kept[1]!.text);
    expect(smaller.end - smaller.start).toBeLessThan(larger.end - larger.start);
  });

  it("a finding with no safe alternative simply offers none", () => {
    expect(parseShadow({ losses: [LOSS()] }, SRC, TGT)!.losses[0]!.restores).toHaveLength(1);
    expect(
      parseShadow({ losses: [loss({ restores: [] })] }, SRC, TGT)!.losses[0]!.restores,
    ).toEqual([]);
  });
});

describe("prompt", () => {
  it("names the five judgements and only shows two of them to a person", () => {
    expect(SHADOW_SYSTEM).toContain("loss");
    expect(SHADOW_SYSTEM).toContain("weakened");
    expect(SHADOW_SYSTEM).toContain("style");
    expect(SHADOW_SYSTEM).toContain("normal");
    expect(SHADOW_SYSTEM).toContain("unclear");
    expect(SHADOW_SYSTEM).toContain("Never invent");
    expect(SHADOW_SYSTEM).toContain("empty list is the correct");
  });

  it("keeps the whole-text prompt free of window markers", () => {
    const prompt = shadowUserPrompt({
      text: SRC,
      translation: TGT,
      source: "ar",
      target: "de",
      style: "natural",
      uiLocale: "en",
    });
    expect(prompt).toContain("<source>");
    expect(prompt).toContain("</source>");
    expect(prompt).not.toContain("PART");
  });

  it("labels a windowed part and hands neighbours in as context only", () => {
    const prompt = shadowUserPrompt({
      text: "الجزء الثاني من النص",
      translation: TGT,
      source: "ar",
      target: "de",
      style: "natural",
      uiLocale: "de",
      part: { index: 2, total: 3 },
      contextBefore: "الجزء الأول",
      contextAfter: "الجزء الثالث",
    });
    expect(prompt).toContain("PART 2 of 3");
    expect(prompt).toContain("<source_part>");
    expect(prompt).toContain("<context_before>");
    expect(prompt).toContain("<context_after>");
    expect(prompt).toContain("Report only findings whose source_quote is inside");
  });
});
