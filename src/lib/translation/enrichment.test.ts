import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENRICHMENT_GAP_MS,
  enqueueEnrichment,
  enrichmentLoad,
  resetEnrichmentQueueForTests,
} from "./enrichment";

afterEach(() => {
  resetEnrichmentQueueForTests(0);
  vi.useRealTimers();
});

describe("background enrichment queue", () => {
  it("never runs two quiet requests at the same time", async () => {
    let running = 0;
    let peak = 0;
    const task = (value: number) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return value;
    };
    const results = await Promise.all([
      enqueueEnrichment(task(1)),
      enqueueEnrichment(task(2)),
      enqueueEnrichment(task(3)),
    ]);
    expect(peak).toBe(1);
    expect(results).toEqual([1, 2, 3]);
  });

  it("keeps the order the sentences were written in", async () => {
    const order: string[] = [];
    const slow = () =>
      enqueueEnrichment(async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("first");
      });
    const fast = () =>
      enqueueEnrichment(async () => {
        order.push("second");
      });
    await Promise.all([slow(), fast()]);
    expect(order).toEqual(["first", "second"]);
  });

  it("passes the task's own answer through and keeps failures out of the queue", async () => {
    const failed = enqueueEnrichment(() => Promise.reject(new Error("provider down")));
    const fine = enqueueEnrichment(async () => "lexicon");
    await expect(failed).rejects.toThrow("provider down");
    await expect(fine).resolves.toBe("lexicon");
    expect(enrichmentLoad()).toBe(0);
  });

  it("spaces quiet work out, so the next sentence finds the network free", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(50);
    const startedAt: number[] = [];
    const task = () =>
      enqueueEnrichment(async () => {
        startedAt.push(Date.now());
      });
    void task();
    void task();
    await vi.advanceTimersByTimeAsync(200);
    expect(startedAt).toHaveLength(2);
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(50);
    expect(ENRICHMENT_GAP_MS).toBeGreaterThan(0);
  });

  it("releases the door when a provider hangs, so the next sentence is not frozen", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 300);
    const never = enqueueEnrichment(() => new Promise<never>(() => {}));
    let ran = false;
    void enqueueEnrichment(async () => {
      ran = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(ran).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(ran).toBe(true);
    // The caller still owns its own promise: a hang is not silently reported as success.
    let settled = false;
    void never.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);
  });

  it("drains to zero, so the counter can never leak", async () => {
    await Promise.all([enqueueEnrichment(async () => 1), enqueueEnrichment(async () => 2)]);
    expect(enrichmentLoad()).toBe(0);
  });
});
