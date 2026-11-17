import { callLexicon } from "../native/rpc";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { Dialect, StyleOverride } from "./types";
import { isLexiconCandidate, LEXICON_MAX_CONTEXT_CODE_POINTS, type LexiconResult } from "./lexicon";
import { enqueueEnrichment } from "./enrichment";

const CACHE_LIMIT = 40;
/**
 * Bumped when the lexicon payload shape changes. A cached entry from an older data model
 * must never be rendered by a newer hook, even though the text and pair match.
 * v2: the reference model (lemma/variety/collocations/examples/nuances/pronunciation and
 * the model-source marker), the widened candidate gate and the request context.
 */
const LEXICON_CACHE_VERSION = 2;
/** The server caps the ranking context; the hook must stop at a whole character. */
const CONTEXT_LIMIT = 200;
/** A full source sentence for ranking: same bound the server schema uses. */
const SENTENCE_LIMIT = LEXICON_MAX_CONTEXT_CODE_POINTS;

/** Code-point-safe head: a UTF-16 slice can cut an emoji pair or split an Arabic base letter from its haraka. */
function head(text: string, limit: number): string {
  const points = Array.from(text);
  return points.length > limit ? points.slice(0, limit).join("") : text;
}

/** One normalization for the term and the sentence, so a context that only differs in
 * spacing never becomes a second request. */
const normalize = (value: string) => value.trim().replace(/\s+/gu, " ").normalize("NFC");

export function useLexicon(opts: {
  text: string;
  source: string;
  target: string;
  uiLocale: Locale;
  settled: boolean;
  /** The model's translation: ranks the most common matching meaning first. */
  translation?: string | undefined;
  /**
   * The full sentence the term came from, when the caller has one. It ranks the reading in
   * the sentence that was actually written; omitted when it repeats the term.
   */
  context?: string | undefined;
  dialect?: Dialect | undefined;
  /** Register the reading must fit; part of the request identity even when omitted. */
  style?: StyleOverride | undefined;
}) {
  const lookup = callLexicon;
  const [lexicon, setLexicon] = useState<LexiconResult | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  /** Set when the effect tears down (dependency change or unmount): late continuations are inert. */
  const disposed = useRef(false);
  const cache = useRef(new Map<string, LexiconResult | null>());
  const { text, source, target, uiLocale, settled } = opts;
  const translation = head((opts.translation ?? "").trim(), CONTEXT_LIMIT);
  const dialect = target === "ar" ? (opts.dialect ?? "auto") : "auto";
  const style = opts.style ?? "natural";
  const context = head(normalize(opts.context ?? ""), SENTENCE_LIMIT);

  useEffect(() => {
    disposed.current = false;
    const token = ++generation.current;
    const controller = new AbortController();
    const normalized = normalize(text);
    // The composer offers the dictionary for the whole short draft, so the sentence and
    // the term are normally the same string; sending it again would only pad the prompt.
    const sentence = context && context !== normalized ? context : "";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
    setLexicon(null);
    setLoading(false);
    if (!settled || !isLexiconCandidate(normalized)) return () => controller.abort();
    // (text, direction, style, dialect, uiLocale, sentence context, data-model version) —
    // one exact identity, or an answer for "bank" would surface under a different register,
    // a different sentence or an older schema.
    const key = JSON.stringify([
      LEXICON_CACHE_VERSION,
      source,
      target,
      style,
      dialect,
      uiLocale,
      normalized,
      translation,
      sentence,
    ]);
    if (cache.current.has(key)) {
      const cached = cache.current.get(key) ?? null;
      // Re-insert so Map order stays recency order, and the bound evicts the least recently
      // used entry instead of the oldest inserted one.
      cache.current.delete(key);
      cache.current.set(key, cached);
      setLexicon(cached);
      return () => controller.abort();
    }

    const id = setTimeout(() => {
      if (token !== generation.current || disposed.current || controller.signal.aborted) return;
      setLoading(true);
      // Built as a variable: the transport type (native/rpc.ts) names the older fields, and
      // new fields must not be dropped by a spread or rejected by an excess-property check.
      const payload = {
        text: normalized,
        source,
        target,
        uiLocale,
        ...(translation ? { translation } : {}),
        ...(sentence ? { context: sentence } : {}),
        dialect,
        style,
      };
      // The dictionary is quiet work: it shares one paced door with the shadow and the
      // settled review, and a superseded lookup is skipped before it spends a request.
      void enqueueEnrichment(() => lookup({ data: payload }), {
        purpose: "dictionary",
        signal: controller.signal,
        isValid: () => token === generation.current && !disposed.current,
      })
        .then((response) => {
          if (token !== generation.current || disposed.current) return;
          const value = response?.ok ? response.lexicon : null;
          cache.current.set(key, value);
          if (cache.current.size > CACHE_LIMIT) {
            const first = cache.current.keys().next().value;
            if (typeof first === "string") cache.current.delete(first);
          }
          setLexicon(value);
        })
        .catch(() => {
          // A dictionary failure — including a cancelled obsolete lookup — is isolated:
          // it clears the panel and never touches the translation on screen.
          if (token === generation.current && !disposed.current) setLexicon(null);
        })
        .finally(() => {
          if (token === generation.current && !disposed.current) setLoading(false);
        });
    }, 260);

    return () => {
      clearTimeout(id);
      // Queued work is skipped before any network and the in-flight job is released; the
      // teardown flag makes every late continuation inert as well.
      controller.abort();
      disposed.current = true;
    };
  }, [text, source, target, uiLocale, settled, dialect, style, lookup, translation, context]);

  return { lexicon, loading };
}
