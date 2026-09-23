import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { translate } from "./translate.functions";
import type { StyleOverride, TranslationResult } from "./types";

export type ErrorKind = "auth" | "rate" | "network" | "provider" | "input";

interface State {
  result: TranslationResult | null;
  pending: boolean;
  error: ErrorKind | null;
}

const DEBOUNCE_MS = 600;
const CACHE_LIMIT = 30;

function cacheKey(text: string, source: string, target: string, style: string) {
  return `${source}|${target}|${style}|${text}`;
}

export function useTranslator(opts: {
  text: string;
  source: string;
  target: string;
  style: StyleOverride;
  onSuccess?: (result: TranslationResult, text: string) => void;
}) {
  const { text, source, target, style, onSuccess } = opts;
  const call = useServerFn(translate);
  const [state, setState] = useState<State>({ result: null, pending: false, error: null });
  const latest = useRef(0);
  const cache = useRef(new Map<string, TranslationResult>());
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;

  const trimmed = text.trim();

  const run = useCallback(
    async (value: string) => {
      const key = cacheKey(value, source, target, style);
      const cached = cache.current.get(key);
      const token = ++latest.current;

      if (cached) {
        setState({ result: cached, pending: false, error: null });
        return;
      }

      setState((s) => ({ ...s, pending: true, error: null }));
      try {
        const res = await call({ data: { text: value, source, target, style } });
        if (token !== latest.current) return; // superseded by a newer input
        if (res.ok) {
          cache.current.set(key, res.result);
          if (cache.current.size > CACHE_LIMIT)
            cache.current.delete(cache.current.keys().next().value as string);
          setState({ result: res.result, pending: false, error: null });
          successRef.current?.(res.result, value);
        } else {
          setState((s) => ({ ...s, pending: false, error: res.kind }));
        }
      } catch {
        if (token !== latest.current) return;
        setState((s) => ({ ...s, pending: false, error: "network" }));
      }
    },
    [call, source, target, style],
  );

  useEffect(() => {
    if (!trimmed) {
      latest.current++;
      setState({ result: null, pending: false, error: null });
      return;
    }
    const id = setTimeout(() => void run(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [trimmed, run]);

  const retry = useCallback(() => {
    if (trimmed) void run(trimmed);
  }, [run, trimmed]);

  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
