import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MAX_CHARS = 5000;

const InputSchema = z.object({
  text: z.string().trim().min(1).max(MAX_CHARS),
  source: z.string().regex(/^[a-z]{2}$|^auto$/),
  target: z.string().regex(/^[a-z]{2}$/),
  style: z.enum(["natural", "formal", "casual"]),
});

/** Coarse in-process throttle; keeps a runaway client from hammering the provider. */
const bucket = { tokens: 30, updated: Date.now() };
function takeToken(): boolean {
  const now = Date.now();
  bucket.tokens = Math.min(30, bucket.tokens + ((now - bucket.updated) / 1000) * 0.8);
  bucket.updated = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export type TranslateResponse =
  | { ok: true; result: import("./types").TranslationResult }
  | { ok: false; kind: "auth" | "rate" | "network" | "provider" | "input" };

export const translate = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<TranslateResponse> => {
    if (!takeToken()) return { ok: false, kind: "rate" };
    const { runTranslation } = await import("./engine.server");
    const { TranslationError } = await import("./types");
    try {
      const result = await runTranslation(data);
      return { ok: true, result };
    } catch (err) {
      if (err instanceof TranslationError) return { ok: false, kind: err.kind };
      console.error("translation failed", err);
      return { ok: false, kind: "provider" };
    }
  });
