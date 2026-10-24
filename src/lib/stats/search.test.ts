import { describe, expect, it } from "vitest";
import { activeFilterKeys, parseSearch } from "./search";

/**
 * Statistics keeps its period and filters in the URL, so this parser is the boundary
 * between a stranger's link and the page's data pipeline. Anything malformed must be
 * dropped, never coerced and never thrown.
 */
describe("statistics URL state", () => {
  it("keeps a well-formed view intact", () => {
    const parsed = parseSearch({
      range: "7d",
      from: "2026-01-01",
      to: "2026-01-31",
      pair: "ar>de",
      lang: "auto",
      kind: "idiom",
      domain: "work",
      intent: "thank",
      register: "formal",
    });
    expect(parsed).toEqual({
      range: "7d",
      from: "2026-01-01",
      to: "2026-01-31",
      pair: "ar>de",
      lang: "auto",
      kind: "idiom",
      domain: "work",
      intent: "thank",
      register: "formal",
    });
  });

  it("drops every value the app could not have produced", () => {
    const parsed = parseSearch({
      range: "last-century",
      from: "yesterday",
      to: "2026-13-45",
      pair: "xx>", // incomplete
      lang: "deutsch",
      kind: "spam",
      domain: "<script>",
      intent: 42,
      register: null,
    });
    expect(parsed).toEqual({});
  });

  it("accepts only real days, not look-alikes", () => {
    expect(parseSearch({ from: "2026-02-31" }).from).toBeUndefined(); // no such day
    expect(parseSearch({ from: "2026-02-28" }).from).toBe("2026-02-28");
    expect(parseSearch({ from: "2026-2-8" }).from).toBeUndefined(); // not zero-padded
  });

  it("never keeps a pair without both sides", () => {
    expect(parseSearch({ pair: "auto>de" }).pair).toBe("auto>de");
    expect(parseSearch({ pair: "de>ar" }).pair).toBe("de>ar");
    expect(parseSearch({ pair: ">de" }).pair).toBeUndefined();
    expect(parseSearch({ pair: "de-" }).pair).toBeUndefined();
  });

  it("survives hostile input shapes without throwing", () => {
    expect(() => parseSearch({ range: { evil: true }, pair: ["ar>de"], lang: {} })).not.toThrow();
    expect(parseSearch({ range: { evil: true } })).toEqual({});
  });

  it("names the active filters in a stable order, for the label row", () => {
    const parsed = parseSearch({ lang: "de", pair: "ar>de", domain: "work" });
    expect(activeFilterKeys(parsed)).toEqual(["pair", "lang", "domain"]);
    expect(activeFilterKeys({})).toEqual([]);
  });
});
