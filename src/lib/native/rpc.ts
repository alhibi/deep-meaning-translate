/**
 * Transport switch for the app's enrichment calls.
 *
 * The browser keeps using TanStack's server-function RPC. The installed app posts to the
 * versioned native routes, because `/_serverFn/...` resolves against the WebView's local
 * asset origin. The Schemas, provider routing and prompts are the same modules either way.
 *
 * Every quiet call takes an optional AbortSignal. It is forwarded to the actual transport
 * (native fetch / the server function's fetch), so aborting a superseded dictionary,
 * shadow or review request cancels the wire instead of only rejecting a local promise.
 */
import { isNativeApp } from "./config";
import { nativeJson } from "./transport";
import type { TranslationResult } from "../translation/types";
import type { LexiconResult } from "../translation/lexicon";
import type { ShadowResult } from "../translation/shadow";
import { hasProviderKey } from "../translation/providerKey";

export async function callRepair(input: {
  data: { request: unknown; previous: TranslationResult };
  signal?: AbortSignal | undefined;
}): Promise<{ ok: true; result: TranslationResult | null }> {
  if (isNativeApp() && hasProviderKey()) {
    const { repairDirect } = await import("../translation/directRepair");
    const request = input.data.request as Parameters<typeof repairDirect>[0];
    return {
      ok: true,
      result: await repairDirect(request, input.data.previous, input.signal),
    };
  }
  if (isNativeApp()) {
    return nativeJson<{ ok: true; result: TranslationResult | null }>(
      "/api/native/v1/repair",
      input.data,
      30_000,
      input.signal,
    ).catch(() => ({ ok: true as const, result: null }));
  }
  // Loaded on demand: a caller that only repairs should not pull the speech or
  // dictionary server-function clients into its module graph.
  const { repairTranslation } = await import("../translation/translate.functions");
  return repairTranslation({
    data: input.data as never,
    ...(input.signal ? { signal: input.signal } : {}),
  }) as Promise<{
    ok: true;
    result: TranslationResult | null;
  }>;
}

export async function callLexicon(input: {
  data: {
    text: string;
    source: string;
    target: string;
    uiLocale: "ar" | "en" | "de";
    translation?: string;
    /** Full source sentence for context ranking (lexicon v2). */
    context?: string;
    dialect?: string;
    /** Register the reading is ranked for (lexicon v2). */
    style?: string;
  };
  signal?: AbortSignal | undefined;
}): Promise<{ ok: true; lexicon: LexiconResult | null }> {
  if (isNativeApp()) {
    return nativeJson<{ ok: true; lexicon: LexiconResult | null }>(
      "/api/native/v1/lexicon",
      input.data,
      30_000,
      input.signal,
    ).catch(() => ({ ok: true as const, lexicon: null }));
  }
  const { lookupLexicon } = await import("../translation/lexicon.functions");
  return lookupLexicon({
    data: input.data as never,
    ...(input.signal ? { signal: input.signal } : {}),
  }) as Promise<{
    ok: true;
    lexicon: LexiconResult | null;
  }>;
}

export async function callShadow(input: {
  data: {
    text: string;
    translation: string;
    source: string;
    target: string;
    style: string;
    uiLocale: "ar" | "en" | "de";
    dialect?: string;
  };
  signal?: AbortSignal | undefined;
}): Promise<{ shadow: ShadowResult | null }> {
  if (isNativeApp()) {
    return nativeJson<{ shadow: ShadowResult | null }>(
      "/api/native/v1/shadow",
      input.data,
      30_000,
      input.signal,
    ).catch(() => ({ shadow: null }));
  }
  const { analyzeShadow } = await import("../translation/shadow.functions");
  return analyzeShadow({
    data: input.data as never,
    ...(input.signal ? { signal: input.signal } : {}),
  }) as Promise<{ shadow: ShadowResult | null }>;
}

export async function callDictationToken(
  input: { signal?: AbortSignal | undefined } = {},
): Promise<{ ok: true; token: string } | { ok: false; status?: number; message: string }> {
  if (isNativeApp()) {
    return nativeJson<{ ok: true; token: string } | { ok: false; message: string }>(
      "/api/native/v1/dictation-token",
      {},
      20_000,
      input.signal,
    ).catch(() => ({ ok: false as const, message: "Could not start dictation." }));
  }
  const { assemblyToken } = await import("../assembly.functions");
  return assemblyToken({
    ...(input.signal ? { signal: input.signal } : {}),
  }) as Promise<{ ok: true; token: string } | { ok: false; status?: number; message: string }>;
}
