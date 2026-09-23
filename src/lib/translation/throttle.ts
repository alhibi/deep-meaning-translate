/** Coarse in-process throttle; keeps a runaway client from hammering the provider. */
const bucket = { tokens: 30, updated: Date.now() };
export function takeToken(): boolean {
  const now = Date.now();
  bucket.tokens = Math.min(30, bucket.tokens + ((now - bucket.updated) / 1000) * 0.8);
  bucket.updated = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
