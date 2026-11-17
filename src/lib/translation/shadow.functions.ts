import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { takeEnrichmentToken } from "./throttle";
import { getRequest } from "@tanstack/react-start/server";
import { clientAddress, sameOrigin } from "../requestSafety";
import { MAX_SOURCE, MAX_TRANSLATION, type Loss, type ShadowResult } from "./shadow";

/** Non-blank bounded text. No trimming transform: offsets must match the shown string. */
const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, { message: "Text is blank." });

/**
 * Shadow input is bounded to the same 5,000-unit draft limit as a translation. A longer
 * source is windowed inside `planShadowWindows`; the bound keeps one request's body and
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
  /** The incoming request: source of the same-origin check and the admission identity. */
  request: Request;
  /**
   * The native gate already authorized this transport by exact origin allowlist. It is
   * still the same domain function, admission bucket and provider path as the web surface.
   */
  crossOrigin?: boolean;
}

/**
 * The one Sentence Shadow analysis path, shared by the web server function and the native
 * route.
 *
 * Provider independence is the point: this module owns the prompt, the window plan and the
 * parser (all in shadow.ts) and asks `engine.server.runAnalysis` for the text — it never
 * imports a provider. The analysis capability profile (thinking at max effort, JSON mode)
 * is chosen by the engine, and every call gets the deep-reasoning timeout.
 *
 * A broken reply or a failed window returns `null` (no shadow shown) rather than an empty
 * list: "nothing was lost" must be a claim the model actually made.
 */
export async function analyzeShadowFor(
  data: ShadowInputValue,
  surface: ShadowSurface,
): Promise<ShadowResult | null> {
  const shadow = await import("./shadow");
  if (!shadow.isShadowCandidate(data.text)) return null;
  // The native surface is cross-origin by design; its gate already ran. The browser RPC
  // keeps the same-origin contract.
  if (!surface.crossOrigin && !sameOrigin(surface.request)) return null;
  if (!takeEnrichmentToken(clientAddress(surface.request))) return null;
  const windows = shadow.planShadowWindows(data.text);
  if (!windows.length) return null;
  const { runAnalysis } = await import("./engine.server");
  try {
    const replies = await Promise.all(
      windows.map(async (window) => {
        const raw = await runAnalysis(
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
              windows.length > 1 ? { index: window.index + 1, total: windows.length } : undefined,
            contextBefore: window.contextBefore || undefined,
            contextAfter: window.contextAfter || undefined,
          }),
          {
            signal: AbortSignal.timeout(shadow.SHADOW_TIMEOUT_MS),
            chars: window.text.length + data.translation.length,
          },
        );
        return { raw, window };
      }),
    );
    const groups: Loss[][] = [];
    for (const reply of replies) {
      const parsed = shadow.readWindowShadowReply(reply.raw, reply.window, data.translation);
      // One unusable window must not become an empty-list claim for the whole text.
      if (!parsed) return null;
      groups.push(parsed);
    }
    return shadow.mergeWindowLosses(groups);
  } catch {
    return null;
  }
}

/** Sentence Shadow analysis for the web app. Any failure is a quiet `null`. */
export const analyzeShadow = createServerFn({ method: "POST" })
  .validator((input: unknown) => ShadowInput.parse(input))
  .handler(async ({ data }): Promise<{ shadow: ShadowResult | null }> => {
    return { shadow: await analyzeShadowFor(data, { request: getRequest() }) };
  });
