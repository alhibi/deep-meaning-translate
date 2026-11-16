import { outputTokenBudget } from "./budget";
import { partialTranslation } from "./parse";
import {
  buildLiveSystemPrompt,
  buildLiveUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from "./prompt";
import { readProviderKey } from "./providerKey";
import { TranslationError, type TranslationRequest } from "./types";

/**
 * Direct, device-issued DeepSeek calls for the personal-key mode.
 *
 * This is the escape hatch for a phone whose network cannot reach today's Worker, or for
 * someone who wants their own provider quota and no shared admission budget. The key is
 * read from device storage and used only for this request; it is never sent to today's
 * server, never logged and never bundled. api.deepseek.com reflects the local origin in
 * CORS, so the same streaming path works inside the WebView as it does on a server.
 *
 * The default provider path remains the deployed service; direct mode activates only when
 * a valid key is present in the Android app.
 */
const DIRECT_URL = "https://api.deepseek.com/chat/completions";
export const DIRECT_MODEL = "deepseek-flash";

export type DirectErrorKind =
  "auth" | "quota" | "rate" | "network" | "offline" | "timeout" | "provider" | "input";

export type DirectResponse =
  { ok: true; text: string } | { ok: false; kind: DirectErrorKind; cancelled?: true };

export interface DirectCallbacks {
  onText?: (text: string) => void;
  signal?: AbortSignal;
}

function bodyFor(
  data: Record<string, unknown>,
  mode: "live" | "full",
  stream: boolean,
): { system: string; user: string; chars: number } {
  const request = data as unknown as TranslationRequest;
  return mode === "full"
    ? {
        system: buildSystemPrompt(),
        user: buildUserPrompt(request),
        chars: request.text.length,
      }
    : {
        system: buildLiveSystemPrompt(),
        user: buildLiveUserPrompt(request),
        chars: request.text.length,
      };
}

function requestPayload(
  data: Record<string, unknown>,
  mode: "live" | "full",
  stream: boolean,
): string {
  const { system, user, chars } = bodyFor(data, mode, stream);
  return JSON.stringify({
    model: DIRECT_MODEL,
    stream,
    thinking: { type: "disabled" },
    temperature: 0.3,
    max_tokens: outputTokenBudget(chars, mode === "full"),
    ...(mode === "full" && !stream ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
}

function errorKind(status: number): "auth" | "quota" | "rate" | "provider" {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 429) return "rate";
  return "provider";
}

/** Reads one "data: {...}" SSE payload into the text delta (or ""). */
export function deltaFromSsePayload(payload: string): string {
  if (!payload || payload === "[DONE]") return "";
  try {
    const value = JSON.parse(payload) as {
      choices?: { delta?: { content?: unknown } }[];
    };
    const delta = value.choices?.[0]?.delta?.content;
    return typeof delta === "string" ? delta : "";
  } catch {
    return "";
  }
}

/**
 * Stream a DeepSeek reply. In full mode the accumulated JSON is progressively reduced to
 * the only value a person can read (the translation); in live mode every delta is text.
 */
export async function streamDirect(
  data: Record<string, unknown>,
  signal: AbortSignal,
  onText: (text: string) => void,
  mode: "live" | "full" = "live",
): Promise<DirectResponse> {
  const key = readProviderKey();
  if (!key) return { ok: false, kind: "auth" };
  let res: Response;
  try {
    res = await fetch(DIRECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: requestPayload(data, mode, true),
      signal,
      credentials: "omit",
      cache: "no-store",
    });
  } catch (error) {
    if (signal.aborted) return { ok: false, kind: "provider", cancelled: true };
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      return { ok: false, kind: "offline" };
    const name = (error as Error)?.name;
    return {
      ok: false,
      kind: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    };
  }
  if (!res.ok || !res.body) {
    void res.body?.cancel().catch(() => {});
    return { ok: false, kind: res.status === 429 ? "rate" : errorKind(res.status) };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  let visible = "";
  const emit = (next: string) => {
    if (next && next !== visible) {
      visible = next;
      onText(next);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) {
          const delta = deltaFromSsePayload(line.slice(5).trim());
          if (delta) {
            raw += delta;
            emit(mode === "full" ? partialTranslation(raw).trim() : raw.trim());
          }
        }
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      const delta = deltaFromSsePayload(tail.slice(5).trim());
      if (delta) {
        raw += delta;
        emit(mode === "full" ? partialTranslation(raw).trim() : raw.trim());
      }
    }
  } catch (error) {
    if (signal.aborted) return { ok: false, kind: "provider", cancelled: true };
    return { ok: false, kind: "network" };
  }
  raw = raw.trim();
  return raw ? { ok: true, text: raw } : { ok: false, kind: "provider" };
}

/** A non-streaming completion with caller-supplied prompts (repair/review paths). */
export async function callPromptDirect(
  system: string,
  user: string,
  structured: boolean,
  chars: number,
  signal?: AbortSignal,
): Promise<string> {
  const key = readProviderKey();
  if (!key) throw new TranslationError("auth", "No personal key.");
  let res: Response;
  try {
    res = await fetch(DIRECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: DIRECT_MODEL,
        stream: false,
        thinking: { type: "disabled" },
        temperature: 0.3,
        max_tokens: outputTokenBudget(chars, structured),
        ...(structured ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      ...(signal ? { signal } : {}),
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new TranslationError("network", "Could not reach DeepSeek directly.");
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => {});
    throw new TranslationError(errorKind(res.status), `DeepSeek responded ${res.status}`);
  }
  const payload = (await res.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const text = payload.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim())
    throw new TranslationError("provider", "Empty direct reply.");
  return text;
}
