/**
 * The versioned server surface for the installed Android app.
 *
 * Each handler reuses the web route's schema, admission budget and domain function —
 * the prompts and translation engine exist once. What differs is the transport: the app
 * runs from a local origin, so authorization is an exact origin allowlist
 * (`gate.server.ts`) instead of the browser's same-origin check.
 */
import { z } from "zod";
import { InputSchema } from "../translation/translate.functions";
import { LexiconInput } from "../translation/lexicon.functions";
import { ShadowInput } from "../translation/shadow.functions";
import { isResult } from "../translation/result";
import type { TranslationResult } from "../translation/types";
import { takeDictationToken, takeEnrichmentToken, takeRepairToken } from "../translation/throttle";
import { boundedJson, clientAddress, parseAdmittedJson } from "../requestSafety";

const badRequest = (kind = "input") =>
  Response.json({ ok: false, kind }, { status: 400, headers: { "Cache-Control": "no-store" } });

const quietNull = () =>
  Response.json({ ok: true, result: null }, { headers: { "Cache-Control": "no-store" } });

/** The quiet second pass takes the same schema as the web server function. */
const RepairInput = z.object({
  request: InputSchema,
  previous: z.custom<TranslationResult>((value) => isResult(value), {
    message: "Invalid translation result.",
  }),
});

export async function nativeRepair(request: Request): Promise<Response> {
  // Bounded before the schema and before the repair budget: an oversized body must be a
  // 400 that spends nothing, not a fully buffered JSON.parse (A5-01).
  const admitted = await parseAdmittedJson(request, RepairInput, () =>
    takeRepairToken(clientAddress(request)),
  );
  if (!admitted.ok) return admitted.kind === "rate" ? quietNull() : badRequest();
  const data = admitted.data;
  const { runRepair } = await import("../translation/engine.server");
  const started = Date.now();
  const result = await runRepair(data.request, data.previous).catch(() => null);
  // Metrics only, never the text.
  console.info(
    JSON.stringify({
      event: "repair",
      surface: "native",
      outcome: result ? "improved" : "kept",
      ms: Date.now() - started,
    }),
  );
  return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
}

export async function nativeLexicon(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch {
    return badRequest();
  }
  const parsed = LexiconInput.safeParse(body);
  if (!parsed.success) return badRequest();
  const data = parsed.data;
  const { isLexiconCandidate } = await import("../translation/lexicon");
  if (!isLexiconCandidate(data.text) || !takeEnrichmentToken(clientAddress(request)))
    return Response.json({ ok: true, lexicon: null }, { headers: { "Cache-Control": "no-store" } });
  const ds = await import("../translation/providers/deepseek.server");
  const key = ds.deepseekKey();
  if (!key)
    return Response.json({ ok: true, lexicon: null }, { headers: { "Cache-Control": "no-store" } });
  const { analyzeLexiconWith } = await import("../translation/providers/opencode.server");
  const lexicon = await analyzeLexiconWith((s, u) => ds.call(key, s, u), data).catch(() => null);
  return Response.json({ ok: true, lexicon }, { headers: { "Cache-Control": "no-store" } });
}

export async function nativeShadow(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch {
    return badRequest();
  }
  const parsed = ShadowInput.safeParse(body);
  if (!parsed.success) return badRequest();
  const data = parsed.data;
  const sh = await import("../translation/shadow");
  if (!sh.isShadowCandidate(data.text) || !takeEnrichmentToken(clientAddress(request)))
    return Response.json({ shadow: null }, { headers: { "Cache-Control": "no-store" } });
  const ds = await import("../translation/providers/deepseek.server");
  const key = ds.deepseekKey();
  if (!key) return Response.json({ shadow: null }, { headers: { "Cache-Control": "no-store" } });
  try {
    const raw = await ds.call(
      key,
      sh.SHADOW_SYSTEM,
      sh.shadowUserPrompt(data),
      AbortSignal.timeout(15000),
    );
    return Response.json(
      { shadow: sh.readShadowReply(raw, data.text, data.translation) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ shadow: null }, { headers: { "Cache-Control": "no-store" } });
  }
}

/** Issues a short-lived AssemblyAI token. The permanent key never leaves the server. */
export async function nativeDictation(request: Request): Promise<Response> {
  if (!takeDictationToken(clientAddress(request)))
    return Response.json(
      {
        ok: false,
        status: 429,
        message: "Too many dictation sessions. Wait a moment and try again.",
      },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  const key = process.env["ASSEMBLYAI_API_KEY"];
  if (!key)
    return Response.json(
      { ok: false, status: 503, message: "AssemblyAI is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const response = await fetch(
      "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60",
      { headers: { Authorization: key }, signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      console.warn("[native:assembly] provider status", response.status);
      return Response.json(
        { ok: false, status: response.status, message: "AssemblyAI is unavailable right now." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("token" in data) || typeof data.token !== "string")
      return Response.json(
        { ok: false, status: 502, message: "AssemblyAI returned an invalid session." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    return Response.json(
      { ok: true, token: data.token },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, status: 502, message: "Could not connect to AssemblyAI." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
