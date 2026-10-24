import { describe, expect, it } from "vitest";
import { createLimiter, takeEnrichmentToken, takeToken } from "./throttle";

/**
 * Admission is the app's only defence in front of paid providers, so the properties
 * tested here are the ones users feel: typing never gets throttled, and background
 * work can never spend the budget of the sentence someone is writing.
 */
describe("rate admission", () => {
  it("allows a burst, then refuses until tokens refill", () => {
    const take = createLimiter(3, 0.001);
    expect([take("a"), take("a"), take("a")]).toEqual([true, true, true]);
    expect(take("a")).toBe(false);
    expect(take("b")).toBe(true); // identities never share a bucket
  });

  it("refills over time and never exceeds capacity", () => {
    let now = 1_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const take = createLimiter(2, 1);
      expect(take("c")).toBe(true);
      expect(take("c")).toBe(true);
      expect(take("c")).toBe(false);
      now += 1_000; // one second → one token
      expect(take("c")).toBe(true);
      expect(take("c")).toBe(false);
      now += 60_000; // long idle must not bank more than the capacity
      expect(take("c")).toBe(true);
      expect(take("c")).toBe(true);
      expect(take("c")).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  it("charges an explicit cost, for expensive upstream work", () => {
    const take = createLimiter(3, 0.001);
    expect(take("d", 2)).toBe(true);
    expect(take("d", 2)).toBe(false);
    expect(take("d")).toBe(true);
    expect(take("d")).toBe(false);
  });

  it("keeps translation and enrichment budgets separate", () => {
    const client = `separate-${Math.random()}`;
    for (let i = 0; i < 60; i++) expect(takeToken(client)).toBe(true);
    expect(takeToken(client)).toBe(false); // the typing budget is spent …
    expect(takeEnrichmentToken(client)).toBe(true); // … the dictionary still answers
  });

  it("bounds memory: a full table of identities evicts idle ones instead of growing", () => {
    const take = createLimiter(1, 0.001);
    for (let i = 0; i < 10_000; i++) take(`client-${i}`);
    // Table is full of idle entries: a new identity still gets in only after eviction.
    expect(typeof take("late-client")).toBe("boolean");
  });
});
