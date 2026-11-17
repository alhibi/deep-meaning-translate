import { describe, expect, it } from "vitest";
import { delayFor, isProvisional, normalize, worthTranslating } from "./scheduler";

describe("scheduler", () => {
  it("normalizes whitespace", () => {
    expect(normalize("  hallo   welt  ")).toBe("hallo welt");
  });
  it("composes canonically equivalent input to one identity", () => {
    // macOS clipboards/files hand out decomposed umlauts; Windows, Android and most web
    // forms send precomposed ones. The same visible sentence must not become two requests.
    const composed = "Gr\u00fc\u00dfe aus K\u00f6ln.";
    const decomposed = "Gru\u0308\u00dfe aus Ko\u0308ln.";
    expect(decomposed).not.toBe(composed);
    expect(normalize(decomposed)).toBe(normalize(composed));
    expect(normalize(decomposed)).toBe(composed);
  });
  it("composes Arabic hamza forms without dropping the harakat", () => {
    // alef + combining hamza above is canonically the same letter as precomposed alef-hamza.
    expect(normalize("\u0627\u0654\u0645\u0646")).toBe("\u0623\u0645\u0646");
    // A fully vocalised word keeps every mark, in canonical order.
    const vocalised = "\u0643\u064e\u062a\u064e\u0628\u064e";
    expect(normalize(vocalised)).toBe(vocalised);
    expect([...normalize(vocalised)].length).toBe(6); // 3 letters + 3 harakat
  });
  it("keeps emoji, surrogate pairs and their spacing intact", () => {
    expect(normalize("  \u{1F600}  hallo  \u{1F44B}\u{1F3FD}  ")).toBe(
      "\u{1F600} hallo \u{1F44B}\u{1F3FD}",
    );
    expect([...normalize("\u{1F600}")]).toHaveLength(1);
  });
  it("leaves line structure meaningful and only collapses formatting noise", () => {
    expect(normalize("a\r\n\r\nb\n\n\n\nc")).toBe("a\n\nb\n\nc");
    expect(normalize("a\u200B\uFEFFb")).toBe("ab");
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
