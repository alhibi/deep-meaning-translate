import { describe, expect, it } from "vitest";
import { delayFor, isProvisional, normalize, worthTranslating } from "./scheduler";

describe("scheduler", () => {
  it("normalizes whitespace", () => {
    expect(normalize("  hallo   welt  ")).toBe("hallo welt");
  });
  it("finished sentences are not provisional", () => {
    expect(isProvisional("Wie geht's?", "Wie geht's?", false)).toBe(false);
    expect(isProvisional("كيف حالك؟", "كيف حالك؟", false)).toBe(false);
  });
  it("text without punctuation is provisional unless deliberate", () => {
    expect(isProvisional("wie geht", "wie geht", false)).toBe(true);
    expect(isProvisional("wie geht", "wie geht", true)).toBe(false);
    expect(isProvisional("wie geht", "wie geht\n", false)).toBe(false);
  });
  it("needs at least two letters", () => {
    expect(worthTranslating("a")).toBe(false);
    expect(worthTranslating("ab")).toBe(true);
    expect(worthTranslating("!!")).toBe(false);
  });
  it("is quicker at sentence ends than mid-word", () => {
    const base = { intervals: [300], hasResult: true };
    const end = delayFor({ ...base, normalized: "Hallo Welt.", raw: "Hallo Welt." });
    const mid = delayFor({ ...base, normalized: "Hallo Wel", raw: "Hallo Wel" });
    expect(end).toBeLessThan(mid);
    expect(mid).toBeLessThanOrEqual(1500);
  });
});
