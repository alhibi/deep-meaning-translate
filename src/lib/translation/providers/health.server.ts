import type { TranslationError } from "../types";

/**
 * Short-lived provider health, shared by the foreground stream route.
 *
 * The deployed Luna (Sona) endpoint answered by refusing every request first: the route
 * retried once with the provider's Retry-After (clamped to 2.5 s) and only then failed
 * over to DeepSeek (Velo). The person waited ~3.5 s for a sentence the other brain can
 * write in under a second. Two rules fix that without hiding it:
 *
 * - the foreground path fails over immediately when another writer is configured
 *   (see streamRoute.server.ts — it passes `maxAttempts: 1` to the provider request);
 * - a writer that just failed is skipped for a short cooldown, so a later sentence is not
 *   slowed down by the same unavailable provider. The cooldown is bounded and expires on
 *   its own; a success clears it. State is process-local and tiny (two entries), exactly
 *   like the admission buckets — never a deployment-wide breaker.
 *
 * This is availability routing, not a throttle on a healthy model: only a provider that
 * already failed is skipped, and only while another configured writer can answer.
 */
export type BrainId = "deepseek" | "luna";

/** How long a writer is skipped after a given failure class. */
export const PROVIDER_COOLDOWN_MS: Record<TranslationError["kind"], number> = {
  auth: 5 * 60_000,
  quota: 5 * 60_000,
  rate: 30_000,
  network: 10_000,
  provider: 15_000,
  // A rejected input is the request's fault, not the provider's.
  input: 0,
};

const coolingUntil = new Map<BrainId, number>();

/** Remaining cooldown in milliseconds (0 when the writer may be used). */
export function providerCooldownRemaining(brain: BrainId, now = Date.now()): number {
  const until = coolingUntil.get(brain);
  if (until === undefined) return 0;
  const remaining = until - now;
  if (remaining <= 0) {
    coolingUntil.delete(brain);
    return 0;
  }
  return remaining;
}

/** True while a recently failed writer should be skipped for the other writer. */
export function providerCooling(brain: BrainId, now = Date.now()): boolean {
  return providerCooldownRemaining(brain, now) > 0;
}

/** Record a provider failure and return the cooldown that now applies (0 for input). */
export function noteProviderFailure(
  brain: BrainId,
  kind: TranslationError["kind"],
  now = Date.now(),
): number {
  const ms = PROVIDER_COOLDOWN_MS[kind];
  if (ms <= 0) return 0;
  coolingUntil.set(brain, now + ms);
  return ms;
}

/** A provider that answered clears its cooldown immediately. */
export function noteProviderSuccess(brain: BrainId): void {
  coolingUntil.delete(brain);
}

/** Read-only snapshot for diagnostics and tests (no request content). */
export function providerHealth(now = Date.now()): { brain: BrainId; remainingMs: number }[] {
  return (["deepseek", "luna"] as const)
    .map((brain) => ({ brain, remainingMs: providerCooldownRemaining(brain, now) }))
    .filter((entry) => entry.remainingMs > 0);
}

/** Test seam: drop all provider health state. */
export function resetProviderHealthForTests(): void {
  coolingUntil.clear();
}
