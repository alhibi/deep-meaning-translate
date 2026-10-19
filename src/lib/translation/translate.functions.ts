import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { takeToken } from "./throttle";

const MAX_CHARS = 5000;

export const InputSchema = z.object({
  text: z.string().trim().min(1).max(MAX_CHARS),
  source: z.string().regex(/^[a-z]{2}$|^auto$/),
  target: z.string().regex(/^[a-z]{2}$/),
  style: z.enum(["natural", "formal", "casual"]),
  dialect: z
    .enum(["auto", "msa", "levant", "egypt", "gulf", "iraq", "maghreb"])
    .optional()
    .default("auto"),
  brain: z.enum(["deepseek", "luna"]).optional().default("deepseek"),
  partial: z.boolean().optional().default(false),
});

export type TranslateResponse =
  | { ok: true; result: import("./types").TranslationResult; needsRepair?: boolean }
  | { ok: false; kind: "auth" | "quota" | "rate" | "network" | "provider" | "input" };

export const translate = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<TranslateResponse> => {
    if (!takeToken()) return { ok: false, kind: "rate" };
    const { runTranslation } = await import("./engine.server");
    const { TranslationError } = await import("./types");
    const started = Date.now();
    // Privacy: metrics only — never the text, never the translation.
    const log = (outcome: string) =>
      console.info(
        JSON.stringify({
          event: "translate",
          outcome,
          ms: Date.now() - started,
          chars: data.text.length,
          partial: data.partial,
        }),
      );
    try {
      const { result, issues } = await runTranslation(data);
      log(issues.length ? "ok_needs_repair" : "ok");
      return { ok: true, result, needsRepair: issues.length > 0 };
    } catch (err) {
      const kind = err instanceof TranslationError ? err.kind : "provider";
      log(kind);
      return { ok: false, kind };
    }
  });

const ResultSchema = z.object({
  sourceLanguage: z.string().max(10),
  targetLanguage: z.string().max(10),
  translation: z
    .string()
    .min(1)
    .max(MAX_CHARS * 3),
  tone: z.string().max(60),
  formality: z.string().max(30),
  confidence: z.number(),
  isAmbiguous: z.boolean(),
  alternativeTranslations: z.array(z.string().max(MAX_CHARS * 3)).max(2),
  notes: z.string().max(300),
  situation: z.enum(["chat", "work", "official", "general"]).optional(),
});

/** Quiet second pass for a shown translation that failed the deterministic checks. */
export const repairTranslation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ request: InputSchema, previous: ResultSchema }).parse(input),
  )
  .handler(
    async ({ data }): Promise<{ ok: true; result: import("./types").TranslationResult | null }> => {
      if (!takeToken()) return { ok: true, result: null };
      const { runRepair } = await import("./engine.server");
      const started = Date.now();
      const result = await runRepair(
        data.request,
        data.previous as import("./types").TranslationResult,
      ).catch(() => null);
      console.info(
        JSON.stringify({
          event: "repair",
          outcome: result ? "improved" : "kept",
          ms: Date.now() - started,
        }),
      );
      return { ok: true, result };
    },
  );
