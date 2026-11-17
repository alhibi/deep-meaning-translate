import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { takeEnrichmentToken } from "./throttle";
import { getRequest } from "@tanstack/react-start/server";
import { clientAddress, sameOrigin } from "../requestSafety";
import {
  MAX_SOURCE,
  MAX_TRANSLATION,
  type Loss,
  type ShadowIncomplete,
  type ShadowIncompleteReason,
  type ShadowPlanInput,
  type ShadowResult,
} from "./shadow";

/** Non-blank bounded text. No trimming transform: offsets must match the shown string. */
const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, { message: "Text is blank." });

/**
 * Shadow input is bounded to the same 5,000-unit draft limit as a translation. A longer
 * source is windowed inside `planShadowAnalysis`; the bound keeps one request's body and
 * prompt finite no matter what a client sends. The bounds live in shadow.ts next to the
 * windowing, so the route and the analysis cannot drift apart.
 */
export const ShadowInput = z.object({
  text: boundedText(MAX_SOURCE),
  translation: boundedText(MAX_TRANSLATION),
  source: z.string().regex(/^[a-z]{2}$|^auto$/),
  target: z.string().regex(/^[a-z]{2}$/),
  style: z.enum(["natural", "formal", "casual"]),
  uiLocale: z.enum(["ar", "en", "de"]),
  dialect: z.enum(["auto", "msa", "levant", "egypt", "gulf", "iraq", "maghreb"]).optional(),
});
export type ShadowInputValue = z.infer<typeof ShadowInput>;

export interface ShadowSurface {
  /** The incoming request: source of the same-origin check, admission identity and cancel signal. */
  request: Request;
  /**
   * The native gate already authorized this transport by exact origin allowlist. It is
   * still the same domain function, admission bucket and provider path as the web surface.
   */
  crossOrigin?: boolean;
}

/**
 * Per-analysis overrides. Production uses the documented defaults in shadow.ts; the
 * overrides exist so a test can prove the time bound and the request budget without
 * waiting a minute or spending a paid call.
 */
export interface ShadowAnalysisOptions {
  /** Caller cancellation (request disconnect). Aborts every provider call. */
  signal?: AbortSignal | undefined;
  /** Whole-analysis completion bound in ms; defaults to `SHADOW_DEADLINE_MS`. */
  deadlineMs?: number | undefined;
  /** Total prompt-character budget; defaults to `SHADOW_MAX_PROMPT_CHARS`. */
  maxPromptChars?: number | undefined;
}

const aborted = () => Object.assign(new Error("shadow-cancelled"), { name: "AbortError" });
const isAbort = (error: unknown) =>
  (error as { name?: string } | null)?.name === "AbortError" ||
  (error as { name?: string } | null)?.name === "TimeoutError";

/**
 * One signal out of several, without `AbortSignal.any` (not available on every runtime
 * the worker can land on). The returned disposer removes the listeners again, so a
 * long-lived request signal does not accumulate one listener per window.
 */
function composeSignals(signals: (AbortSignal | undefined)[]): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const listeners: { signal: AbortSignal; listener: () => void }[] = [];
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      continue;
    }
    signal.addEventListener("abort", abort, { once: true });
    listeners.push({ signal, listener: abort });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const { signal, listener } of listeners) signal.removeEventListener("abort", listener);
      listeners.length = 0;
    },
  };
}

/**
 * Resolves with `promise`, or rejects as soon as `signal` aborts — even when the promise
 * is a provider call that ignores its own abort signal. The listener is removed when the
 * promise settles, so a completed analysis leaves nothing attached to the request.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const onAbort = () => reject(aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Why one window produced nothing. Caller cancellation wins over everything else. */
function classifyFailure(error: unknown, caller: AbortSignal | undefined): ShadowIncompleteReason {
  if (caller?.aborted) return "cancelled";
  if (isAbort(error)) return "timeout";
  return "provider";
}

/**
 * The one Sentence Shadow analysis path, shared by the web server function and the native
 * route.
 *
 * Provider independence is the point: this module owns the prompt, the window plan and the
 * parser (all in shadow.ts) and asks `engine.server.runAnalysis` for the text — it never
 * imports a provider. The analysis capability profile (thinking at max effort, JSON mode)
 * is chosen by the engine.
 *
 * Cost and failure rules (TD41):
 * - the plan comes from `planShadowAnalysis`, so a request count (≤ 4) and a total
 *   prompt-character budget are decided before anything is sent;
 * - one whole-analysis deadline covers the parallel wave, and the caller's abort signal
 *   (the request's own signal) reaches every provider call;
 * - a window that fails or times out is isolated: the other windows' anchored findings are
 *   still returned, marked `incomplete` so "nothing else was lost" is never claimed;
 * - when no window answered, or the surviving answer found nothing, the result is `null`
 *   (no unearned "nothing was lost"), exactly as before.
 */
export async function analyzeShadowFor(
  data: ShadowInputValue,
  surface: ShadowSurface,
  options: ShadowAnalysisOptions = {},
): Promise<ShadowResult | null> {
  const shadow = await import("./shadow");
  if (!shadow.isShadowCandidate(data.text)) return null;
  // The native surface is cross-origin by design; its gate already ran. The browser RPC
  // keeps the same-origin contract.
  if (!surface.crossOrigin && !sameOrigin(surface.request)) return null;
  if (!takeEnrichmentToken(clientAddress(surface.request))) return null;
  const planInput: ShadowPlanInput = {
    text: data.text,
    translation: data.translation,
    source: data.source,
    target: data.target,
    style: data.style,
    uiLocale: data.uiLocale,
    dialect: data.dialect,
    maxPromptChars: options.maxPromptChars,
  };
  const plan = shadow.planShadowAnalysis(planInput);
  // No window fits the documented request/token budget: spend nothing rather than send.
  if (!plan.windows.length) return null;
  const caller = options.signal ?? surface.request.signal;
  if (caller.aborted) return null;
  const { runAnalysis } = await import("./engine.server");
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(),
    Math.max(1, options.deadlineMs ?? shadow.SHADOW_DEADLINE_MS),
  );
  const outer = composeSignals([caller, deadline.signal]);
  const completed: Loss[][] = [];
  const reasons = new Set<ShadowIncompleteReason>();
  try {
    const results = await Promise.all(
      plan.windows.map(async (window) => {
        if (outer.signal.aborted)
          return { losses: null, reason: classifyFailure(aborted(), caller) };
        try {
          const raw = await untilAborted(
            runAnalysis(
              shadow.SHADOW_SYSTEM,
              shadow.shadowUserPrompt({
                text: window.text,
                translation: data.translation,
                source: data.source,
                target: data.target,
                style: data.style,
                uiLocale: data.uiLocale,
                dialect: data.dialect,
                part:
                  plan.requests > 1 ? { index: window.index + 1, total: plan.requests } : undefined,
                contextBefore: window.contextBefore || undefined,
                contextAfter: window.contextAfter || undefined,
              }),
              {
                signal: outer.signal,
                chars: window.text.length + data.translation.length,
              },
            ),
            outer.signal,
          );
          const losses = shadow.readWindowShadowReply(raw, window, data.translation);
          return { losses, reason: losses ? null : ("invalid_reply" as const) };
        } catch (error) {
          return { losses: null, reason: classifyFailure(error, caller) };
        }
      }),
    );
    for (const result of results) {
      if (result.losses) completed.push(result.losses);
      else if (result.reason) reasons.add(result.reason);
    }
  } finally {
    clearTimeout(timer);
    outer.dispose();
  }
  // No usable window: nothing can be claimed about this text.
  if (!completed.length) return null;
  const merged = shadow.mergeWindowLosses(completed);
  // Every planned window answered: an empty list is a real "nothing was lost".
  if (!reasons.size) return merged;
  // A partial answer with no finding must not become a "nothing was lost" claim: the
  // windows that failed could have carried it, so there is no result at all.
  if (!merged.losses.length) return null;
  const incomplete: ShadowIncomplete = {
    requests: plan.requests,
    completed: completed.length,
    reasons: [...reasons].sort(),
  };
  return { ...merged, incomplete };
}

/**
 * Sentence Shadow analysis for the web app. Any failure is a quiet `null`; a partial
 * answer carries `incomplete` so the caller can say the analysis was cut short.
 */
export const analyzeShadow = createServerFn({ method: "POST" })
  .validator((input: unknown) => ShadowInput.parse(input))
  .handler(async ({ data }): Promise<{ shadow: ShadowResult | null }> => {
    return { shadow: await analyzeShadowFor(data, { request: getRequest() }) };
  });
