import { describe, expect, it } from "vitest";
import { parseResult, partialTranslation } from "./parse";

const req = { text: "x", source: "de", target: "ar", style: "natural" as const };

describe("partialTranslation", () => {
  it("reads the translation while the JSON is still arriving", () => {
    expect(partialTranslation('{"transl')).toBe("");
    expect(partialTranslation('{"translation":"مرحبا يا')).toBe("مرحبا يا");
    expect(partialTranslation('{"translation":"a\\nb\\"c\\')).toBe('a\nb"c');
    expect(partialTranslation('{"translation":"x\\u00e4","tone":"')).toBe("xä");
    expect(partialTranslation('{"translation":"done","tone":"warm"}')).toBe("done");
  });
  it("parses the finished reply", () => {
    const r = parseResult('```json\n{"translation":"مرحبا","situation":"chat"}\n```', req);
    expect(r.translation).toBe("مرحبا");
    expect(r.situation).toBe("chat");
  });
});
