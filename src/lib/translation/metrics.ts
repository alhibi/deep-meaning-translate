/**
 * Content-free client telemetry. Counts and timings only — never text, never languages
 * paired with text. Kept in memory for this tab; nothing is sent anywhere.
 * Inspect in the console with `__lingua.metrics()`.
 */
const m = {
  requests: 0,
  cacheHits: 0,
  deduped: 0,
  cancelled: 0,
  retries: 0,
  timeouts: 0,
  errors: {} as Record<string, number>,
  latency: [] as number[],
};

function pct(values: number[], p: number) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
}

export const metrics = {
  request: () => void m.requests++,
  cacheHit: () => void m.cacheHits++,
  deduped: () => void m.deduped++,
  cancel: () => void m.cancelled++,
  retry: () => void m.retries++,
  timeout: () => void m.timeouts++,
  error: (kind: string) => void (m.errors[kind] = (m.errors[kind] ?? 0) + 1),
  latency(ms: number) {
    m.latency.push(ms);
    if (m.latency.length > 100) m.latency.shift();
  },
  snapshot() {
    const total = m.requests + m.cacheHits;
    return {
      ...m,
      latency: undefined,
      p50: pct(m.latency, 50),
      p95: pct(m.latency, 95),
      cacheHitRate: total ? +(m.cacheHits / total).toFixed(2) : 0,
      cancelRate: m.requests ? +(m.cancelled / m.requests).toFixed(2) : 0,
    };
  },
};

if (typeof window !== "undefined") {
  (window as unknown as { __lingua: unknown }).__lingua = { metrics: () => metrics.snapshot() };
}
