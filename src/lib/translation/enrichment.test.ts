import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENRICHMENT_GAP_MS,
  ENRICHMENT_STARVATION_MS,
  enqueueEnrichment,
  enrichmentActive,
  enrichmentLoad,
  enrichmentOrphans,
  resetEnrichmentQueueForTests,
} from "./enrichment";

afterEach(() => {
  resetEnrichmentQueueForTests(0);
  vi.useRealTimers();
});

const flush = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

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
    await flush(200);
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
    await flush(100);
    expect(ran).toBe(false);
    await flush(250);
    expect(ran).toBe(true);
    // The caller still owns its own promise: a hang is not silently reported as success.
    let settled = false;
    void never.then(() => (settled = true));
    await flush(1);
    expect(settled).toBe(false);
  });

  it("drains to zero, so the counter can never leak", async () => {
    await Promise.all([enqueueEnrichment(async () => 1), enqueueEnrichment(async () => 2)]);
    expect(enrichmentLoad()).toBe(0);
  });

  it("does not count a hung task as pending once its turn was given up", async () => {
    // The old queue raced a release promise against the hang timeout but only decremented
    // the pending counter when the task itself settled — one lost request leaked the
    // counter for the rest of the session.
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 100);
    const never = enqueueEnrichment(() => new Promise<never>(() => {}));
    void never.catch(() => {});
    await flush(150);
    expect(enrichmentLoad()).toBe(0);
  });
});

describe("obsolete and cancelled quiet work", () => {
  it("skips queued tasks whose result is already irrelevant, before any network", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    let releaseBlocker: () => void = () => {};
    const blocker = enqueueEnrichment(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve)),
    );
    await flush(10); // the blocker holds the door
    const calls = vi.fn();
    let stale = true;
    const queued = Array.from({ length: 10 }, (_, i) =>
      enqueueEnrichment(
        async () => {
          calls(i);
          return i;
        },
        { purpose: "shadow", isValid: () => !stale },
      ),
    );
    await flush(10);
    expect(calls).not.toHaveBeenCalled(); // still queued behind the blocker
    stale = false;
    releaseBlocker();
    await flush(100);
    await Promise.allSettled(queued);
    await blocker;
    // Every obsolete task was skipped where it was queued: no provider call, no gap spent.
    expect(calls).not.toHaveBeenCalled();
    expect(enrichmentLoad()).toBe(0);
  });

  it("skips a task whose signal was aborted while it waited", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    let releaseBlocker: () => void = () => {};
    const blocker = enqueueEnrichment(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve)),
    );
    await flush(10);
    const calls = vi.fn();
    const ctrl = new AbortController();
    const queued = enqueueEnrichment(async () => calls(), { signal: ctrl.signal });
    await flush(10);
    expect(calls).not.toHaveBeenCalled();
    ctrl.abort();
    await expect(queued).rejects.toMatchObject({ name: "EnrichmentCancelled" });
    releaseBlocker();
    await blocker;
    await flush(50);
    expect(calls).not.toHaveBeenCalled();
  });

  it("aborts an in-flight obsolete task and lets the queue move on", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    const order: string[] = [];
    const ctrl = new AbortController();
    const running = enqueueEnrichment(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          order.push("old-started");
          signal.addEventListener("abort", () => {
            order.push("old-aborted");
            reject(new Error("aborted"));
          });
        }),
      { purpose: "dictionary", signal: ctrl.signal },
    );
    await flush(10);
    const next = enqueueEnrichment(
      async () => {
        order.push("next");
        return "done";
      },
      { purpose: "dictionary" },
    );
    ctrl.abort();
    await expect(running).rejects.toMatchObject({ name: "EnrichmentCancelled" });
    await flush(50);
    await expect(next).resolves.toBe("done");
    expect(order).toEqual(["old-started", "old-aborted", "next"]);
  });

  it("leaves no drain timer behind when all queued work is cancelled", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    let releaseBlocker: () => void = () => {};
    const blocker = enqueueEnrichment(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve)),
    );
    await flush(10);
    const ctrls = Array.from({ length: 5 }, () => new AbortController());
    const queued = ctrls.map((ctrl) => enqueueEnrichment(async () => 1, { signal: ctrl.signal }));
    await flush(10);
    for (const ctrl of ctrls) ctrl.abort();
    await Promise.allSettled(queued);
    expect(enrichmentLoad()).toBe(1); // only the running blocker is left
    releaseBlocker();
    await blocker;
    await flush(10);
    expect(enrichmentLoad()).toBe(0);
    // A cancelled queue must not leave a wake-up timer running after everything is gone.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes its abort listener once the task has finished", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0);
    const ctrl = new AbortController();
    const add = vi.spyOn(ctrl.signal, "addEventListener");
    const remove = vi.spyOn(ctrl.signal, "removeEventListener");
    const done = enqueueEnrichment(async () => "ok", { signal: ctrl.signal });
    await flush(10);
    await expect(done).resolves.toBe("ok");
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("priority and bounds", () => {
  it("puts a settled review ahead of queued dictionary and shadow work", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    let releaseBlocker: () => void = () => {};
    const blocker = enqueueEnrichment(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve)),
    );
    await flush(10);
    const order: string[] = [];
    const job = (name: string, purpose: "review" | "dictionary" | "shadow") =>
      enqueueEnrichment(
        async () => {
          order.push(name);
          return name;
        },
        { purpose },
      );
    const dictionary = job("dictionary", "dictionary");
    const shadow = job("shadow", "shadow");
    const review = job("review", "review");
    releaseBlocker();
    await flush(100);
    await Promise.all([dictionary, shadow, review, blocker]);
    expect(order).toEqual(["review", "dictionary", "shadow"]);
  });

  it("keeps same-purpose work in FIFO order", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    let releaseBlocker: () => void = () => {};
    const blocker = enqueueEnrichment(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve)),
    );
    await flush(10);
    const order: number[] = [];
    const jobs = [0, 1, 2, 3].map((i) =>
      enqueueEnrichment(
        async () => {
          order.push(i);
          return i;
        },
        { purpose: "shadow" },
      ),
    );
    releaseBlocker();
    await flush(100);
    await Promise.all([...jobs, blocker]);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("promotes long-waiting shadow work, so a review cannot starve it for the session", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    let releaseBlocker: () => void = () => {};
    const blocker = enqueueEnrichment(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve)),
    );
    await flush(10);
    const order: string[] = [];
    const shadow = enqueueEnrichment(
      async () => {
        order.push("shadow");
      },
      { purpose: "shadow" },
    );
    // The shadow waits behind the door for longer than the starvation interval.
    await flush(ENRICHMENT_STARVATION_MS * 2);
    const review = enqueueEnrichment(
      async () => {
        order.push("review");
      },
      { purpose: "review" },
    );
    releaseBlocker();
    await flush(200);
    await Promise.all([shadow, review, blocker]);
    // Declared priority would put the review first; aging means the shadow that waited
    // longest is no longer starved by newer, higher-priority work.
    expect(order).toEqual(["shadow", "review"]);
  });

  it("bounds one purpose without dropping a queued review", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000, 12, 2);
    let releaseBlocker: () => void = () => {};
    const blocker = enqueueEnrichment(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve)),
    );
    await flush(10);
    const dictionary: Promise<unknown>[] = [];
    for (let i = 0; i < 3; i += 1) {
      dictionary.push(enqueueEnrichment(async () => i, { purpose: "dictionary" }));
    }
    const review = enqueueEnrichment(async () => "review", { purpose: "review" });
    // The per-purpose cap drops the oldest dictionary task, never the review.
    await expect(dictionary[0]).rejects.toMatchObject({ name: "EnrichmentCancelled" });
    releaseBlocker();
    await flush(100);
    await Promise.all([...dictionary.slice(1), review, blocker]);
    expect(enrichmentLoad()).toBe(0);
  });

  it("bounds the queue by dropping the least important queued tasks", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000, 3);
    let releaseBlocker: () => void = () => {};
    const blocker = enqueueEnrichment(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve)),
    );
    await flush(10);
    const dropped = vi.fn();
    const shadowJob = () =>
      enqueueEnrichment(
        async () => {
          dropped("shadow");
        },
        { purpose: "shadow" },
      );
    const dictionaryJob = () =>
      enqueueEnrichment(
        async () => {
          dropped("dictionary");
        },
        { purpose: "dictionary" },
      );
    const shadow1 = shadowJob();
    const shadow2 = shadowJob();
    const dictionary1 = dictionaryJob();
    const review = enqueueEnrichment(
      async () => {
        dropped("review");
      },
      { purpose: "review" },
    );
    const dictionary2 = dictionaryJob();
    // The two oldest, lowest-priority tasks are dropped to hold the bound of three.
    await expect(shadow1).rejects.toMatchObject({ name: "EnrichmentCancelled" });
    await expect(shadow2).rejects.toMatchObject({ name: "EnrichmentCancelled" });
    void dictionary1.catch(() => {});
    void review.catch(() => {});
    void dictionary2.catch(() => {});
    // One running blocker + the three jobs the bound keeps; the two drops are gone.
    expect(enrichmentLoad()).toBe(4);
    releaseBlocker();
    await flush(100);
    expect(dropped).not.toHaveBeenCalledWith("shadow");
    await Promise.all([dictionary1, review, dictionary2, blocker]);
    expect(enrichmentLoad()).toBe(0);
  });
});

describe("semantic dedupe", () => {
  it("runs one request for two callers with the same purpose and key", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    const calls = vi.fn(async () => "reading");
    const first = enqueueEnrichment(calls, { purpose: "dictionary", key: "bank" });
    const second = enqueueEnrichment(calls, { purpose: "dictionary", key: "bank" });
    await flush(50);
    await expect(first).resolves.toBe("reading");
    await expect(second).resolves.toBe("reading");
    expect(calls).toHaveBeenCalledTimes(1);
    expect(enrichmentLoad()).toBe(0);
  });

  it("joins a job that is already running", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    const calls = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 20)),
    );
    const first = enqueueEnrichment(calls, { purpose: "shadow", key: "sentence" });
    await flush(10); // already started
    const second = enqueueEnrichment(calls, { purpose: "shadow", key: "sentence" });
    await flush(50);
    await expect(first).resolves.toBe("late");
    await expect(second).resolves.toBe("late");
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("one caller leaving does not cancel another caller's shared answer", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    const calls = vi.fn(async () => "shared");
    const leaving = new AbortController();
    const first = enqueueEnrichment(calls, {
      purpose: "dictionary",
      key: "term",
      signal: leaving.signal,
    });
    const second = enqueueEnrichment(calls, { purpose: "dictionary", key: "term" });
    leaving.abort();
    await expect(first).rejects.toMatchObject({ name: "EnrichmentCancelled" });
    await flush(50);
    await expect(second).resolves.toBe("shared");
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("aborting every caller skips the shared job before any request", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    const calls = vi.fn(async () => "never");
    const one = new AbortController();
    const two = new AbortController();
    const first = enqueueEnrichment(calls, {
      purpose: "shadow",
      key: "same",
      signal: one.signal,
    });
    const second = enqueueEnrichment(calls, {
      purpose: "shadow",
      key: "same",
      signal: two.signal,
    });
    one.abort();
    two.abort();
    await expect(first).rejects.toMatchObject({ name: "EnrichmentCancelled" });
    await expect(second).rejects.toMatchObject({ name: "EnrichmentCancelled" });
    await flush(10);
    expect(calls).not.toHaveBeenCalled();
    expect(enrichmentLoad()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not coalesce different purposes or different keys", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    const calls = vi.fn(async () => "x");
    const jobs = [
      enqueueEnrichment(calls, { purpose: "dictionary", key: "same" }),
      enqueueEnrichment(calls, { purpose: "shadow", key: "same" }),
      enqueueEnrichment(calls, { purpose: "dictionary", key: "other" }),
    ];
    await flush(100);
    await Promise.all(jobs);
    expect(calls).toHaveBeenCalledTimes(3);
  });

  it("rejects every caller of a shared failure and keeps the queue moving", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    const failing = vi.fn(() => Promise.reject(new Error("provider down")));
    const first = enqueueEnrichment(failing, { purpose: "dictionary", key: "boom" });
    const second = enqueueEnrichment(failing, { purpose: "dictionary", key: "boom" });
    const after = enqueueEnrichment(async () => "ok", { purpose: "shadow" });
    await flush(10); // let the shared job run
    await expect(first).rejects.toThrow("provider down");
    await expect(second).rejects.toThrow("provider down");
    await flush(50);
    await expect(after).resolves.toBe("ok");
    expect(failing).toHaveBeenCalledTimes(1);
    expect(enrichmentLoad()).toBe(0);
  });
});

describe("timeout accounting", () => {
  it("aborts the timed-out work before handing the door on", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 100);
    const events: string[] = [];
    let firstSignal: AbortSignal | undefined;
    void enqueueEnrichment(
      (signal) =>
        new Promise<never>(() => {
          firstSignal = signal;
          signal.addEventListener("abort", () => events.push("first-aborted"));
        }),
      { purpose: "shadow" },
    );
    await flush(10);
    void enqueueEnrichment(async () => {
      events.push("second-start");
    });
    await flush(120);
    // The cancellation reaches the transport before the next request is allowed to start.
    expect(firstSignal?.aborted).toBe(true);
    expect(events.indexOf("first-aborted")).toBeLessThan(events.indexOf("second-start"));
    expect(events.indexOf("first-aborted")).toBeGreaterThanOrEqual(0);
  });

  it("never leaks load/active counters and forgets the orphan once the task ends", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 100);
    let settle: (value: string) => void = () => {};
    const job = enqueueEnrichment(
      (signal) =>
        new Promise<string>((resolve) => {
          settle = resolve;
          signal.addEventListener("abort", () => resolve("aborted"));
        }),
    );
    await flush(10);
    expect(enrichmentActive()).toBe(1);
    await flush(100); // the door timeout fires and the cooperative task ends on abort
    // The timed-out job stopped occupying the queue and the door is free; because the
    // abort really reached the task, there is no orphan left behind either.
    expect(enrichmentLoad()).toBe(0);
    expect(enrichmentActive()).toBe(0);
    expect(enrichmentOrphans()).toBe(0);
    await expect(job).resolves.toBe("aborted");
    expect(settle).toBeTypeOf("function");
    expect(enrichmentLoad()).toBe(0);
  });

  it("reports a task that ignores its signal as an orphan, not as free capacity", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 100);
    void enqueueEnrichment(() => new Promise<never>(() => {}));
    await flush(200);
    expect(enrichmentLoad()).toBe(0);
    expect(enrichmentOrphans()).toBe(1);
  });

  it("keeps a repeated abort to one settlement and no timers", async () => {
    vi.useFakeTimers();
    resetEnrichmentQueueForTests(0, 8_000);
    const ctrl = new AbortController();
    const job = enqueueEnrichment(async () => "late", { signal: ctrl.signal });
    ctrl.abort();
    ctrl.abort();
    await expect(job).rejects.toMatchObject({ name: "EnrichmentCancelled" });
    await flush(10);
    expect(enrichmentLoad()).toBe(0);
    expect(enrichmentActive()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
