/**
 * Best-effort, bounded per-client admission. Not a deployment-wide abuse shield.
 *
 * One bucket per purpose, never one bucket for everything: hidden background work
 * (a quiet repair pass, a dictionary lookup, a shadow analysis) must never spend the
 * budget a person needs to translate the sentence they are typing.
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
 * Translation and streamed live typing. Sized for a person working continuously:
 * one live request per pause, one full request per finished sentence, plus its review.
 * Sustained ceiling ≈ 1.5 requests/second per client, burst 60.
 */
export const takeToken = createLimiter(60, 1.5);

/**
 * Optional enrichment: the mini dictionary and the Sentence Shadow. Both are quiet
 * (a `null` answer is a normal answer), so a small budget costs the user nothing.
 */
export const takeEnrichmentToken = createLimiter(24, 0.6);

/**
 * Hidden second-pass work (repair / second-brain review). It runs after the visible
 * answer has already been shown, so it is the first thing to shed under load.
 */
export const takeRepairToken = createLimiter(24, 0.4);

/** Cloud speech: synthesis costs more than a translation and is played, not typed. */
export const takeSpeechToken = createLimiter(40, 1.2);

/**
 * Connection warm-ups. They send no text and cost no model tokens, but each one is
 * still a real outbound request to a paid provider's API, so it gets its own small
 * budget instead of being an unbounded amplifier for anyone with the URL.
 */
export const takeWarmToken = createLimiter(12, 0.3);
