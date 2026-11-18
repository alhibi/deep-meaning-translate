import { partialTranslation } from "./parse";
import {
  buildLiveSystemPrompt,
  buildLiveUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from "./prompt";
import { readProviderKey } from "./providerKey";
import { beginTransport } from "../native/diagnostics";
import { TranslationError, type TranslationRequest } from "./types";
import { assertContextFits, capabilityRequest, type TaskProfile } from "./providers/capabilities";
import { completionError, requireCompletion } from "./providers/completion";

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

/** Caller cancellation is a quiet end, never a provider failure the UI could retry. */
function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

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
): { system: string; user: string; chars: number } {
  const request = data as unknown as TranslationRequest;
  return mode === "full"
    ? {
        system: buildSystemPrompt("deepseek"),
        user: buildUserPrompt(request, "deepseek"),
        chars: request.text.length,
      }
    : {
        system: buildLiveSystemPrompt("deepseek"),
        user: buildLiveUserPrompt(request, "deepseek"),
        chars: request.text.length,
      };
}

/**
 * The documented request shape of the task class. The full settled reply always asks for
 * JSON output, streaming or not, so the client's partial-JSON reader receives a JSON
 * envelope; the live provisional stream stays plain text (fastest first words).
 */
function requestPayload(
  data: Record<string, unknown>,
  mode: "live" | "full",
  stream: boolean,
): string {
  const { system, user, chars } = bodyFor(data, mode);
  const capabilities = capabilityRequest(mode, chars);
  assertContextFits(system.length + user.length, capabilities.max_tokens);
  return JSON.stringify({
    model: DIRECT_MODEL,
    stream,
    ...capabilities,
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

/**
 * Native HTTP fallback: some WebViews/proxies refuse cross-origin fetch even though the
 * device can reach api.deepseek.com. CapacitorHttp uses the Android network stack, so the
 * same key and body work without CORS. It returns one complete response instead of a
 * stream, which is exactly right for the fallback path.
 */
async function callDirectNative(
  data: Record<string, unknown>,
  mode: "live" | "full",
  signal?: AbortSignal | undefined,
): Promise<string> {
  const key = readProviderKey();
  if (!key) throw new TranslationError("auth", "No personal key.");
  // CapacitorHttp cannot cancel an in-flight call: never start one for a request whose
  // caller already left, and discard the answer if it left while the call was running.
  if (signal?.aborted) throw abortError();
  const { CapacitorHttp } = await import("@capacitor/core");
  const payload = JSON.parse(requestPayload(data, mode, false)) as Record<string, unknown>;
  const res = await CapacitorHttp.post({
    url: DIRECT_URL,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    data: payload,
    responseType: "json",
    connectTimeout: 20_000,
    readTimeout: 90_000,
  });
  if (res.status === 401 || res.status === 403) throw new TranslationError("auth", "auth");
  if (res.status === 402) throw new TranslationError("quota", "quota");
  if (res.status === 429) throw new TranslationError("rate", "rate");
  if (signal?.aborted) throw abortError();
  if (res.status < 200 || res.status >= 300)
    throw new TranslationError("provider", `DeepSeek responded ${res.status}`);
  const value = res.data as {
    choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  };
  const choice = value?.choices?.[0];
  // The buffered transport is still a provider completion: a cut reply is a provider
  // error, never a text that the JSON parser later rejects (TD34/TD35).
  requireCompletion(choice?.finish_reason);
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim())
    throw new TranslationError("provider", "Empty direct reply.");
  return text;
}

interface DirectSseEvent {
  delta: string;
  finishReason: string | null;
  /** The `[DONE]` protocol terminator. */
  done: boolean;
  /** A provider error envelope. */
  failed: boolean;
}

/** Reads one "data: {...}" SSE payload into its text delta and protocol fields. */
export function eventFromSsePayload(payload: string): DirectSseEvent | null {
  const raw = payload.trim();
  if (!raw) return null;
  if (raw === "[DONE]") return { delta: "", finishReason: null, done: true, failed: false };
  try {
    const value = JSON.parse(raw) as {
      error?: unknown;
      choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
    };
    if (value?.error) return { delta: "", finishReason: null, done: false, failed: true };
    const choice = value.choices?.[0];
    const delta = typeof choice?.delta?.content === "string" ? choice.delta.content : "";
    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
    return { delta, finishReason, done: false, failed: false };
  } catch {
    return null; // keep-alive or a non-JSON line, not answer data
  }
}

/** Text delta only; kept because the parse path and tests use it directly. */
export function deltaFromSsePayload(payload: string): string {
  return eventFromSsePayload(payload)?.delta ?? "";
}

/**
 * Reads the direct DeepSeek SSE body and yields answer text.
 *
 * A complete answer is a protocol fact, not a guess from the closing bytes. This mirrors
 * the server's `textDeltas` contract (TD34): `finish_reason: "stop"` or `[DONE]` completes
 * the reply; `finish_reason: "length"` / `content_filter` / any unknown reason and a
 * premature EOF are provider errors. A cut reply must never be committed. The
 * `reasoning_content` deltas of a thinking model are ignored: only the answer is text.
 */
export async function* directDeltas(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal | undefined,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  // The same discipline as the web stream reader: a caller abort must stop the active
  // body reader instead of leaving read() pending on a body that never chunks again
  // (TD40). The listener is removed and the reader released in the finally below.
  const stopReading = () => {
    void reader.cancel().catch(() => {});
  };
  if (signal) {
    signal.addEventListener("abort", stopReading, { once: true });
    if (signal.aborted) stopReading();
  }
  const handle = (rawLine: string): string => {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) return "";
    const event = eventFromSsePayload(line.slice(5).trim());
    if (!event) return "";
    if (event.failed) throw new TranslationError("provider", "The provider stream failed.");
    if (event.done) {
      completed = true;
      return "";
    }
    if (event.finishReason !== null) {
      const failure = completionError(event.finishReason);
      if (failure) throw failure;
      completed = true;
    }
    return event.delta;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() + "\n" : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const delta = handle(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (delta) yield delta;
      }
      if (done) break;
    }
    if (!completed) throw new TranslationError("provider", "Incomplete provider stream.");
  } finally {
    signal?.removeEventListener("abort", stopReading);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
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
  let payload: string;
  try {
    payload = requestPayload(data, mode, true);
  } catch (error) {
    if (error instanceof TranslationError) return { ok: false, kind: error.kind };
    return { ok: false, kind: "provider" };
  }
  const diagnostics = beginTransport({
    transport: "deepseek-direct",
    method: "POST",
    url: DIRECT_URL,
  });
  // Do not let a WebView that accepts a request but never receives a response hold the
  // screen for the full 90 s timeout. If the first response does not arrive quickly, fall
  // through to the Android network stack (which has no CORS and different proxy handling).
  const first = new AbortController();
  const abortFirst = () => first.abort();
  signal.addEventListener("abort", abortFirst, { once: true });
  const firstTimer = setTimeout(() => first.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(DIRECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: payload,
      signal: first.signal,
      credentials: "omit",
      cache: "no-store",
    });
  } catch (error) {
    if (signal.aborted) return { ok: false, kind: "provider", cancelled: true };
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      return { ok: false, kind: "offline" };
    // WebView fetch can fail where the Android stack succeeds (CORS/proxy quirks).
    try {
      const text = await callDirectNative(data, mode, signal);
      if (signal.aborted) return { ok: false, kind: "provider", cancelled: true };
      onText(mode === "full" ? partialTranslation(text).trim() : text.trim());
      return { ok: true, text };
    } catch {
      /* report the original fetch failure below */
    }
    const name = (error as Error)?.name;
    return {
      ok: false,
      kind: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    };
  } finally {
    clearTimeout(firstTimer);
    signal.removeEventListener("abort", abortFirst);
  }
  diagnostics.finish({
    stage: "response",
    status: res.status,
    contentType: res.headers.get("content-type") ?? undefined,
  });
  if (!res.ok || !res.body) {
    void res.body?.cancel().catch(() => {});
    const kind = res.status === 429 ? "rate" : errorKind(res.status);
    diagnostics.finish({ stage: "error", kind: res.status === 429 ? "http-429" : kind });
    return { ok: false, kind };
  }
  // A CORS/proxy/WebView failure below is retried through the Android network stack once;
  // a real HTTP status was already classified above and must not be retried.

  let raw = "";
  let visible = "";
  const emit = (next: string) => {
    if (next && next !== visible) {
      visible = next;
      onText(next);
    }
  };
  try {
    // The caller's abort cancels the active body reader too (TD40), not only the
    // pre-handshake fetch: a superseded request on the phone must stop reading.
    for await (const delta of directDeltas(res.body, signal)) {
      raw += delta;
      emit(mode === "full" ? partialTranslation(raw).trim() : raw.trim());
    }
  } catch (error) {
    if (signal.aborted) return { ok: false, kind: "provider", cancelled: true };
    // A protocol failure is a provider fact, not a transport accident: the response was
    // already handed off, so it must not be replayed through the buffered transport.
    if (error instanceof TranslationError) return { ok: false, kind: error.kind };
    // The stream died mid-read; try the Android stack once before giving up.
    try {
      const text = await callDirectNative(data, mode, signal);
      if (signal.aborted) return { ok: false, kind: "provider", cancelled: true };
      onText(mode === "full" ? partialTranslation(text).trim() : text.trim());
      return { ok: true, text };
    } catch {
      return { ok: false, kind: "network" };
    }
  }
  // The body ended only because the reader was cancelled: that is a cancellation, not a
  // complete answer, and it must never be committed as one.
  if (signal.aborted) {
    diagnostics.finish({ stage: "error", kind: "abort", cancelled: true });
    return { ok: false, kind: "provider", cancelled: true };
  }
  raw = raw.trim();
  diagnostics.finish({
    stage: raw ? "done" : "error",
    ...(raw ? {} : { kind: "empty" as const }),
  });
  return raw ? { ok: true, text: raw } : { ok: false, kind: "provider" };
}

/** A non-streaming completion with caller-supplied prompts (repair/review paths). */
export async function callPromptDirect(
  system: string,
  user: string,
  structured: boolean,
  chars: number,
  signal?: AbortSignal,
  profile: TaskProfile = structured ? "repair" : "live",
): Promise<string> {
  const key = readProviderKey();
  if (!key) throw new TranslationError("auth", "No personal key.");
  const capabilities = capabilityRequest(profile, chars);
  assertContextFits(system.length + user.length, capabilities.max_tokens);
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
        ...capabilities,
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
    choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  };
  const choice = payload.choices?.[0];
  requireCompletion(choice?.finish_reason);
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim())
    throw new TranslationError("provider", "Empty direct reply.");
  return text;
}
