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
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let res: Response;
  try {
    res = await fetch(`${BASE}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-opencode-session": SESSION,
      },
      signal: ctrl.signal,
      body: JSON.stringify(body),
    });
  } catch (err) {
    signal?.removeEventListener("abort", onAbort);
    if (ctrl.signal.aborted || (err as Error)?.name === "AbortError") throw cancelled();
    throw new TranslationError("network", "Could not reach the translation provider.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403)
      throw new TranslationError("auth", "The translation provider rejected the credentials.");
    if (res.status === 402)
      throw new TranslationError("quota", "The provider account has no remaining funds.");
    if (res.status === 429)
      throw new TranslationError("rate", "The translation provider is rate limiting requests.");

    throw new TranslationError(
      "provider",
      `Provider responded ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
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

/** Reads the provider's SSE stream and yields only the answer-text deltas. */
export async function* textDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const evt = JSON.parse(data);
          if (evt?.type === "response.output_text.delta" && typeof evt.delta === "string")
            yield evt.delta;
          else if (typeof evt?.choices?.[0]?.delta?.content === "string")
            yield evt.choices[0].delta.content;
          else if (evt?.type === "response.failed" || evt?.type === "error")
            throw new TranslationError("provider", "The provider stream failed.");
        } catch (err) {
          if (err instanceof TranslationError) throw err;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Live (still-typing) translation as a plain-text stream. */
export async function streamLiveTranslation(
  apiKey: string,
  req: TranslationRequest,
  signal?: AbortSignal,
): Promise<AsyncGenerator<string>> {
  const res = await send(apiKey, buildLiveSystemPrompt(), buildLiveUserPrompt(req), signal, true);
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
): Promise<AsyncGenerator<string>> {
  const res = await send(apiKey, buildSystemPrompt(), buildUserPrompt(req), signal, true);
  if (!res.body) throw new TranslationError("provider", "Empty provider stream.");
  return textDeltas(res.body);
}
