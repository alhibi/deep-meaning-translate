import { describe, expect, it } from "vitest";
import { appendDictation, draftDirection, limitDraft, MAX_DRAFT_LENGTH } from "./composer";

describe("draft direction", () => {
  it.each([
    ["مرحباً بك", "rtl"],
    ["  🙂 123 — مرحباً", "rtl"],
    ["١٢٣، Hallo Welt", "ltr"],
    ["١٢٣ שלום", "rtl"],
    ["َ 123 Grüße من هنا", "ltr"],
    ["— 中文", "ltr"],
    ["𞤀𞤁", "rtl"],
  ] as const)("takes the first letter, not neutral characters: %s", (text, expected) => {
    expect(draftDirection(text)).toBe(expected);
  });

  it("keeps the selected language's direction for an empty or neutral draft", () => {
    expect(draftDirection("", "rtl")).toBe("rtl");
    expect(draftDirection("١٢٣؟ 🙂", "ltr")).toBe("ltr");
    expect(draftDirection("123", "rtl")).toBe("rtl");
  });
});

describe("draft limit", () => {
  it("preserves whitespace, indentation, paragraphs and emoji exactly", () => {
    const text = "  مرحباً  🙂\n\n  Guten Morgen!  \n";
    expect(limitDraft(text)).toBe(text);
    expect(limitDraft("a".repeat(MAX_DRAFT_LENGTH))).toHaveLength(MAX_DRAFT_LENGTH);
  });

  it("bounds every programmatic entry point without leaving half an emoji", () => {
    const text = "a".repeat(MAX_DRAFT_LENGTH - 1) + "🙂more";
    expect(limitDraft(text)).toBe("a".repeat(MAX_DRAFT_LENGTH - 1));
    expect(limitDraft("a".repeat(MAX_DRAFT_LENGTH - 2) + "🙂more")).toHaveLength(MAX_DRAFT_LENGTH);
  });
});

describe("dictation joins the draft without rewriting it", () => {
  it("keeps typed paragraphs, indentation and trailing newlines", () => {
    const base = "  مقدمة\n\n  فقرة ثانية\n";
    expect(appendDictation(base, " كلام جديد ")).toBe(base + "كلام جديد");
    expect(appendDictation(base, "")).toBe(base);
  });

  it("adds only the necessary separator and preserves intentional repetition", () => {
    expect(appendDictation("Hallo", "ja ja")).toBe("Hallo ja ja");
    expect(appendDictation("Hallo  ", "Welt")).toBe("Hallo  Welt");
    expect(appendDictation("", "  مرحباً  ")).toBe("مرحباً");
  });
});
