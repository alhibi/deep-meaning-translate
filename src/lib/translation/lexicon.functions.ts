import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { takeEnrichmentToken } from "./throttle";
import { getRequest } from "@tanstack/react-start/server";
import { clientAddress, sameOrigin } from "../requestSafety";

const LexiconInput = z.object({
  text: z.string().trim().min(1).max(72),
  source: z.string().regex(/^[a-z]{2}$|^auto$/),
  target: z.string().regex(/^[a-z]{2}$/),
  uiLocale: z.enum(["ar", "en", "de"]),
  translation: z.string().trim().max(200).optional(),
  dialect: z.enum(["auto", "msa", "levant", "egypt", "gulf", "iraq", "maghreb"]).optional(),
});

export const lookupLexicon = createServerFn({ method: "POST" })
  .validator((input: unknown) => LexiconInput.parse(input))
  .handler(
    async ({ data }): Promise<{ ok: true; lexicon: import("./lexicon").LexiconResult | null }> => {
      const { isLexiconCandidate } = await import("./lexicon");
      const request = getRequest();
      if (
        !isLexiconCandidate(data.text) ||
        !sameOrigin(request) ||
        !takeEnrichmentToken(clientAddress(request))
      )
        return { ok: true, lexicon: null };
      // Luna is paused: the dictionary runs on DeepSeek.
      const ds = await import("./providers/deepseek.server");
      const key = ds.deepseekKey();
      if (!key) return { ok: true, lexicon: null };
      const { analyzeLexiconWith } = await import("./providers/opencode.server");
      const lexicon = await analyzeLexiconWith((s, u) => ds.call(key, s, u), data).catch(
        () => null,
      );
      return { ok: true, lexicon };
    },
  );
