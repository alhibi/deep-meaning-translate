import { describe, expect, it } from "vitest";
import { stableTokens, tokenize } from "./streamingTokens";

describe("streaming tokens", () => {
  it("keeps the exact text including line breaks", () => {
    const t = "مرحبا  بك\nفي today";
    expect(tokenize(t).join("")).toBe(t);
  });
  it("only new words count as fresh when the translation grows", () => {
    expect(stableTokens(tokenize("Ich gehe"), tokenize("Ich gehe nach Hause"))).toBe(3);
  });
  it("a rewritten word re-animates from that point on", () => {
    expect(stableTokens(tokenize("Ich gehe heim"), tokenize("Ich laufe heim"))).toBe(2);
  });
});
