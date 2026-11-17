import {
  buildLiveSystemPrompt,
  buildLiveUserPrompt,
  buildRepairPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from "../../src/lib/translation/prompt";
import { capabilityRequest } from "../../src/lib/translation/providers/capabilities";
import { parseResult } from "../../src/lib/translation/parse";
import { verifyTranslation } from "../../src/lib/translation/verify";
import type { TranslationRequest, TranslationResult } from "../../src/lib/translation/types";
import { DEEPSEEK_BASE, EVAL_MODEL, chatOnce } from "./providers";
import { CURRENT_CORPUS } from "./corpus";

/**
 * Live capability and budget probes. These are not product-quality evidence: they check the
 * documented request/response contract against the deployed model and the app's ceilings.
 */

const cors = { "Content-Type": "application/json" };

export interface CapabilityProbe {
  models: { status: number | null; ids: string[]; error: string | null };
  maxTokensAccepted: { model: string | null; status: number | null; finish: string | null };
  maxTokensRejected: { status: number | null; error: string | null };
  thinkingDefault: { reasoningTokens: number | null; contentTokens: number | null };
  thinkingDisabled: { reasoningTokens: number | null; finish: string | null };
  jsonMode: { validJson: boolean; finish: string | null };
  stream: { doneMarker: boolean; usageOnLastChunk: boolean; finish: string | null };
  clientAbort: { firstByteMs: number | null; abortObserved: boolean };
}

const msg = (content: string) => [{ role: "user", content }];

export async function probeCapabilities(key: string): Promise<CapabilityProbe> {
  const out: CapabilityProbe = {
    models: { status: null, ids: [], error: null },
    maxTokensAccepted: { model: null, status: null, finish: null },
    maxTokensRejected: { status: null, error: null },
    thinkingDefault: { reasoningTokens: null, contentTokens: null },
    thinkingDisabled: { reasoningTokens: null, finish: null },
    jsonMode: { validJson: false, finish: null },
    stream: { doneMarker: false, usageOnLastChunk: false, finish: null },
    clientAbort: { firstByteMs: null, abortObserved: false },
  };
  try {
    const response = await fetch(`${DEEPSEEK_BASE}/models`, {
      headers: { Authorization: `Bearer ${key}`, ...cors },
    });
    out.models.status = response.status;
    const payload = (await response.json()) as { data?: { id?: unknown }[] };
    out.models.ids = (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string");
  } catch (error) {
    out.models.error = (error as Error).message;
  }
  const accepted = await chatOnce(key, {
    model: EVAL_MODEL,
    messages: msg("Reply with exactly: OK"),
    max_tokens: 393_216,
    thinking: { type: "disabled" },
  });
  out.maxTokensAccepted = {
    model: accepted.model,
    status: accepted.status,
    finish: accepted.finishReason,
  };
  const rejected = await chatOnce(key, {
    model: EVAL_MODEL,
    messages: msg("Reply with exactly: OK"),
    max_tokens: 393_217,
    thinking: { type: "disabled" },
  });
  out.maxTokensRejected = { status: rejected.status, error: rejected.error };
  const defaultThinking = await chatOnce(key, {
    model: EVAL_MODEL,
    messages: msg("How many letters r are in strawberry? Answer with the number only."),
    max_tokens: 8,
  });
  out.thinkingDefault = {
    reasoningTokens: defaultThinking.usage.reasoning_tokens,
    contentTokens: defaultThinking.usage.completion_tokens,
  };
  const disabledThinking = await chatOnce(key, {
    model: EVAL_MODEL,
    messages: msg("How many letters r are in strawberry? Answer with the number only."),
    max_tokens: 8,
    thinking: { type: "disabled" },
  });
  out.thinkingDisabled = {
    reasoningTokens: disabledThinking.usage.reasoning_tokens,
    finish: disabledThinking.finishReason,
  };
  const json = await chatOnce(key, {
    model: EVAL_MODEL,
    messages: [
      { role: "system", content: "Reply only with JSON containing a boolean field ok." },
      { role: "user", content: "Return {'ok':true}" },
    ],
    max_tokens: 64,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
  });
  if (json.raw !== null) {
    try {
      JSON.parse(json.raw);
      out.jsonMode.validJson = true;
    } catch {
      out.jsonMode.validJson = false;
    }
  }
  out.jsonMode.finish = json.finishReason;
  // Streaming protocol: SSE, [DONE], usage riding the final chunk.
  try {
    const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, ...cors },
      body: JSON.stringify({
        model: EVAL_MODEL,
        messages: msg("Reply with exactly: OK"),
        max_tokens: 32,
        stream: true,
        stream_options: { include_usage: true },
        thinking: { type: "disabled" },
      }),
    });
    const text = await response.text();
    const events = text
      .split("\n\n")
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => block.replace(/^data: /, ""));
    out.stream.doneMarker = events.includes("[DONE]");
    const parsed = events
      .filter((event) => event !== "[DONE]")
      .map((event) => {
        try {
          return JSON.parse(event) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((chunk): chunk is Record<string, unknown> => chunk !== null);
    const last = parsed[parsed.length - 1] ?? {};
    out.stream.usageOnLastChunk = Boolean(last["usage"]);
    const choices = Array.isArray(last["choices"]) ? last["choices"] : [];
    const choice = (choices[0] ?? {}) as Record<string, unknown>;
    out.stream.finish =
      typeof choice["finish_reason"] === "string" ? choice["finish_reason"] : null;
  } catch (error) {
    out.stream.doneMarker = false;
  }
  // Cancellation: abort a live stream after the first bytes; the client must stop promptly.
  try {
    const controller = new AbortController();
    const started = performance.now();
    const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, ...cors },
      body: JSON.stringify({
        model: EVAL_MODEL,
        messages: msg("Write a long paragraph about Berlin."),
        max_tokens: 512,
        stream: true,
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    let bytes = 0;
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      if (out.clientAbort.firstByteMs === null)
        out.clientAbort.firstByteMs = Math.round(performance.now() - started);
      bytes += value.length;
      if (bytes > 200) {
        controller.abort();
        break;
      }
    }
    out.clientAbort.abortObserved = controller.signal.aborted;
  } catch {
    out.clientAbort.abortObserved = true;
  }
  return out;
}

const LONG_DE =
  "Die Stadtverwaltung hat am 14. Oktober 2025 den neuen Nahverkehrsplan vorgestellt. Danach sollen bis Ende 2027 insgesamt 48 Buslinien auf elektrische Fahrzeuge umgestellt und die Takte auf den Hauptachsen auf zehn Minuten verkürzt werden. Der Plan sieht außerdem neue Radwege entlang der Hauptstraße vor, die mit dem bestehenden Netz verbunden werden.\n\n" +
  "Wie die Verkehrsdezernentin Frau Schneider erklärte, rechnet die Stadt mit Kosten von rund 3 Millionen Euro für die ersten beiden Bauabschnitte. Ein Förderantrag beim Land sei bereits eingereicht worden. Die Verwaltung will die Bürgerinnen und Bürger in zwei Informationsveranstaltungen im Januar beteiligen und Anregungen bis zum 15. Februar 2027 entgegennehmen.";

/** ~4,900 characters — inside the app's 5,000-character schema cap. */
export function longSource(): string {
  let text = "";
  while (text.length < 4_900) text += LONG_DE + "\n\n";
  return text.slice(0, 4_900);
}

/** The same size in Arabic, built from varied ar→de corpus sentences (budget probe only). */
export function longSourceArabic(): string {
  const parts = CURRENT_CORPUS.cases
    .filter((item) => item.direction === "ar→de")
    .map((item) => item.source);
  let text = "";
  let index = 0;
  while (text.length < 4_900) {
    text += (parts[index % parts.length] ?? "") + "\n\n";
    index += 1;
  }
  return text.slice(0, 4_900);
}

export interface LongInputProbe {
  chars: number;
  maxTokens: number;
  finish: string | null;
  latencyMs: number;
  completionTokens: number | null;
  outputChars: number | null;
  translation: string | null;
  parseOk: boolean;
  verifyIssues: string[];
  error: string | null;
}

const longReq = (text: string, direction: "ar→de" | "de→ar"): TranslationRequest =>
  direction === "de→ar"
    ? { text, source: "de", target: "ar", style: "formal", dialect: "msa" }
    : { text, source: "ar", target: "de", style: "formal" };

/** Full structured answer for the largest supported input: no silent truncation allowed. */
export async function probeLongInput(
  key: string,
  direction: "ar→de" | "de→ar" = "de→ar",
): Promise<LongInputProbe> {
  const text = direction === "de→ar" ? longSource() : longSourceArabic();
  const req = longReq(text, direction);
  const capability = capabilityRequest("full", text.length);
  const call = await chatOnce(key, {
    model: EVAL_MODEL,
    stream: false,
    ...capability,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(req) },
    ],
  });
  let result: TranslationResult | null = null;
  let parseError: string | null = null;
  if (call.raw !== null) {
    try {
      result = parseResult(call.raw, req);
    } catch (error) {
      parseError = (error as Error).message;
    }
  }
  return {
    chars: text.length,
    maxTokens: capability.max_tokens,
    finish: call.finishReason,
    latencyMs: call.latencyMs,
    completionTokens: call.usage.completion_tokens,
    outputChars: result ? result.translation.length : null,
    translation: result ? result.translation : null,
    parseOk: result !== null,
    verifyIssues: result ? verifyTranslation(req, result) : [],
    error: call.error ?? call.completionError ?? parseError,
  };
}

export interface RepairProbe {
  induced: boolean;
  issuesBefore: string[];
  maxTokens: number;
  finish: string | null;
  latencyMs: number;
  reasoningTokens: number | null;
  parseOk: boolean;
  issuesAfter: string[];
  error: string | null;
}

/**
 * Repair profile on the largest supported input: reasoning must fit the 32K ceiling.
 * A deterministic loss is induced by removing the first number of a real translation,
 * which is exactly what the verifier reports and what triggers the repair path.
 */
export async function probeRepair(
  key: string,
  previousTranslation: string,
  direction: "ar→de" | "de→ar" = "de→ar",
): Promise<RepairProbe> {
  const text = direction === "de→ar" ? longSource() : longSourceArabic();
  const req = longReq(text, direction);
  const broken: TranslationResult = {
    sourceLanguage: direction === "de→ar" ? "de" : "ar",
    targetLanguage: direction === "de→ar" ? "ar" : "de",
    translation: previousTranslation.replace(/\d+/, ""),
    tone: "",
    formality: "",
    confidence: 0.8,
    isAmbiguous: false,
    alternativeTranslations: [],
    notes: "",
  };
  const issues = verifyTranslation(req, broken);
  if (issues.length === 0)
    return {
      induced: false,
      issuesBefore: [],
      maxTokens: 0,
      finish: null,
      latencyMs: 0,
      reasoningTokens: null,
      parseOk: false,
      issuesAfter: [],
      error: "no deterministic issue could be induced",
    };
  const capability = capabilityRequest("repair", text.length);
  const call = await chatOnce(key, {
    model: EVAL_MODEL,
    stream: false,
    ...capability,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildRepairPrompt(req, broken, issues) },
    ],
  });
  let repaired: TranslationResult | null = null;
  let parseError: string | null = null;
  if (call.raw !== null) {
    try {
      repaired = parseResult(call.raw, req);
    } catch (error) {
      parseError = (error as Error).message;
    }
  }
  return {
    induced: true,
    issuesBefore: issues,
    maxTokens: capability.max_tokens,
    finish: call.finishReason,
    latencyMs: call.latencyMs,
    reasoningTokens: call.usage.reasoning_tokens,
    parseOk: repaired !== null,
    issuesAfter: repaired ? verifyTranslation(req, repaired) : [],
    error: call.error ?? call.completionError ?? parseError,
  };
}

export interface AnalysisProbe {
  maxTokens: number;
  finish: string | null;
  latencyMs: number;
  reasoningTokens: number | null;
  completionTokens: number | null;
  validJson: boolean;
  error: string | null;
}

const ANALYSIS_SYSTEM =
  "You are a lexical analysis engine. Analyse the given word in context and reply with minified JSON: " +
  '{"term":str,"lemma":str,"pos":str,"readings":[{"translation":str,"explanation":str}]}';

/** Analysis profile on a representative text-in/JSON-out task (shape check, not lexicon quality). */
export async function probeAnalysis(key: string): Promise<AnalysisProbe> {
  const capability = capabilityRequest("analysis", 120);
  const call = await chatOnce(key, {
    model: EVAL_MODEL,
    stream: false,
    ...capability,
    messages: [
      { role: "system", content: ANALYSIS_SYSTEM },
      { role: "user", content: "Word: Auftrag. Sentence: Bitte bestätigen Sie den Auftrag." },
    ],
  });
  let validJson = false;
  if (call.raw !== null) {
    try {
      const parsed = JSON.parse(call.raw) as Record<string, unknown>;
      validJson = typeof parsed["term"] === "string" && Array.isArray(parsed["readings"]);
    } catch {
      validJson = false;
    }
  }
  return {
    maxTokens: capability.max_tokens,
    finish: call.finishReason,
    latencyMs: call.latencyMs,
    reasoningTokens: call.usage.reasoning_tokens,
    completionTokens: call.usage.completion_tokens,
    validJson,
    error: call.error ?? call.completionError,
  };
}
