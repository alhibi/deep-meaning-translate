/**
 * One door for all quiet background work.
 *
 * When a translation settles, three things would like to run at the same moment: the
 * dictionary lookup, the second-brain review, and the sentence shadow. Each one costs a
 * model call, and a burst of three at once is exactly what a small serverless function
 * dislikes. Since none of them is urgent — a dictionary entry that arrives 200 ms later
 * is not a loss — they all pass through this queue:
 *
 * - **one at a time**, so three cold starts never happen together;
 * - **spaced apart** by a short gap, so the network is free again for the next sentence;
 * - **failure-isolated** (a rejected task never blocks the ones behind it);
 * - **time-bounded**: a provider that hangs releases the door after a timeout, so one
 *   lost request can never freeze the dictionary and the shadow for the rest of a session.
 *
 * The queue is global rather than per-hook: the point is to pace the whole app.
 * Foreground translation never goes through it.
 */

export const ENRICHMENT_GAP_MS = 140;
export const ENRICHMENT_TIMEOUT_MS = 8_000;

let tail: Promise<unknown> = Promise.resolve();
let pending = 0;
let gapMs = ENRICHMENT_GAP_MS;
let timeoutMs = ENRICHMENT_TIMEOUT_MS;

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const settled = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    () => undefined,
  );

/** Number of background tasks queued or running. Exposed for tests and diagnostics. */
export function enrichmentLoad(): number {
  return pending;
}

/**
 * Queue a background task. The returned promise resolves (or rejects) with the task's own
 * outcome, so callers keep their existing `.then/.catch` handling; the door itself is
 * released even when the task fails or hangs.
 */
export function enqueueEnrichment<T>(task: () => Promise<T>): Promise<T> {
  pending += 1;
  const result = tail.then(() => task());
  const done = settled(result).then(() => {
    pending -= 1;
  });
  // Advance the door on completion — or after the timeout, whichever comes first.
  tail = Promise.race([done, wait(timeoutMs)]).then(() => wait(gapMs));
  return result;
}

/** Test seam: start from an empty queue with a chosen gap and hang timeout. */
export function resetEnrichmentQueueForTests(gap = 0, timeout = ENRICHMENT_TIMEOUT_MS): void {
  tail = Promise.resolve();
  pending = 0;
  gapMs = gap;
  timeoutMs = timeout;
}
