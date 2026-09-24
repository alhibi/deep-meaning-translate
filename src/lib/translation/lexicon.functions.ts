import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { takeToken } from "./throttle";

const LexiconInput = z.object({
  text: z.string().trim().min(1).max(72),
  source: z.string().regex(/^[a-z]{2}$|^auto$/),
  target: z.string().regex(/^[a-z]{2}$/),
  uiLocale: z.enum(["ar", "en", "de"]),
});

export const lookupLexicon = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => LexiconInput.parse(input))
  .handler(
    async ({ data }): Promise<{ ok: true; lexicon: import("./lexicon").LexiconResult | null }> => {
      const { isLexiconCandidate } = await import("./lexicon");
      if (!isLexiconCandidate(data.text) || !takeToken()) return { ok: true, lexicon: null };
      const apiKey = process.env["OPENCODE_API_KEY"];
      if (!apiKey) return { ok: true, lexicon: null };
      const { analyzeLexicon } = await import("./providers/opencode.server");
      const lexicon = await analyzeLexicon(apiKey, data).catch(() => null);
      return { ok: true, lexicon };
    },
  );
