import {
  buildLiveSystemPrompt,
  buildLiveUserPrompt,
  buildRepairPrompt,
  buildReviewPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from "../prompt";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "../types";
import { TranslationError } from "../types";
import { parseResult } from "../parse";
import { textDeltas } from "./opencode.server";
import { fetchWithRetry } from "./retry.server";
import { assertContextFits, capabilityRequest, type TaskProfile } from "./capabilities";
import { requireCompletion } from "./completion";

/**
 * Second brain: DeepSeek V4.1 Flash on DeepSeek's own OpenAI-compatible API.
 * `deepseek-flash` is the documented model id (served by DeepSeek-V4.1-Flash-1017); the
 * verified capability contract and its documentation sources live in `capabilities.ts`.
 */
const BASE = "https://api.deepseek.com";
export const DEEPSEEK_MODEL = "deepseek-flash";

/** Server-only. Null until the owner adds the key — the app then runs on one brain. */
export function deepseekKey(): string | null {
  const k = process.env["DEEPSEEK_API_KEY"];
  return k && k.trim() ? k.trim() : null;
}

/**
 * One provider request with the capability shape of its task class.
 *
 * Every call names a profile: the model's thinking mode defaults ON, so an omitted toggle
 * silently turns a fast live request into a reasoning one. The body is built before the
 * fetch so a context-guard failure is an `input` error, never a misreported network one.
 */
async function send(
  apiKey: string,
  system: string,
  user: string,
  signal: AbortSignal | undefined,
  stream: boolean,
  profile: TaskProfile,
  chars: number,
): Promise<Response> {
  const cancelled = () => Object.assign(new Error("cancelled"), { name: "AbortError" });
  if (signal?.aborted) throw cancelled();
  const capabilities = capabilityRequest(profile, chars);
  // Input and output share the documented context window: too much input fails loudly.
  assertContextFits(system.length + user.length, capabilities.max_tokens);
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          stream,
          ...capabilities,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      },
      signal,
    );
  } catch (err) {
    if (signal?.aborted || (err as Error)?.name === "AbortError") throw cancelled();
    throw new TranslationError("network", "Could not reach DeepSeek.");
  }
  if (!res.ok) {
    // Never carry a provider body into an error: it can echo the private input text.
    void res.body?.cancel().catch(() => {});
    if (res.status === 401 || res.status === 403)
      throw new TranslationError("auth", "DeepSeek rejected the key.");
    if (res.status === 402) throw new TranslationError("quota", "DeepSeek balance is empty.");
    if (res.status === 429) throw new TranslationError("rate", "DeepSeek is rate limiting.");
    throw new TranslationError("provider", `DeepSeek responded ${res.status}`);
  }
  return res;
}

/** Per-task overrides for a non-streaming completion. */
export interface ChatSettings {
  /** Task class and its documented capability shape; "full" when omitted. */
  profile?: TaskProfile | undefined;
  signal?: AbortSignal | undefined;
  /** Source characters sizing the runaway ceiling; defaults to the user prompt length. */
  chars?: number | undefined;
}

/**
 * One non-streaming completion. The provider's completion is checked before its text is
 * used: a `length` reply is a provider error, not "malformed model output" (TD35).
 */
export async function chat(
  apiKey: string,
  system: string,
  user: string,
  settings: ChatSettings = {},
): Promise<string> {
  const res = await send(
    apiKey,
    system,
    user,
    settings.signal,
    false,
    settings.profile ?? "full",
    settings.chars ?? user.length,
  );
  const payload = (await res.json()) as {
    choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  };
  const choice = payload.choices?.[0];
  requireCompletion(choice?.finish_reason);
  const text = choice?.message?.content;
  if (typeof text !== "string") throw new TranslationError("provider", "Empty DeepSeek reply.");
  return text;
}

/**
 * Backwards-compatible completion call: `(key, system, user, signal?, chars?)`.
 * An optional settings argument can be passed last; new call sites should use `chat` with
 * an explicit profile (`{ profile: "analysis" }` for dictionary/shadow work).
 */
export async function call(
  apiKey: string,
  system: string,
  user: string,
  signal?: AbortSignal,
  chars = user.length,
  settings: Omit<ChatSettings, "signal" | "chars"> = {},
): Promise<string> {
  return chat(apiKey, system, user, { ...settings, signal, chars });
}

export async function streamDeepSeekLive(
  apiKey: string,
  req: TranslationRequest,
  signal?: AbortSignal,
): Promise<AsyncGenerator<string>> {
  const res = await send(
    apiKey,
    buildLiveSystemPrompt(),
    buildLiveUserPrompt(req),
    signal,
    true,
    "live",
    req.text.length,
  );
  if (!res.body) throw new TranslationError("provider", "Empty DeepSeek stream.");
  return textDeltas(res.body);
}

export async function streamDeepSeekFull(
  apiKey: string,
  req: TranslationRequest,
  signal?: AbortSignal,
): Promise<AsyncGenerator<string>> {
  const res = await send(
    apiKey,
    buildSystemPrompt(),
    buildUserPrompt(req),
    signal,
    true,
    "full",
    req.text.length,
  );
  if (!res.body) throw new TranslationError("provider", "Empty DeepSeek stream.");
  return textDeltas(res.body);
}

export function createDeepSeekProvider(apiKey: string): TranslationProvider {
  return {
    id: "deepseek",
    async translate(req, signal) {
      const raw = await chat(apiKey, buildSystemPrompt(), buildUserPrompt(req), {
        profile: "full",
        signal,
        chars: req.text.length,
      });
      return parseResult(raw, req);
    },
    async repair(req, previous, issues, signal) {
      const raw = await chat(
        apiKey,
        buildSystemPrompt(),
        buildRepairPrompt(req, previous, issues),
        {
          profile: "repair",
          signal,
          chars: req.text.length,
        },
      );
      return parseResult(raw, req);
    },
  };
}

/**
 * Independent review of a finished translation. Returns an improved result,
 * or null when the reviewer judges the original correct.
 */
export async function reviewTranslation(
  apiKey: string,
  req: TranslationRequest,
  previous: TranslationResult,
  signal?: AbortSignal,
): Promise<TranslationResult | null> {
  const raw = await chat(apiKey, buildSystemPrompt(), buildReviewPrompt(req, previous), {
    profile: "review",
    signal,
    chars: req.text.length,
  });
  return parseReview(raw, req);
}

export function parseReview(raw: string, req: TranslationRequest): TranslationResult | null {
  try {
    const obj = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
      verdict?: unknown;
    };
    if (obj.verdict === "keep") return null;
  } catch {
    return null;
  }
  try {
    return parseResult(raw, req);
  } catch {
    return null;
  }
}
