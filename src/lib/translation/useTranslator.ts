import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { translate } from "./translate.functions";
import type { StyleOverride, TranslationResult } from "./types";

export type ErrorKind =
  | "auth"
  | "quota"
  | "rate"
  | "network"
  | "offline"
  | "provider"
  | "input";

interface State {
  result: TranslationResult | null;
  /** True while a request is in flight. */
  busy: boolean;
  error: ErrorKind | null;
}

const DEBOUNCE_MS = 550;
/** Fast responses never show a loading state; slower ones ease into it. */
const PENDING_DELAY_MS = 220;
const CACHE_LIMIT = 40;

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
  const [state, setState] = useState<State>({ result: null, busy: false, error: null });
  const [showPending, setShowPending] = useState(false);
  const latest = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, TranslationResult>());
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;

  const trimmed = text.trim();

  const run = useCallback(
    async (value: string) => {
      const key = cacheKey(value, source, target, style);
      const token = ++latest.current;
      inflight.current?.abort();
      inflight.current = null;

      const cached = cache.current.get(key);
      if (cached) {
        cache.current.delete(key);
        cache.current.set(key, cached); // LRU touch
        setState({ result: cached, busy: false, error: null });
        return;
      }

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setState((s) => ({ ...s, busy: false, error: "offline" }));
        return;
      }

      const ctrl = new AbortController();
      inflight.current = ctrl;
      setState((s) => (s.busy && !s.error ? s : { ...s, busy: true, error: null }));
      try {
        const res = await call({ data: { text: value, source, target, style }, signal: ctrl.signal });
        if (token !== latest.current) return; // superseded by newer input
        if (res.ok) {
          cache.current.set(key, res.result);
          if (cache.current.size > CACHE_LIMIT)
            cache.current.delete(cache.current.keys().next().value as string);
          setState({ result: res.result, busy: false, error: null });
          successRef.current?.(res.result, value);
        } else {
          setState((s) => ({ ...s, busy: false, error: res.kind }));
        }
      } catch {
        if (token !== latest.current || ctrl.signal.aborted) return;
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        setState((s) => ({ ...s, busy: false, error: offline ? "offline" : "network" }));
      } finally {
        if (inflight.current === ctrl) inflight.current = null;
      }
    },
    [call, source, target, style],
  );

  useEffect(() => {
    if (!trimmed) {
      latest.current++;
      inflight.current?.abort();
      setState({ result: null, busy: false, error: null });
      return;
    }
    const id = setTimeout(() => void run(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [trimmed, run]);

  // Delayed pending indicator: avoids flicker on fast responses.
  useEffect(() => {
    if (!state.busy) {
      setShowPending(false);
      return;
    }
    const id = setTimeout(() => setShowPending(true), PENDING_DELAY_MS);
    return () => clearTimeout(id);
  }, [state.busy]);

  const retry = useCallback(() => {
    if (trimmed) void run(trimmed);
  }, [run, trimmed]);

  // Resume automatically once the connection is back.
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const errorRef = useRef(state.error);
  errorRef.current = state.error;
  useEffect(() => {
    const onOnline = () => {
      if (errorRef.current === "offline" || errorRef.current === "network") retryRef.current();
    };
    const onOffline = () => {
      if (inflight.current) setState((s) => ({ ...s, busy: false, error: "offline" }));
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => () => inflight.current?.abort(), []);

  return useMemo(
    () => ({ result: state.result, pending: showPending, error: state.error, retry }),
    [state.result, state.error, showPending, retry],
  );
}
