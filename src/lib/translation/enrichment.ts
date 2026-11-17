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
 * - **priority ordered**, because a settled review can change the sentence on screen while
 *   a dictionary entry or a shadow hint is optional; an older task of the same purpose
 *   never overtakes a newer one (FIFO within a purpose, no reordering by luck);
 * - **cancellable**: each task may carry an AbortSignal and a validity predicate. A task
 *   whose screen/text is gone is skipped *before* any request is made, and one that is
 *   already running is logically aborted (its caller is rejected; a cooperative task can
 *   stop its own fetch through the signal it is handed);
 * - **bounded**: obsolete tasks are pruned, and beyond `ENRICHMENT_MAX_QUEUED` the least
 *   important queued task is dropped, so rapid editing cannot accumulate abandoned jobs;
 * - **failure-isolated** (a rejected task never blocks the ones behind it);
 * - **time-bounded**: a provider that hangs releases the door after a timeout, so one
 *   lost request can never freeze the dictionary and the shadow for the rest of a session.
 *
 * The queue is global rather than per-hook: the point is to pace the whole app.
 * Foreground translation never goes through it.
 */

/** Highest first. A review is the only quiet task whose result can replace visible text. */
const PRIORITY = { review: 0, dictionary: 1, shadow: 2 } as const;
export type EnrichmentPurpose = keyof typeof PRIORITY;

export const ENRICHMENT_GAP_MS = 140;
export const ENRICHMENT_TIMEOUT_MS = 8_000;
/** Queued (not running) tasks kept at most; beyond this the least important one is dropped. */
export const ENRICHMENT_MAX_QUEUED = 12;

export interface EnrichmentOptions {
  /** What this quiet work is for; decides its place in line. Defaults to "dictionary". */
  purpose?: EnrichmentPurpose;
  /** Aborting it removes a queued task before any request, or releases a running one. */
  signal?: AbortSignal | undefined;
  /** Re-checked immediately before the task runs. False means the result is already useless. */
  isValid?: (() => boolean) | undefined;
}

/** The caller's queued task became obsolete before (or while) it could finish. */
export class EnrichmentCancelled extends Error {
  constructor(reason = "enrichment-cancelled") {
    super(reason);
    this.name = "EnrichmentCancelled";
  }
}

interface Job {
  task: (signal: AbortSignal) => Promise<unknown>;
  purpose: EnrichmentPurpose;
  priority: number;
  seq: number;
  isValid: () => boolean;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | null;
  ctrl: AbortController;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  callerSettled: boolean;
  released: boolean;
  counted: boolean;
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

let queue: Job[] = [];
let active: Job | null = null;
let seq = 0;
/** Queued or running tasks; exposed for tests and diagnostics. */
let pending = 0;
let gapMs = ENRICHMENT_GAP_MS;
let timeoutMs = ENRICHMENT_TIMEOUT_MS;
let maxQueued = ENRICHMENT_MAX_QUEUED;
/** No task may start before this timestamp (the inter-request gap). */
let gapUntil = 0;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let drainAt = Number.POSITIVE_INFINITY;

const ENRICHMENT_CANCELLED = new EnrichmentCancelled();

/**
 * Number of background tasks queued or running. A task whose turn was given up after the
 * hang timeout stops counting, even though the caller may still be owed its outcome.
 */
export function enrichmentLoad(): number {
  return pending;
}

function removeSignalListener(job: Job): void {
  if (job.signal && job.onAbort) job.signal.removeEventListener("abort", job.onAbort);
  job.onAbort = null;
}

/** Once per job: the caller's promise is settled (or abandoned after a timeout). */
function endAccounting(job: Job): void {
  if (!job.counted) return;
  job.counted = false;
  pending -= 1;
}

function removeFromQueue(job: Job): boolean {
  const i = queue.indexOf(job);
  if (i < 0) return false;
  queue.splice(i, 1);
  return true;
}

function settleCaller(job: Job, settle: () => void): void {
  if (job.callerSettled) return;
  job.callerSettled = true;
  settle();
}

function disarmDrain(): void {
  if (drainTimer !== null) clearTimeout(drainTimer);
  drainTimer = null;
  drainAt = Number.POSITIVE_INFINITY;
}

/**
 * The job stops occupying the door. Normally it also releases the caller, but a hang
 * timeout releases only the door: the caller keeps its own promise outcome (a provider
 * that never answers must not be reported as a success, and the existing callers already
 * treat a late failure as a failure).
 */
function release(job: Job, spentNetwork = true): void {
  if (job.released) return;
  job.released = true;
  if (job.timer !== null) {
    clearTimeout(job.timer);
    job.timer = null;
  }
  removeSignalListener(job);
  removeFromQueue(job);
  endAccounting(job);
  if (active === job) active = null;
  if (spentNetwork) gapUntil = Date.now() + gapMs;
  // A queue that emptied while a drain was armed must not leave a stray timer behind:
  // the next enqueue arms its own.
  if (!queue.length) {
    disarmDrain();
    return;
  }
  if (!active) armDrain(gapUntil - Date.now());
}

/** The queued task is obsolete or was dropped: no request, no gap, caller told quietly. */
function skip(job: Job): void {
  if (job.released) return;
  release(job, false);
  settleCaller(job, () => job.reject(ENRICHMENT_CANCELLED));
}

function abortJob(job: Job): void {
  if (!job.released) {
    // Only a task that actually reached the network has spent the inter-request gap; a
    // queued task that was cancelled before starting must not delay the next one.
    const reachedNetwork = job.started;
    job.ctrl.abort();
    release(job, reachedNetwork);
  }
  settleCaller(job, () => job.reject(ENRICHMENT_CANCELLED));
  // A cooperative task may reject after this; `finish` ignores an already-settled caller.
}

function armDrain(delayMs: number): void {
  const at = Date.now() + Math.max(0, delayMs);
  if (drainTimer !== null && at >= drainAt) return;
  if (drainTimer !== null) clearTimeout(drainTimer);
  drainAt = at;
  drainTimer = setTimeout(
    () => {
      drainTimer = null;
      drainAt = Number.POSITIVE_INFINITY;
      drain();
    },
    Math.max(0, at - Date.now()),
  );
}

function bestIndex(): number {
  let best = -1;
  for (let i = 0; i < queue.length; i += 1) {
    const job = queue[i]!;
    if (best < 0) {
      best = i;
      continue;
    }
    const current = queue[best]!;
    if (job.priority < current.priority) best = i;
    else if (job.priority === current.priority && job.seq < current.seq) best = i;
  }
  return best;
}

/** Drop every queued task whose screen/text already moved on; none of them touches the network. */
function pruneObsolete(): void {
  for (const job of [...queue]) {
    if (job.released) continue;
    if (job.ctrl.signal.aborted || job.signal?.aborted || !job.isValid()) skip(job);
  }
}

/** The queue is full: drop the least important queued task (lowest priority, then oldest). */
function dropOverflow(): void {
  while (queue.length > maxQueued) {
    let worst = 0;
    for (let i = 1; i < queue.length; i += 1) {
      const a = queue[i]!;
      const b = queue[worst]!;
      if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) worst = i;
    }
    const job = queue[worst]!;
    skip(job);
  }
}

function finish(job: Job, settle: () => void): void {
  if (job.released) {
    // A hang timeout already handed the door on; the caller still owns its own outcome.
    settleCaller(job, settle);
    return;
  }
  release(job);
  settleCaller(job, settle);
}

function start(job: Job): void {
  active = job;
  job.started = true;
  job.timer = setTimeout(() => {
    job.timer = null;
    // A provider that hangs must not hold the door: abort what can be aborted and let the
    // next task through. The caller's promise stays pending until the task itself settles.
    release(job);
    job.ctrl.abort();
  }, timeoutMs);
  let result: Promise<unknown>;
  try {
    result = Promise.resolve(job.task(job.ctrl.signal));
  } catch (error) {
    result = Promise.reject(error);
  }
  result.then(
    (value) => finish(job, () => job.resolve(value)),
    (error) => finish(job, () => job.reject(error)),
  );
}

function drain(): void {
  if (active) return;
  pruneObsolete();
  if (!queue.length) return;
  const now = Date.now();
  if (now < gapUntil) {
    armDrain(gapUntil - now);
    return;
  }
  const i = bestIndex();
  const job = queue.splice(i, 1)[0];
  if (!job) return;
  start(job);
}

/**
 * Queue a background task. The returned promise resolves (or rejects) with the task's own
 * outcome, so callers keep their existing `.then/.catch` handling. A superseded task
 * rejects with `EnrichmentCancelled` before any request is made.
 */
export function enqueueEnrichment<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: EnrichmentOptions = {},
): Promise<T> {
  const purpose: EnrichmentPurpose = options.purpose ?? "dictionary";
  const ctrl = new AbortController();
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Fire-and-forget is the normal calling style for quiet work: a cancelled task must not
  // become an unhandled rejection just because the caller only used .then().
  void promise.catch(() => {});

  const job: Job = {
    task,
    purpose,
    priority: PRIORITY[purpose],
    seq: seq++,
    isValid: options.isValid ?? (() => true),
    signal: options.signal,
    onAbort: null,
    ctrl,
    resolve: resolve as (value: unknown) => void,
    reject,
    callerSettled: false,
    released: false,
    counted: false,
    started: false,
    timer: null,
  };

  if (options.signal?.aborted) {
    reject(ENRICHMENT_CANCELLED);
    return promise;
  }
  if (options.signal) {
    job.onAbort = () => abortJob(job);
    options.signal.addEventListener("abort", job.onAbort, { once: true });
  }

  pending += 1;
  job.counted = true;
  queue.push(job);
  pruneObsolete();
  dropOverflow();
  if (!active && queue.length) armDrain(gapUntil - Date.now());
  return promise;
}

/** Test seam: start from an empty queue with a chosen gap, hang timeout and queue bound. */
export function resetEnrichmentQueueForTests(
  gap = 0,
  timeout = ENRICHMENT_TIMEOUT_MS,
  cap = ENRICHMENT_MAX_QUEUED,
): void {
  disarmDrain();
  const running = active;
  active = null;
  const queued = queue;
  queue = [];
  if (running) {
    running.released = true;
    if (running.timer !== null) clearTimeout(running.timer);
    running.timer = null;
    removeSignalListener(running);
    running.ctrl.abort();
    settleCaller(running, () => running.reject(new EnrichmentCancelled("queue-reset")));
  }
  for (const job of queued) {
    job.released = true;
    removeSignalListener(job);
    settleCaller(job, () => job.reject(new EnrichmentCancelled("queue-reset")));
  }
  seq = 0;
  pending = 0;
  gapUntil = 0;
  gapMs = gap;
  timeoutMs = timeout;
  maxQueued = cap;
}
