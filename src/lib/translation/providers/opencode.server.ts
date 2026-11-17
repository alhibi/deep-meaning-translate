import {
  buildLiveSystemPrompt,
  buildLiveUserPrompt,
  buildRepairPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from "../prompt";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "../types";
import { TranslationError } from "../types";
import { parseResult } from "../parse";
import {
  LEXICON_SYSTEM,
  lexiconUserPrompt,
  readLexiconReply,
  type LexiconQuery,
  type LexiconResult,
} from "../lexicon";
import { fetchWithRetry, type RetryOptions } from "./retry.server";

const BASE = "https://opencode.ai/zen/go/v1";
const DEFAULT_MODEL = "gpt-6-luna";
const SESSION = "lingua-translator";

function extractText(payload: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped provider JSON, narrowed below
  const p = payload as Record<string, any>;
  if (typeof p?.["output_text"] === "string" && p["output_text"].trim()) return p["output_text"];
  const out = p?.["output"];
  if (Array.isArray(out)) {
    const chunks: string[] = [];
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (typeof c?.text === "string") chunks.push(c.text);
        }
      }
    }
    if (chunks.length) return chunks.join("");
  }
  const choice = p?.["choices"]?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  throw new TranslationError("provider", "Unrecognised provider response shape.");
}

async function send(
  apiKey: string,
  system: string,
  user: string,
  signal: AbortSignal | undefined,
  stream: boolean,
  options: RetryOptions = {},
): Promise<Response> {
  // Luna runs on the Responses endpoint: no hidden thinking, terse output, cached system prompt.
  const body = {
    model: DEFAULT_MODEL,
    stream,
    reasoning: { effort: "none" },
    text: { verbosity: "low" },
    prompt_cache_key: SESSION,
    store: false,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  const cancelled = () => Object.assign(new Error("cancelled"), { name: "AbortError" });
  if (signal?.aborted) throw cancelled();
  // Own controller: a caller disconnect aborts the upstream fetch without letting
  // undici's internal AbortError escape as an unhandled runtime error.
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}/responses`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "x-opencode-session": SESSION,
        },
        body: JSON.stringify(body),
      },
      signal,
      options,
    );
  } catch (err) {
    if (signal?.aborted || (err as Error)?.name === "AbortError") throw cancelled();
    throw new TranslationError("network", "Could not reach the translation provider.");
  }

  if (!res.ok) {
    // Never carry a provider body into an error: it can echo the private input text.
    void res.body?.cancel().catch(() => {});
    if (res.status === 401 || res.status === 403)
      throw new TranslationError("auth", "The translation provider rejected the credentials.");
    if (res.status === 402)
      throw new TranslationError("quota", "The provider account has no remaining funds.");
    if (res.status === 429)
      throw new TranslationError("rate", "The translation provider is rate limiting requests.");

    throw new TranslationError("provider", `Provider responded ${res.status}`);
  }

  return res;
}

async function call(
  apiKey: string,
  system: string,
  user: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const res = await send(apiKey, system, user, signal, false);
  return extractText(await res.json());
}

/** One parsed SSE event, narrowed to the fields both provider protocols use. */
interface StreamEvent {
  type?: unknown;
  delta?: unknown;
  error?: unknown;
  choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
}

/**
 * Reads the provider's SSE stream and yields only the answer-text deltas.
 *
 * A complete answer is a protocol fact, not a guess from the closing bytes: an
 * OpenAI-compatible stream says `choices[0].finish_reason === "stop"`, a Responses stream
 * says `response.completed`. `finish_reason: "length"` and `response.incomplete` mean the
 * provider hit its output cap — the answer is cut, so the stream must reject as a provider
 * error instead of committing a truncated result. `[DONE]` is only tolerated after a
 * normal reason (or by a provider that sends no reason at all); it never overrides
 * truncation, which throws before the terminator is read.
 */
export async function* textDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buf += done ? decoder.decode() + "\n" : decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          // The protocol terminator. A truncated stream has already thrown above, so this
          // can no longer turn a cut answer into a success.
          completed = true;
          continue;
        }
        let evt: StreamEvent;
        try {
          evt = JSON.parse(data) as StreamEvent;
        } catch {
          continue; // tolerant: keep-alive or non-JSON line, not an answer
        }
        if (evt?.error || evt?.type === "response.failed" || evt?.type === "error") {
          throw new TranslationError("provider", "The provider stream failed.");
        }
        if (evt?.type === "response.incomplete") {
          throw new TranslationError("provider", "The provider reply was truncated.");
        }
        if (evt?.type === "response.completed") completed = true;
        if (evt?.type === "response.output_text.delta" && typeof evt.delta === "string") {
          yield evt.delta;
        }
        const choice = evt?.choices?.[0];
        if (!choice) continue;
        if (typeof choice.delta?.content === "string") yield choice.delta.content;
        const reason = choice.finish_reason;
        if (reason === undefined || reason === null) continue;
        if (reason === "stop") completed = true;
        else if (reason === "length")
          throw new TranslationError("provider", "The provider reply was truncated.");
        else if (reason === "content_filter")
          throw new TranslationError("provider", "The provider filtered the reply.");
        else throw new TranslationError("provider", "The provider ended the reply unexpectedly.");
      }
      if (done) break;
    }
    if (!completed) throw new TranslationError("provider", "Incomplete provider stream.");
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Live (still-typing) translation as a plain-text stream. */
export async function streamLiveTranslation(
  apiKey: string,
  req: TranslationRequest,
  signal?: AbortSignal,
  options?: RetryOptions,
): Promise<AsyncGenerator<string>> {
  const res = await send(
    apiKey,
    buildLiveSystemPrompt(),
    buildLiveUserPrompt(req),
    signal,
    true,
    options,
  );
  if (!res.body) throw new TranslationError("provider", "Empty provider stream.");
  return textDeltas(res.body);
}

export function createOpenCodeLunaProvider(apiKey: string): TranslationProvider {
  return {
    id: "opencode",
    async translate(req, signal) {
      const raw = await call(apiKey, buildSystemPrompt(), buildUserPrompt(req), signal);
      return parseResult(raw, req);
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

/** Final sentence: the full structured JSON, streamed so the translation text shows while it is written. */
export async function streamFullTranslation(
  apiKey: string,
  req: TranslationRequest,
  signal?: AbortSignal,
  options?: RetryOptions,
): Promise<AsyncGenerator<string>> {
  const res = await send(apiKey, buildSystemPrompt(), buildUserPrompt(req), signal, true, options);
  if (!res.body) throw new TranslationError("provider", "Empty provider stream.");
  return textDeltas(res.body);
}

/** Optional dictionary pass. It is deliberately separate so translation streaming is never delayed. */
export async function analyzeLexicon(
  apiKey: string,
  input: Parameters<typeof analyzeLexiconWith>[1],
  signal?: AbortSignal,
): Promise<LexiconResult | null> {
  return analyzeLexiconWith((s, u) => call(apiKey, s, u, signal), input);
}

/** Same dictionary analysis on any chat model (the analysis provider supplies the call). */
export async function analyzeLexiconWith(
  chat: (system: string, user: string) => Promise<string>,
  input: {
    text: string;
    source: string;
    target: string;
    uiLocale: "ar" | "en" | "de";
    translation?: string | undefined;
    dialect?: string | undefined;
  },
): Promise<LexiconResult | null> {
  // The prompt and parser are the lexicon module's contract; this wrapper only supplies a
  // chat function so a caller can use any model without importing its provider module.
  const query: LexiconQuery = {
    text: input.text,
    source: input.source,
    target: input.target,
    uiLocale: input.uiLocale,
    ...(input.translation ? { translation: input.translation } : {}),
    ...(input.dialect && input.dialect !== "auto"
      ? { dialect: input.dialect as LexiconQuery["dialect"] }
      : {}),
    style: "natural",
  };
  return readLexiconReply(await chat(LEXICON_SYSTEM, lexiconUserPrompt(query)));
}
