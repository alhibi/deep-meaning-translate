import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from "../prompt";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "../types";
import { TranslationError } from "../types";

const ENDPOINT = "https://opencode.ai/zen/go/v1/responses";
const MODEL = "gpt-5.6-luna";
const SESSION = "lingua-translator";

function extractText(payload: unknown): string {
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

const SITUATIONS: Situation[] = ["chat", "work", "official", "general"];

function parseResult(raw: string, req: TranslationRequest): TranslationResult {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new TranslationError("provider", "Malformed model output.");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new TranslationError("provider", "Malformed model output.");
  }
  const translation = typeof data["translation"] === "string" ? data["translation"] : "";
  if (!translation.trim()) throw new TranslationError("provider", "Empty translation.");
  const alts = Array.isArray(data["alternativeTranslations"])
    ? (data["alternativeTranslations"] as unknown[])
        .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
        .slice(0, 2)
    : [];
  return {
    sourceLanguage:
      typeof data["sourceLanguage"] === "string" ? data["sourceLanguage"] : req.source,
    targetLanguage:
      typeof data["targetLanguage"] === "string" ? data["targetLanguage"] : req.target,
    translation,
    tone: typeof data["tone"] === "string" ? data["tone"] : "",
    formality: typeof data["formality"] === "string" ? data["formality"] : "",
    confidence: typeof data["confidence"] === "number" ? data["confidence"] : 0.8,
    isAmbiguous: data["isAmbiguous"] === true,
    alternativeTranslations: alts,
    notes: typeof data["notes"] === "string" ? data["notes"].slice(0, 240) : "",
    situation: SITUATIONS.includes(data["situation"] as Situation) ? (data["situation"] as Situation) : "general",
  };
}

async function call(
  apiKey: string,
  system: string,
  user: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-opencode-session": SESSION,
      },
      signal: signal ?? null,
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        // Speed: no hidden thinking, terse output, reuse the cached system prompt.
        reasoning: { effort: "none" },
        text: { verbosity: "low" },
        prompt_cache_key: SESSION,
        store: false,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
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

  return extractText(await res.json());
}

export function createOpenCodeLunaProvider(apiKey: string): TranslationProvider {
  return {
    id: "opencode:gpt-5.6-luna",
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
