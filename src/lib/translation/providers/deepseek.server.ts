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

/**
 * Second brain: DeepSeek V4.1 Flash on DeepSeek's own OpenAI-compatible API.
 * `deepseek-flash` always points at the newest Flash build. Thinking is disabled
 * so it answers as fast as a chat reply.
 */
const BASE = "https://api.deepseek.com";
export const DEEPSEEK_MODEL = "deepseek-flash";

/** Server-only. Null until the owner adds the key — the app then runs on one brain. */
export function deepseekKey(): string | null {
  const k = process.env["DEEPSEEK_API_KEY"];
  return k && k.trim() ? k.trim() : null;
}

async function send(
  apiKey: string,
  system: string,
  user: string,
  signal: AbortSignal | undefined,
  stream: boolean,
  json: boolean,
): Promise<Response> {
  const cancelled = () => Object.assign(new Error("cancelled"), { name: "AbortError" });
  if (signal?.aborted) throw cancelled();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let res: Response;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        stream,
        thinking: { type: "disabled" },
        temperature: 0.3,
        max_tokens: 4096,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (err) {
    signal?.removeEventListener("abort", onAbort);
    if (ctrl.signal.aborted || (err as Error)?.name === "AbortError") throw cancelled();
    throw new TranslationError("network", "Could not reach DeepSeek.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403)
      throw new TranslationError("auth", "DeepSeek rejected the key.");
    if (res.status === 402) throw new TranslationError("quota", "DeepSeek balance is empty.");
    if (res.status === 429) throw new TranslationError("rate", "DeepSeek is rate limiting.");
    throw new TranslationError(
      "provider",
      `DeepSeek responded ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
  return res;
}

async function call(apiKey: string, system: string, user: string, signal?: AbortSignal) {
  const res = await send(apiKey, system, user, signal, false, true);
  const payload = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const text = payload.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new TranslationError("provider", "Empty DeepSeek reply.");
  return text;
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
    false,
  );
  if (!res.body) throw new TranslationError("provider", "Empty DeepSeek stream.");
  return textDeltas(res.body);
}

export async function streamDeepSeekFull(
  apiKey: string,
  req: TranslationRequest,
  signal?: AbortSignal,
): Promise<AsyncGenerator<string>> {
  const res = await send(apiKey, buildSystemPrompt(), buildUserPrompt(req), signal, true, true);
  if (!res.body) throw new TranslationError("provider", "Empty DeepSeek stream.");
  return textDeltas(res.body);
}

export function createDeepSeekProvider(apiKey: string): TranslationProvider {
  return {
    id: "deepseek",
    async translate(req, signal) {
      return parseResult(
        await call(apiKey, buildSystemPrompt(), buildUserPrompt(req), signal),
        req,
      );
    },
    async repair(req, previous, issues, signal) {
      const raw = await call(
        apiKey,
        buildSystemPrompt(),
        buildRepairPrompt(req, previous, issues),
        signal,
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
  const raw = await call(apiKey, buildSystemPrompt(), buildReviewPrompt(req, previous), signal);
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
