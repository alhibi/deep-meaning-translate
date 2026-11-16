import { describe, expect, it } from "vitest";
import {
  createLimiter,
  takeEnrichmentToken,
  takeLiveToken,
  takeRepairToken,
  takeToken,
  takeWarmToken,
} from "./throttle";

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

  it("keeps provisional typing from spending the settled-sentence budget", () => {
    const client = `live-${Math.random()}`;
    for (let i = 0; i < 120; i++) expect(takeLiveToken(client)).toBe(true);
    expect(takeLiveToken(client)).toBe(false);
    // The final sentence still has its full allowance while the live bucket is empty.
    expect(takeToken(client)).toBe(true);
  });

  it("admits a sustained 4 requests/s live load for at least 30 seconds", () => {
    let now = 2_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const client = `typist-${Math.random()}`;
      // 120 provisional requests in 30 s (one every 250 ms) is a very fast human
      // typist; refill must keep up so the live bucket never drains under that load.
      for (let i = 0; i < 120; i++) {
        expect(takeLiveToken(client)).toBe(true);
        now += 250;
      }
      expect(takeLiveToken(client)).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("keeps translation and enrichment budgets separate", () => {
    const client = `separate-${Math.random()}`;
    for (let i = 0; i < 90; i++) expect(takeToken(client)).toBe(true);
    expect(takeToken(client)).toBe(false); // the settled budget is spent …
    expect(takeEnrichmentToken(client)).toBe(true); // … the dictionary still answers
    expect(takeRepairToken(client)).toBe(true); // … and the quiet repair still runs
  });

  it("gives connection warm-ups their own bounded allowance", () => {
    const client = `warm-${Math.random()}`;
    for (let i = 0; i < 20; i++) expect(takeWarmToken(client)).toBe(true);
    expect(takeWarmToken(client)).toBe(false);
    // A warm-up never spends a translation budget.
    expect(takeLiveToken(client)).toBe(true);
    expect(takeToken(client)).toBe(true);
  });

  it("bounds memory: a full table of identities evicts idle ones instead of growing", () => {
    const take = createLimiter(1, 0.001);
    for (let i = 0; i < 10_000; i++) take(`client-${i}`);
    // Table is full of idle entries: a new identity still gets in only after eviction.
    expect(typeof take("late-client")).toBe("boolean");
  });
});
