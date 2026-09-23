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
  partial: z.boolean().optional().default(false),
});

export type TranslateResponse =
  | { ok: true; result: import("./types").TranslationResult }
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
      const result = await runTranslation(data);
      log("ok");
      return { ok: true, result };
    } catch (err) {
      const kind = err instanceof TranslationError ? err.kind : "provider";
      log(kind);
      return { ok: false, kind };
    }
  });
