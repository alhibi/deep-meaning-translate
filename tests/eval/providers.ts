import {
  buildLiveSystemPrompt,
  buildLiveUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from "../../src/lib/translation/prompt";
import { capabilityRequest } from "../../src/lib/translation/providers/capabilities";
import { completionError } from "../../src/lib/translation/providers/completion";
import { parseResult } from "../../src/lib/translation/parse";
import type { TranslationRequest, TranslationResult } from "../../src/lib/translation/types";
import type { EvalCase } from "./corpus/types";

export const DEEPSEEK_BASE = "https://api.deepseek.com";
export const EVAL_MODEL = "deepseek-flash";
/** A different documented model on the same account; used ONLY as a secondary signal. */
export const JUDGE_MODEL = "deepseek-v4-pro";

export type ConfigId = "production-full" | "reasoning-high" | "reasoning-max";

export interface EvalConfig {
  id: ConfigId;
  label: string;
  /** One line a reader can verify against providers/capabilities.ts. */
  detail: string;
  /** The exact documented capability fragment this configuration sends. */
  capability: ReturnType<typeof capabilityRequest>;
}

/**
 * The controlled comparison: the current production full profile vs the two deeper
 * reasoning shapes the product already documents for background work. Reusing the
 * production repair/analysis profiles means the comparison never invents a parameter.
 */
export function configFor(id: ConfigId, chars: number): EvalConfig {
  if (id === "production-full")
    return {
      id,
      label: "production full (thinking disabled, temperature 0.3, JSON)",
      detail: 'capabilityRequest("full") as shipped in providers/capabilities.ts',
      capability: capabilityRequest("full", chars),
    };
  if (id === "reasoning-high")
    return {
      id,
      label: "deeper reasoning (thinking on, effort high, JSON)",
      detail: 'capabilityRequest("repair") shape applied to the full system prompt',
      capability: capabilityRequest("repair", chars),
    };
  return {
    id,
    label: "deeper reasoning (thinking on, effort max, JSON)",
    detail: 'capabilityRequest("analysis") shape applied to the full system prompt',
    capability: capabilityRequest("analysis", chars),
  };
}

export interface Usage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  reasoning_tokens: number | null;
}

export interface CallResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  model: string | null;
  finishReason: string | null;
  completionError: string | null;
  usage: Usage;
  raw: string | null;
  error: string | null;
}

const emptyUsage = (): Usage => ({
  prompt_tokens: null,
  completion_tokens: null,
  total_tokens: null,
  reasoning_tokens: null,
});

function readUsage(payload: Record<string, unknown>): Usage {
  const usage = payload["usage"];
  if (!usage || typeof usage !== "object") return emptyUsage();
  const u = usage as Record<string, unknown>;
  const details = u["completion_tokens_details"];
  const reasoning =
    details && typeof details === "object"
      ? (details as Record<string, unknown>)["reasoning_tokens"]
      : null;
  const num = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    prompt_tokens: num(u["prompt_tokens"]),
    completion_tokens: num(u["completion_tokens"]),
    total_tokens: num(u["total_tokens"]),
    reasoning_tokens: num(reasoning),
  };
}

/**
 * One documented non-streaming chat completion with the production safety deadline.
 * The provider's own path (providers/request.server.ts) aborts at 60 s; mirroring that
 * here means a configuration that cannot answer inside the production deadline fails
 * the same way it would in the app. The key is used server-side and never printed.
 */
export async function chatOnce(
  key: string,
  body: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { ...newBase(latencyMs), status: response.status, error: `http ${response.status}` };
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const choices = Array.isArray(payload["choices"]) ? payload["choices"] : [];
    const choice = (choices[0] ?? {}) as Record<string, unknown>;
    const message = (choice["message"] ?? {}) as Record<string, unknown>;
    const finish = typeof choice["finish_reason"] === "string" ? choice["finish_reason"] : null;
    const raw = typeof message["content"] === "string" ? message["content"] : null;
    const failure = completionError(finish);
    return {
      ok: failure === null && raw !== null,
      status: response.status,
      latencyMs,
      model: typeof payload["model"] === "string" ? payload["model"] : null,
      finishReason: finish,
      completionError: failure ? failure.message : null,
      usage: readUsage(payload),
      raw,
      error: raw === null ? "empty content" : null,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const aborted = (error as Error | null)?.name === "AbortError";
    return {
      ...newBase(latencyMs),
      error: aborted ? `timeout after ${timeoutMs} ms` : "network",
    };
  } finally {
    clearTimeout(timer);
  }
}

const newBase = (latencyMs: number): CallResult => ({
  ok: false,
  status: null,
  latencyMs,
  model: null,
  finishReason: null,
  completionError: null,
  usage: emptyUsage(),
  raw: null,
  error: null,
});

export interface TranslationRun {
  call: CallResult;
  result: TranslationResult | null;
  parseError: string | null;
}

/** Translate one corpus row through one configuration, exactly as the full path would parse it. */
export async function translateCase(
  key: string,
  testCase: EvalCase,
  config: ConfigId,
): Promise<TranslationRun> {
  const req: TranslationRequest = requestForCase(testCase);
  const capability = configFor(config, req.text.length).capability;
  const body: Record<string, unknown> = {
    model: EVAL_MODEL,
    stream: false,
    ...capability,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(req) },
    ],
  };
  const call = await chatOnce(key, body);
  if (!call.ok || call.raw === null) return { call, result: null, parseError: null };
  try {
    return { call, result: parseResult(call.raw, req), parseError: null };
  } catch (error) {
    return { call, result: null, parseError: (error as Error).message };
  }
}

export function requestForCase(testCase: EvalCase): TranslationRequest {
  const arTarget = testCase.direction === "de→ar";
  return {
    text: testCase.source,
    source: arTarget ? "de" : "ar",
    target: arTarget ? "ar" : "de",
    style: testCase.style,
    ...(arTarget ? { dialect: testCase.dialect ?? "auto" } : {}),
  };
}

export interface LiveStreamRun {
  ok: boolean;
  ttftMs: number | null;
  totalMs: number;
  usage: Usage;
  finishReason: string | null;
  error: string | null;
  text: string;
}

/** The live typing path: plain-text streaming, thinking explicitly disabled. */
export async function streamLiveCase(key: string, testCase: EvalCase): Promise<LiveStreamRun> {
  const req = requestForCase(testCase);
  const capability = capabilityRequest("live", req.text.length);
  const body: Record<string, unknown> = {
    model: EVAL_MODEL,
    stream: true,
    stream_options: { include_usage: true },
    ...capability,
    messages: [
      { role: "system", content: buildLiveSystemPrompt() },
      { role: "user", content: buildLiveUserPrompt(req) },
    ],
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const started = performance.now();
  let ttftMs: number | null = null;
  let text = "";
  let finish: string | null = null;
  let usage = emptyUsage();
  try {
    const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return { ...emptyLive(), error: `http ${response.status}` };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const line = event.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const choices = Array.isArray(chunk["choices"]) ? chunk["choices"] : [];
        const choice = (choices[0] ?? {}) as Record<string, unknown>;
        const delta = (choice["delta"] ?? {}) as Record<string, unknown>;
        if (typeof delta["content"] === "string" && delta["content"].length > 0) {
          if (ttftMs === null) ttftMs = Math.round(performance.now() - started);
          text += delta["content"];
        }
        if (typeof choice["finish_reason"] === "string") finish = choice["finish_reason"];
        const chunkUsage = readUsage(chunk);
        if (chunkUsage.total_tokens !== null) usage = chunkUsage;
      }
    }
    const failure = completionError(finish);
    return {
      ok: failure === null,
      ttftMs,
      totalMs: Math.round(performance.now() - started),
      usage,
      finishReason: finish,
      error: failure ? failure.message : null,
      text,
    };
  } catch (error) {
    const aborted = (error as Error | null)?.name === "AbortError";
    return {
      ...emptyLive(),
      totalMs: Math.round(performance.now() - started),
      error: aborted ? "timeout after 30000 ms" : "network",
    };
  } finally {
    clearTimeout(timer);
  }
}

const emptyLive = (): LiveStreamRun => ({
  ok: false,
  ttftMs: null,
  totalMs: 0,
  usage: emptyUsage(),
  finishReason: null,
  error: null,
  text: "",
});

export interface JudgeScores {
  meaning: number;
  naturalness: number;
  register: number;
  facts: number;
  noInvention: number;
}

export interface JudgeRun {
  model: string;
  scores: JudgeScores | null;
  note: string | null;
  error: string | null;
  latencyMs: number;
}

const JUDGE_SYSTEM =
  "You are an independent bilingual translation-quality judge for Arabic and German. " +
  "You did not write this translation and you are not the translator. Judge the candidate " +
  "against the source only. Score 1-5: meaning (5 = the full meaning and intent survived), " +
  "naturalness (5 = a native would write it), register (5 = the requested style is audible " +
  "and right for the situation), facts (5 = names, numbers, dates, polarity and units survive), " +
  "noInvention (5 = nothing was added, explained or softened). Idiomatic adaptation is good " +
  "when the meaning is equivalent; do not reward literal word matching. " +
  'Return ONLY JSON: {"meaning":n,"naturalness":n,"register":n,"facts":n,"noInvention":n,"note":"<=160 chars"}';

/** Secondary signal only: a different documented model with independent instructions. */
export async function judgeCase(
  key: string,
  testCase: EvalCase,
  translation: string,
): Promise<JudgeRun> {
  const req = requestForCase(testCase);
  const user = [
    `Direction: ${testCase.direction}; requested style: ${testCase.style}` +
      (req.dialect ? `; requested Arabic variety: ${req.dialect}` : "") +
      `; situation: ${testCase.context}.`,
    "<source>",
    testCase.source,
    "</source>",
    "<candidate>",
    translation,
    "</candidate>",
    "Return only the JSON object.",
  ].join("\n");
  const body = {
    model: JUDGE_MODEL,
    stream: false,
    thinking: { type: "disabled" },
    temperature: 0,
    max_tokens: 1_024,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: user },
    ],
  };
  const call = await chatOnce(key, body, 60_000);
  if (!call.ok || call.raw === null)
    return {
      model: call.model ?? JUDGE_MODEL,
      scores: null,
      note: null,
      error: call.error ?? call.completionError,
      latencyMs: call.latencyMs,
    };
  try {
    const parsed = JSON.parse(call.raw) as Record<string, unknown>;
    const score = (value: unknown) =>
      typeof value === "number" && value >= 1 && value <= 5 ? value : Number.NaN;
    const scores: JudgeScores = {
      meaning: score(parsed["meaning"]),
      naturalness: score(parsed["naturalness"]),
      register: score(parsed["register"]),
      facts: score(parsed["facts"]),
      noInvention: score(parsed["noInvention"]),
    };
    if (Object.values(scores).some((value) => Number.isNaN(value)))
      return {
        model: call.model ?? JUDGE_MODEL,
        scores: null,
        note: null,
        error: "invalid judge scores",
        latencyMs: call.latencyMs,
      };
    return {
      model: call.model ?? JUDGE_MODEL,
      scores,
      note: typeof parsed["note"] === "string" ? parsed["note"].slice(0, 200) : null,
      error: null,
      latencyMs: call.latencyMs,
    };
  } catch {
    return {
      model: call.model ?? JUDGE_MODEL,
      scores: null,
      note: null,
      error: "judge reply was not JSON",
      latencyMs: call.latencyMs,
    };
  }
}
