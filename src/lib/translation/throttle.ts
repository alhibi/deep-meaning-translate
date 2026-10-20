/** Best-effort, bounded per-client admission. Not a deployment-wide abuse shield. */
export function createLimiter(capacity = 30, refillPerSecond = 0.8) {
  const buckets = new Map<string, { tokens: number; updated: number }>();
  return (client: string): boolean => {
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
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.updated) / 1000 * refillPerSecond);
    bucket.updated = now;
    buckets.set(client, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };
}
export const takeToken = createLimiter();
