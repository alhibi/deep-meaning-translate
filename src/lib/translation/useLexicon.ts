import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { isLexiconCandidate, type LexiconResult } from "./lexicon";
import { lookupLexicon } from "./lexicon.functions";

const CACHE_LIMIT = 40;

export function useLexicon(opts: {
  text: string;
  source: string;
  target: string;
  uiLocale: Locale;
  settled: boolean;
}) {
  const lookup = useServerFn(lookupLexicon);
  const [lexicon, setLexicon] = useState<LexiconResult | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const cache = useRef(new Map<string, LexiconResult | null>());
  const { text, source, target, uiLocale, settled } = opts;

  useEffect(() => {
    const token = ++generation.current;
    const normalized = text.trim().replace(/\s+/gu, " ");
    setLexicon(null);
    setLoading(false);
    if (!settled || !isLexiconCandidate(normalized)) return;

    const key = `${source}|${target}|${uiLocale}|${normalized.toLocaleLowerCase()}`;
    if (cache.current.has(key)) {
      setLexicon(cache.current.get(key) ?? null);
      return;
    }

    const id = setTimeout(() => {
      if (token !== generation.current) return;
      setLoading(true);
      void lookup({ data: { text: normalized, source, target, uiLocale } })
        .then((response) => {
          if (token !== generation.current) return;
          const value = response?.ok ? response.lexicon : null;
          cache.current.set(key, value);
          if (cache.current.size > CACHE_LIMIT) {
            const first = cache.current.keys().next().value;
            if (typeof first === "string") cache.current.delete(first);
          }
          setLexicon(value);
        })
        .catch(() => {
          if (token === generation.current) setLexicon(null);
        })
        .finally(() => {
          if (token === generation.current) setLoading(false);
        });
    }, 260);

    return () => clearTimeout(id);
  }, [text, source, target, uiLocale, settled, lookup]);

  return { lexicon, loading };
}
