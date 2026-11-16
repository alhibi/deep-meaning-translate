/**
 * Best-effort, bounded per-client admission. Not a deployment-wide abuse shield.
 *
 * One bucket per purpose, never one bucket for everything: hidden background work
 * (a quiet repair pass, a dictionary lookup, a shadow analysis) must never spend the
 * budget a person needs to translate the sentence they are typing.
 *
 * The buckets are sized so admission never becomes an invisible speed cap: a fast
 * human typist supersedes provisional streams far faster than a deliberate reader,
 * and each superseded stream still costs a real outbound request, but the person must
 * never see a rate answer while typing. They are still bounded, so the endpoint cannot
 * be used as an unbounded request amplifier.
 */

interface Bucket {
  tokens: number;
  updated: number;
}

export function createLimiter(capacity = 30, refillPerSecond = 0.8) {
  const buckets = new Map<string, Bucket>();
  return (client: string, cost = 1): boolean => {
    const now = Date.now();
    let bucket = buckets.get(client);
    if (!bucket) {
      // Bound memory and evict inactive clients before accepting a new identity.
      if (buckets.size >= 10_000) {
        for (const [key, value] of buckets) {
          if (now - value.updated > 120_000) buckets.delete(key);
        }
        if (buckets.size >= 10_000) return false;
      }
      bucket = { tokens: capacity, updated: now };
    }
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + (Math.max(0, now - bucket.updated) / 1000) * refillPerSecond,
    );
    bucket.updated = now;
    buckets.set(client, bucket);
    if (bucket.tokens < cost) return false;
    bucket.tokens -= cost;
    return true;
  };
}

/**
 * Live, still-typing streams. They are cheap, superseded quickly and are the thing a
 * person feels as "translation is alive"; they therefore get their own, wide bucket so
 * rapid typing can never starve the settled sentence that follows it.
 *
 * 120 is a whole minute of a very fast human typist's provisional requests in one burst,
 * and 4/s keeps a sustained typist admitted indefinitely. The endpoint stays bounded:
 * these are still real provider calls, and a scripted client is capped at 4/s once the
 * burst is spent.
 */
export const takeLiveToken = createLimiter(120, 4);

/**
 * Settled translations: one full request per finished sentence, plus its repair when one
 * is actually needed. A burst of provisional typing must never spend this budget.
 * 90/2 per second is far above anything a person produces by writing sentences.
 */
export const takeToken = createLimiter(90, 2);

/**
 * Optional enrichment: the mini dictionary and the Sentence Shadow. Both are quiet
 * (a `null` answer is a normal answer), so a small budget costs the user nothing. It is
 * still widened well past the visible path so a background lookup can never feel like
 * the app is holding back a translation.
 */
export const takeEnrichmentToken = createLimiter(60, 1.5);

/**
 * Hidden second-pass work (repair / second-brain review). It runs after the visible
 * answer has already been shown, so it is the first thing to shed under load — but the
 * budget is sized for a real sentence with a deterministic issue plus the review, not
 * for one lucky request; it must never be the reason a correctable answer stays wrong.
 */
export const takeRepairToken = createLimiter(60, 1);

/** Cloud speech: synthesis costs more than a translation and is played, not typed. */
export const takeSpeechToken = createLimiter(40, 1.2);

/**
 * Connection warm-ups. They send no text and cost no model tokens, but each one is still
 * a real outbound request to a paid provider's API, so it gets its own small budget
 * instead of being an unbounded amplifier for anyone with the URL.
 */
export const takeWarmToken = createLimiter(20, 0.5);

/**
 * Dictation sessions. Each call mints a short-lived AssemblyAI token, i.e. a real
 * outbound request whose budget must not be shared with speech synthesis.
 */
export const takeDictationToken = createLimiter(20, 0.5);
