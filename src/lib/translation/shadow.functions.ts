import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { takeToken } from "./throttle";

const ShadowInput = z.object({
  text: z.string().trim().min(1).max(600),
  translation: z.string().trim().min(1).max(1500),
  source: z.string().regex(/^[a-z]{2}$|^auto$/),
  target: z.string().regex(/^[a-z]{2}$/),
  style: z.enum(["natural", "formal", "casual"]),
  uiLocale: z.enum(["ar", "en", "de"]),
  dialect: z.enum(["auto", "msa", "levant", "egypt", "gulf", "iraq", "maghreb"]).optional(),
});

/** Sentence Shadow analysis. Any failure is a quiet `null`; user text is never logged. */
export const analyzeShadow = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ShadowInput.parse(input))
  .handler(async ({ data }): Promise<{ shadow: import("./shadow").ShadowResult | null }> => {
    const sh = await import("./shadow");
    if (!sh.isShadowCandidate(data.text) || !takeToken()) return { shadow: null };
    const ds = await import("./providers/deepseek.server");
    const key = ds.deepseekKey();
    if (!key) return { shadow: null };
    try {
      const raw = await ds.call(key, sh.SHADOW_SYSTEM, sh.shadowUserPrompt(data), AbortSignal.timeout(15000));
      return { shadow: sh.readShadowReply(raw, data.text, data.translation) };
    } catch {
      return { shadow: null };
    }
  });
