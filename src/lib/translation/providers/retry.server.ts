import { providerFetch } from "./request.server";

/**
 * One provider request, retried at most once.
 *
 * Only the header phase is retried: a transient status or a network failure before any
 * body byte arrived. Once this helper returns a Response its caller hands the body off,
 * and a started stream cannot be replayed — so `textDeltas` iteration is never wrapped
 * in this. Caller cancellation is never retried: that answer is already unwanted.
 *
 * The retry is small on purpose (one extra attempt, 0–2.5 s): a person is waiting. The
 * body of a failed response is never read — provider error bodies can echo the private
 * source text — so no response content enters an error message or a log.
 */
export const MAX_PROVIDER_ATTEMPTS = 2;

const MAX_RETRY_DELAY_MS = 2_500;
const BASE_RETRY_DELAY_MS = 200;

/** "The provider had a bad moment", as opposed to "this request is wrong". */
export function isTransientStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function abortError(): Error {
  return Object.assign(new Error("cancelled"), { name: "AbortError" });
}

/**
 * `Retry-After` is either delta-seconds or an HTTP-date. Both are clamped: a provider
 * asking for two minutes must not hold the translation UI open that long. An absent,
 * negative or unparseable value falls back to exponential backoff with full jitter
 * (200–600 ms for the single retry).
 */
export function retryDelayMs(
  retryAfter: string | null | undefined,
  attempt: number,
  random: () => number = Math.random,
  now: () => number = Date.now,
): number {
  const header = retryAfter?.trim();
  if (header) {
    let requested: number | null = null;
    if (/^\d+$/.test(header)) {
      requested = Number(header) * 1_000;
    } else {
      const at = Date.parse(header);
      if (Number.isFinite(at)) requested = at - now();
    }
    if (requested !== null && Number.isFinite(requested)) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, Math.round(requested)));
    }
  }
  const base = BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(base + random() * base * 2));
}

/** Waits, but never past the caller's abort: a superseded request must not keep a timer. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw abortError();
    let response: Response;
    try {
      response = await providerFetch(url, init, signal);
    } catch (error) {
      // The caller cancelled, or providerFetch's own 60 s safety deadline fired. Neither
      // is worth a second attempt: the first would replay an unwanted answer and the
      // second would double a wait that already timed out.
      if (signal?.aborted) throw abortError();
      if ((error as Error | null)?.name === "AbortError") throw error;
      if (attempt >= MAX_PROVIDER_ATTEMPTS) throw error;
      await wait(retryDelayMs(null, attempt), signal);
      continue;
    }
    if (response.ok || !isTransientStatus(response.status) || attempt >= MAX_PROVIDER_ATTEMPTS) {
      return response;
    }
    // Release the rejected attempt's connection without reading its body. No caller has
    // seen this response yet, so a retry can never replay a hand-off body.
    void response.body?.cancel().catch(() => {});
    await wait(retryDelayMs(response.headers.get("retry-after"), attempt), signal);
  }
}
