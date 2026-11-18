/**
 * One door for all quiet background work.
 *
 * When a translation settles, three things would like to run at the same moment: the
 * dictionary lookup, the same-model deterministic repair, and the sentence shadow. Each one costs a
 * model call, and a burst of three at once is exactly what a small serverless function
 * dislikes. Since none of them is urgent — a dictionary entry that arrives 200 ms later
 * is not a loss — they all pass through this queue:
 *
 * - **one at a time**, so three cold starts never happen together;
 * - **spaced apart** by a short gap, so the network is free again for the next sentence;
 * - **priority ordered**, because a settled review can change the sentence on screen while
 *   a dictionary entry or a shadow hint is optional. The declared priorities are explicit
 *   (`ENRICHMENT_PRIORITY`) and same-purpose work stays FIFO;
 * - **aging**: a task that has waited `ENRICHMENT_STARVATION_MS` is promoted one level per
 *   further wait, so a stream of reviews or dictionary terms can never starve the shadow
 *   for a whole session (fairness beats a static priority class);
 * - **cancellable for real**: each caller may carry an AbortSignal. Queued work whose
 *   signal fired or whose validity predicate turned false is settled before any request;
 *   an in-flight job is aborted through the signal it was handed, so a cooperative
 *   transport cancels the wire, and its result can never be used afterwards;
 * - **deduplicated semantically**: two callers asking the same purpose for the same
 *   `key` (the lexicon/shadow request identity) share one job. Each caller keeps its own
 *   signal and outcome: one screen leaving does not cancel another screen's answer, and
 *   the request is spent once;
 * - **bounded**: obsolete callers are pruned, and beyond `ENRICHMENT_MAX_QUEUED` (and
 *   `ENRICHMENT_MAX_PER_PURPOSE`) the least important queued task is dropped, so rapid
 *   editing cannot accumulate abandoned jobs;
 * - **failure-isolated** (a rejected task never blocks the ones behind it);
 * - **time-bounded without hiding work**: a provider that hangs releases the door after
 *   a timeout. The abort is delivered *before* the door is handed on, so a cooperative
 *   transport stops its request; a task that ignores its signal is reported through
 *   `enrichmentOrphans()` instead of being counted as free capacity.
 *
 * The queue is global rather than per-hook: the point is to pace the whole app.
 * Foreground translation never goes through it: it is a direct stream request whose
 * cancellation is the caller's own AbortSignal.
 */

/** Highest first. A repair is the only quiet task whose result can replace visible text. */
export const ENRICHMENT_PRIORITY = { repair: 0, dictionary: 1, shadow: 2 } as const;
export type EnrichmentPurpose = keyof typeof ENRICHMENT_PRIORITY;

export const ENRICHMENT_GAP_MS = 140;
export const ENRICHMENT_TIMEOUT_MS = 8_000;
/** Queued (not running) tasks kept at most; beyond this the least important one is dropped. */
export const ENRICHMENT_MAX_QUEUED = 12;
/** One purpose may not occupy the whole line; dictionary/shadow bursts stay interleaved. */
export const ENRICHMENT_MAX_PER_PURPOSE = 6;
/** After this wait a task is promoted one priority level per further interval (fairness). */
export const ENRICHMENT_STARVATION_MS = 750;

export interface EnrichmentOptions {
  /** What this quiet work is for; decides its place in line. Defaults to "dictionary". */
  purpose?: EnrichmentPurpose;
  /** Aborting it settles this caller quietly; the job is dropped when no caller remains. */
  signal?: AbortSignal | undefined;
  /** Re-checked immediately before the task runs. False means the result is already useless. */
  isValid?: (() => boolean) | undefined;
  /**
   * Semantic request identity (for example the lexicon/shadow cache key). Two callers
   * with the same purpose and key share one job and one request.
   */
  key?: string | undefined;
}

/** The caller's queued task became obsolete before (or while) it could finish. */
export class EnrichmentCancelled extends Error {
  constructor(reason = "enrichment-cancelled") {
    super(reason);
    this.name = "EnrichmentCancelled";
  }
}

interface Caller {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  settled: boolean;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | null;
  isValid: () => boolean;
}

interface Job {
  task: (signal: AbortSignal) => Promise<unknown>;
  purpose: EnrichmentPurpose;
  priority: number;
  seq: number;
  /** Semantic identity for dedupe; null means this job is never coalesced. */
  identity: string | null;
  enqueuedAt: number;
  callers: Caller[];
  ctrl: AbortController;
  released: boolean;
  counted: boolean;
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

let queue: Job[] = [];
let active: Job | null = null;
/** Jobs whose turn was given up after the timeout but whose task has not settled yet. */
const orphans = new Set<Job>();
let seq = 0;
/** Queued or running jobs; exposed for tests and diagnostics. */
let pending = 0;
let gapMs = ENRICHMENT_GAP_MS;
let timeoutMs = ENRICHMENT_TIMEOUT_MS;
let maxQueued = ENRICHMENT_MAX_QUEUED;
let maxPerPurpose = ENRICHMENT_MAX_PER_PURPOSE;
/** No task may start before this timestamp (the inter-request gap). */
let gapUntil = 0;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let drainAt = Number.POSITIVE_INFINITY;

const ENRICHMENT_CANCELLED = new EnrichmentCancelled();

/** Number of background jobs queued or running. A timed-out job stops counting at once. */
export function enrichmentLoad(): number {
  return pending;
}

/** Jobs currently holding the door (0 or 1): the queue never runs two quiet requests. */
export function enrichmentActive(): number {
  return active ? 1 : 0;
}

/**
 * Timed-out jobs whose task is still running. A cooperative transport ends immediately on
 * the abort; a non-cooperative one is reported here rather than mistaken for free capacity.
 */
export function enrichmentOrphans(): number {
  return orphans.size;
}

function removeCaller(job: Job, caller: Caller): void {
  const index = job.callers.indexOf(caller);
  if (index >= 0) job.callers.splice(index, 1);
}

function liveCallers(job: Job): Caller[] {
  return job.callers.filter((caller) => !caller.settled);
}

/** Settle one caller exactly once and release its listener. */
function settleCaller(caller: Caller, settle: () => void): void {
  if (caller.settled) return;
  caller.settled = true;
  if (caller.onAbort && caller.signal) caller.signal.removeEventListener("abort", caller.onAbort);
  caller.onAbort = null;
  settle();
}

function settleAll(job: Job, settle: (caller: Caller) => void): void {
  const callers = job.callers;
  job.callers = [];
  for (const caller of callers) settleCaller(caller, () => settle(caller));
}

/** Once per job: the job stops occupying a queue slot (or an orphan is forgotten). */
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

function disarmDrain(): void {
  if (drainTimer !== null) clearTimeout(drainTimer);
  drainTimer = null;
  drainAt = Number.POSITIVE_INFINITY;
}

/**
 * The job stops occupying the door. Normally it also releases the callers, but a hang
 * timeout releases only the door: the callers keep their own promise outcome (a provider
 * that never answers must not be reported as a success).
 */
function release(job: Job, spentNetwork = true): void {
  if (job.released) return;
  job.released = true;
  if (job.timer !== null) {
    clearTimeout(job.timer);
    job.timer = null;
  }
  removeFromQueue(job);
  endAccounting(job);
  if (active === job) active = null;
  for (const caller of job.callers) {
    if (caller.onAbort && caller.signal) caller.signal.removeEventListener("abort", caller.onAbort);
    caller.onAbort = null;
  }
  if (spentNetwork) gapUntil = Date.now() + gapMs;
  // A queue that emptied while a drain was armed must not leave a stray timer behind:
  // the next enqueue arms its own.
  if (!queue.length) {
    disarmDrain();
    return;
  }
  if (!active) armDrain(gapUntil - Date.now());
}

/** The queued job is obsolete or was dropped: no request, no gap, callers told quietly. */
function skip(job: Job): void {
  if (job.released) return;
  release(job, false);
  settleAll(job, (caller) => caller.reject(ENRICHMENT_CANCELLED));
}

/** Give up the job because no caller wants it any more. */
function abandonJob(job: Job): void {
  if (job.released) return;
  const reachedNetwork = job.started;
  // Abort first: a cooperative transport cancels its request synchronously, before the
  // door is handed to the next job.
  job.ctrl.abort();
  release(job, reachedNetwork);
}

/** Drop every caller that no longer wants the result; a job with no callers is skipped. */
function pruneCallers(job: Job): void {
  for (const caller of [...job.callers]) {
    if (caller.settled) continue;
    if (caller.signal?.aborted || !caller.isValid()) {
      removeCaller(job, caller);
      settleCaller(caller, () => caller.reject(ENRICHMENT_CANCELLED));
    }
  }
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

/**
 * Fair rank: declared priority, promoted one level for every `ENRICHMENT_STARVATION_MS`
 * of waiting. A queued shadow therefore overtakes newer dictionary work (and aged
 * dictionary work ties with a fresh review) instead of waiting for an idle moment that a
 * long session never gives it.
 */
function rank(job: Job, now: number): number {
  const steps = Math.floor(Math.max(0, now - job.enqueuedAt) / ENRICHMENT_STARVATION_MS);
  return Math.max(0, job.priority - steps);
}

function bestIndex(now: number): number {
  let best = -1;
  let bestRank = Number.POSITIVE_INFINITY;
  for (let i = 0; i < queue.length; i += 1) {
    const job = queue[i]!;
    const r = rank(job, now);
    if (best < 0 || r < bestRank || (r === bestRank && job.seq < queue[best]!.seq)) {
      best = i;
      bestRank = r;
    }
  }
  return best;
}

/** Drop every queued job whose callers already moved on; none of them touches the network. */
function pruneObsolete(): void {
  for (const job of [...queue]) {
    if (job.released) continue;
    pruneCallers(job);
    if (!liveCallers(job).length) skip(job);
  }
}

/** The least important queued job by declared priority, then the oldest, optionally per purpose. */
function dropWorst(predicate: (job: Job) => boolean = () => true): boolean {
  let worst = -1;
  for (let i = 0; i < queue.length; i += 1) {
    const job = queue[i]!;
    if (!predicate(job)) continue;
    if (worst < 0) {
      worst = i;
      continue;
    }
    const current = queue[worst]!;
    if (
      job.priority > current.priority ||
      (job.priority === current.priority && job.seq < current.seq)
    )
      worst = i;
  }
  if (worst < 0) return false;
  const job = queue[worst]!;
  queue.splice(worst, 1);
  skip(job);
  return true;
}

/** Hold the waiting bound globally and per purpose (a review can never be crowded out). */
function enforceBounds(): void {
  while (queue.length > maxQueued) {
    if (!dropWorst()) break;
  }
  const purposes = Object.keys(ENRICHMENT_PRIORITY) as EnrichmentPurpose[];
  for (const purpose of purposes) {
    let count = queue.filter((job) => job.purpose === purpose).length;
    while (count > maxPerPurpose) {
      if (!dropWorst((job) => job.purpose === purpose)) break;
      count -= 1;
    }
  }
}

function finish(job: Job, settle: (caller: Caller) => void): void {
  // A hang timeout already handed the door on; the callers still own their own outcome.
  if (!job.released) release(job);
  settleAll(job, settle);
}

function start(job: Job): void {
  active = job;
  job.started = true;
  job.timer = setTimeout(() => {
    job.timer = null;
    // A provider that hangs must not hold the door. Abort *before* releasing: the
    // transport is cancelled while this job is still the one holding the slot, and only
    // then may the next request start. The callers keep their own promise outcome.
    job.ctrl.abort();
    release(job);
    orphans.add(job);
  }, timeoutMs);
  let result: Promise<unknown>;
  try {
    result = Promise.resolve(job.task(job.ctrl.signal));
  } catch (error) {
    result = Promise.reject(error);
  }
  result.then(
    (value) => {
      orphans.delete(job);
      finish(job, (caller) => caller.resolve(value));
    },
    (error) => {
      orphans.delete(job);
      finish(job, (caller) => caller.reject(error));
    },
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
  const index = bestIndex(now);
  const job = queue.splice(index, 1)[0];
  if (!job) return;
  start(job);
}

/** The queued or running job with this semantic identity, if it is still wanted. */
function findJob(identity: string): Job | null {
  if (active && !active.released && active.identity === identity) return active;
  for (const job of queue) {
    if (!job.released && job.identity === identity) return job;
  }
  return null;
}

/** Add a caller to a shared job. The caller keeps its own signal and validity. */
function attachCaller(job: Job, caller: Caller): void {
  job.callers.push(caller);
  if (!caller.signal) return;
  caller.onAbort = () => {
    removeCaller(job, caller);
    settleCaller(caller, () => caller.reject(ENRICHMENT_CANCELLED));
    // Other callers still want the answer: the request keeps running for them.
    if (!liveCallers(job).length) abandonJob(job);
  };
  caller.signal.addEventListener("abort", caller.onAbort, { once: true });
}

/**
 * Queue a background task. The returned promise resolves (or rejects) with the task's own
 * outcome, so callers keep their existing `.then/.catch` handling. A superseded caller
 * rejects with `EnrichmentCancelled` before any request is made.
 */
export function enqueueEnrichment<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: EnrichmentOptions = {},
): Promise<T> {
  const purpose: EnrichmentPurpose = options.purpose ?? "dictionary";
  const identity = options.key === undefined ? null : `${purpose}|${options.key}`;
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Fire-and-forget is the normal calling style for quiet work: a cancelled task must not
  // become an unhandled rejection just because the caller only used .then().
  void promise.catch(() => {});

  if (options.signal?.aborted) {
    reject(ENRICHMENT_CANCELLED);
    return promise;
  }

  const caller: Caller = {
    resolve: resolve as (value: unknown) => void,
    reject,
    settled: false,
    signal: options.signal,
    onAbort: null,
    isValid: options.isValid ?? (() => true),
  };

  // Semantic dedupe: the same purpose and identity share one call. Each caller keeps its
  // own signal, so one screen leaving does not cancel another screen's answer.
  if (identity) {
    const existing = findJob(identity);
    if (existing) {
      attachCaller(existing, caller);
      return promise;
    }
  }

  const job: Job = {
    task,
    purpose,
    priority: ENRICHMENT_PRIORITY[purpose],
    seq: seq++,
    identity,
    enqueuedAt: Date.now(),
    callers: [],
    ctrl: new AbortController(),
    released: false,
    counted: false,
    started: false,
    timer: null,
  };
  attachCaller(job, caller);
  pending += 1;
  job.counted = true;
  queue.push(job);
  pruneObsolete();
  enforceBounds();
  if (!active && queue.length) armDrain(gapUntil - Date.now());
  return promise;
}

/** Test seam: start from an empty queue with a chosen gap, hang timeout and queue bounds. */
export function resetEnrichmentQueueForTests(
  gap = 0,
  timeout = ENRICHMENT_TIMEOUT_MS,
  cap = ENRICHMENT_MAX_QUEUED,
  perPurpose = ENRICHMENT_MAX_PER_PURPOSE,
): void {
  disarmDrain();
  const running = active;
  active = null;
  const queued = queue;
  queue = [];
  orphans.clear();
  if (running) {
    running.released = true;
    if (running.timer !== null) clearTimeout(running.timer);
    running.timer = null;
    running.ctrl.abort();
    settleAll(running, (caller) => caller.reject(new EnrichmentCancelled("queue-reset")));
  }
  for (const job of queued) {
    job.released = true;
    if (job.timer !== null) clearTimeout(job.timer);
    job.timer = null;
    job.ctrl.abort();
    settleAll(job, (caller) => caller.reject(new EnrichmentCancelled("queue-reset")));
  }
  seq = 0;
  pending = 0;
  gapUntil = 0;
  gapMs = gap;
  timeoutMs = timeout;
  maxQueued = cap;
  maxPerPurpose = perPurpose;
}
