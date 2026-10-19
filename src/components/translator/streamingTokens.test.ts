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

import { estimateChar, tokenAt } from "./streamingTokens";
describe("spoken word sync", () => {
  const t = tokenize("Ich gehe nach Hause");
  it("maps the voice's character position to the word being spoken", () => {
    expect(tokenAt(t, 0)).toBe(0);
    expect(tokenAt(t, 4)).toBe(2);
    expect(tokenAt(t, 14)).toBe(6);
  });
  it("a pause on whitespace never highlights an unspoken next word", () => {
    expect(tokenAt(t, 3)).toBe(0);
    expect(tokenAt(tokenize("مرحباً  بك"), 6)).toBe(0);
    expect(tokenAt(tokenize("Hallo  "), 99)).toBe(0);
    expect(tokenAt([], 0)).toBe(-1);
  });
  it("estimates slower progress for Arabic", () => {
    expect(estimateChar(1000, 1, true)).toBeLessThan(estimateChar(1000, 1, false));
  });
});
