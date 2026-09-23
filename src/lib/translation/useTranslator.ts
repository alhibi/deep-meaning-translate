import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { translate } from "./translate.functions";
import type { Dialect, StyleOverride, TranslationResult } from "./types";
import { delayFor, isProvisional, normalize, worthTranslating } from "./scheduler";
import { metrics } from "./metrics";
import { streamTranslate } from "./stream";

export type ErrorKind =
  "auth" | "quota" | "rate" | "network" | "offline" | "timeout" | "provider" | "input";

/** One state at a time — the UI derives everything from this. */
export type Phase =
  | "EMPTY"
  | "TYPING"
  | "READY"
  | "SCHEDULED"
  | "TRANSLATING"
  | "UPDATING"
  | "COMPLETE"
  | "CANCELLED"
  | "OFFLINE"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "VALIDATION_ERROR"
  | "RETRYING";

const PHASE_ERROR: Partial<Record<Phase, ErrorKind>> = {
  OFFLINE: "offline",
  TIMEOUT: "timeout",
  RATE_LIMITED: "rate",
  VALIDATION_ERROR: "input",
};

function phaseFor(kind: ErrorKind): Phase {
  if (kind === "offline") return "OFFLINE";
  if (kind === "timeout") return "TIMEOUT";
  if (kind === "rate") return "RATE_LIMITED";
  if (kind === "input") return "VALIDATION_ERROR";
  return "PROVIDER_ERROR";
}

/** Fast responses never show a loading state; slower ones ease into it. */
const PENDING_DELAY_MS = 260;
/** Generous safety net for a hung connection — not a cap on normal model thinking. */
const REQUEST_TIMEOUT_MS = 60_000;
const CACHE_LIMIT = 60;
const CACHE_TTL_MS = 30 * 60_000;

interface Cached {
  result: TranslationResult;
  at: number;
  provisional: boolean;
}

const keyOf = (text: string, source: string, target: string, style: string) =>
  `${source}|${target}|${style}|${text}`;

/** A streamed live translation keeps the last known metadata; only the text is fresh. */
function liveResult(
  prev: TranslationResult | null,
  translation: string,
  source: string,
  target: string,
): TranslationResult {
  return {
    sourceLanguage: source === "auto" ? (prev?.sourceLanguage ?? "auto") : source,
    targetLanguage: target,
    translation,
    tone: prev?.tone ?? "",
    formality: prev?.formality ?? "",
    confidence: prev?.confidence ?? 0.8,
    isAmbiguous: false,
    alternativeTranslations: [],
    notes: "",
    ...(prev?.situation ? { situation: prev.situation } : {}),
  };
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

export function useTranslator(opts: {
  text: string;
  source: string;
  target: string;
  style: StyleOverride;
  dialect?: Dialect;
  onSuccess?: (result: TranslationResult, text: string, provisional: boolean) => void;
}) {
  const { text, source, target, onSuccess } = opts;
  const style = opts.style;
  const dialect: Dialect = target === "ar" ? (opts.dialect ?? "auto") : "auto";
  const styleKey = dialect === "auto" ? style : `${style}~${dialect}`;
  const call = useServerFn(translate);

  const [phase, setPhase] = useState<Phase>("EMPTY");
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [provisional, setProvisional] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [showPending, setShowPending] = useState(false);

  const latest = useRef(0);
  const inflight = useRef<{ ctrl: AbortController; key: string } | null>(null);
  const committedKey = useRef<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cache = useRef(new Map<string, Cached>());
  const deliberate = useRef(false);
  const lastRaw = useRef("");
  const lastKeyAt = useRef(0);
  const intervals = useRef<number[]>([]);
  const lastParams = useRef("");
  const current = useRef({ norm: "", key: "", provisional: false });
  const hasResult = useRef(false);
  hasResult.current = !!result;
  const resultRef = useRef<TranslationResult | null>(null);
  resultRef.current = result;
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;

  const clearRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };

  const commit = useCallback(
    (key: string, value: TranslationResult, prov: boolean, norm: string) => {
      committedKey.current = key;
      setResult(value);
      setProvisional(prov);
      setError(null);
      setPhase("COMPLETE");
      successRef.current?.(value, norm, prov);
    },
    [],
  );

  const run = useCallback(
    async (norm: string, key: string, prov: boolean, attempt = 0) => {
      clearRetry();

      const hit = cache.current.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        cache.current.delete(key);
        cache.current.set(key, hit); // LRU touch
        latest.current++;
        if (inflight.current) {
          inflight.current.ctrl.abort();
          inflight.current = null;
          metrics.cancel();
        }
        metrics.cacheHit();
        commit(key, hit.result, hit.provisional, norm);
        return;
      }
      if (hit) cache.current.delete(key); // expired

      if (isOffline()) {
        setError("offline");
        setPhase("OFFLINE");
        return;
      }

      if (inflight.current) {
        inflight.current.ctrl.abort();
        metrics.cancel();
      }
      const token = ++latest.current;
      const ctrl = new AbortController();
      inflight.current = { ctrl, key };
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, REQUEST_TIMEOUT_MS);

      setPhase(attempt > 0 ? "RETRYING" : hasResult.current ? "UPDATING" : "TRANSLATING");
      metrics.request();
      const started = performance.now();

      const fail = (kind: ErrorKind) => {
        metrics.error(kind);
        const transient = kind === "rate" || kind === "network" || kind === "provider";
        if (transient && attempt === 0) {
          metrics.retry();
          setPhase("RETRYING");
          retryTimer.current = setTimeout(
            () => {
              if (token === latest.current) void run(norm, key, prov, 1);
            },
            kind === "rate" ? 2500 : 1200,
          );
          return;
        }
        // Keep the previous good result on screen; only the error state changes.
        setError(kind);
        setPhase(phaseFor(kind));
      };

      try {
        const data = { text: norm, source, target, style, dialect, partial: prov };
        // Live typing streams plain text so words appear as they are generated;
        // a finished sentence gets the full structured, verified translation.
        const res = prov
          ? await streamTranslate(data, ctrl.signal, (partialText) => {
              if (token !== latest.current) return;
              setResult((r) => liveResult(r, partialText, source, target));
              setProvisional(true);
            }).then((r) =>
              r.ok ? { ok: true as const, result: liveResult(resultRef.current, r.text, source, target) } : r,
            )
          : await call({ data, signal: ctrl.signal });
        if (token !== latest.current) return; // superseded — never commit
        metrics.latency(performance.now() - started);
        if (res.ok) {
          cache.current.set(key, { result: res.result, at: Date.now(), provisional: prov });
          if (cache.current.size > CACHE_LIMIT)
            cache.current.delete(cache.current.keys().next().value as string);
          commit(key, res.result, prov, norm);
        } else {
          fail(res.kind);
        }
      } catch {
        if (token !== latest.current) return;
        if (timedOut) {
          metrics.timeout();
          setError("timeout");
          setPhase("TIMEOUT");
        } else if (ctrl.signal.aborted) {
          setPhase("CANCELLED");
        } else if (isOffline()) {
          setError("offline");
          setPhase("OFFLINE");
        } else {
          fail("network");
        }
      } finally {
        clearTimeout(timer);
        if (inflight.current?.ctrl === ctrl) inflight.current = null;
      }
    },
    [call, commit, source, target, style, dialect],
  );

  // The scheduler: react to every change, but only spend a request when it is worthwhile.
  useEffect(() => {
    const now = Date.now();
    if (text !== lastRaw.current) {
      const gap = now - lastKeyAt.current;
      if (gap < 2000) intervals.current = [...intervals.current.slice(-5), gap];
      lastKeyAt.current = now;
      lastRaw.current = text;
    }

    const norm = normalize(text);
    if (!norm) {
      latest.current++;
      clearRetry();
      inflight.current?.ctrl.abort();
      inflight.current = null;
      committedKey.current = null;
      deliberate.current = false;
      setResult(null);
      setError(null);
      setProvisional(false);
      setPhase("EMPTY");
      return;
    }
    if (!worthTranslating(norm)) {
      setPhase("TYPING");
      return;
    }

    const params = `${source}|${target}|${styleKey}`;
    const paramsChanged = params !== lastParams.current;
    lastParams.current = params;

    const isDeliberate = deliberate.current;
    deliberate.current = false;
    const prov = isProvisional(norm, text, isDeliberate);
    const key = keyOf(norm, source, target, styleKey);
    current.current = { norm, key, provisional: prov };

    if (key === committedKey.current || key === inflight.current?.key) {
      metrics.deduped();
      return; // already on screen, or already on its way
    }

    const delay =
      isDeliberate || paramsChanged
        ? 0
        : delayFor({
            normalized: norm,
            raw: text,
            intervals: intervals.current,
            hasResult: hasResult.current,
          });
    setPhase(delay === 0 ? "READY" : "SCHEDULED");
    const id = setTimeout(() => void run(norm, key, prov), delay);
    return () => clearTimeout(id);
  }, [text, source, target, styleKey, run]);

  // A live result for text without final punctuation settles once the writer pauses,
  // so Copy/Listen/Save appear instead of waiting for a period that may never come.
  useEffect(() => {
    if (!provisional || phase !== "COMPLETE" || !result) return;
    const id = setTimeout(() => {
      if (committedKey.current !== current.current.key) return;
      const c = cache.current.get(committedKey.current);
      if (c) c.provisional = false;
      setProvisional(false);
      successRef.current?.(result, current.current.norm, false);
    }, 1200);
    return () => clearTimeout(id);
  }, [provisional, phase, result, text]);

  const busy = phase === "TRANSLATING" || phase === "UPDATING" || phase === "RETRYING";
  useEffect(() => {
    if (!busy) {
      setShowPending(false);
      return;
    }
    const id = setTimeout(() => setShowPending(true), PENDING_DELAY_MS);
    return () => clearTimeout(id);
  }, [busy]);

  const retry = useCallback(() => {
    const { norm, key, provisional: prov } = current.current;
    if (!norm) return;
    committedKey.current = null;
    void run(norm, key, prov);
  }, [run]);

  /** Mark the next text change as a deliberate submission (paste, share, restore). */
  const submitNext = useCallback(() => {
    deliberate.current = true;
  }, []);

  /** Seed a known result (e.g. restored session) so it shows without a new request. */
  const prime = useCallback(
    (raw: string, s: string, t: string, st: StyleOverride, value: TranslationResult) => {
      cache.current.set(keyOf(normalize(raw), s, t, st), {
        result: value,
        at: Date.now(),
        provisional: false,
      });
    },
    [],
  );

  // Resume automatically once the connection is back.
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    const onOnline = () => {
      const p = phaseRef.current;
      if (p === "OFFLINE" || p === "PROVIDER_ERROR" || p === "TIMEOUT") retryRef.current();
    };
    const onOffline = () => {
      if (inflight.current) {
        latest.current++;
        inflight.current.ctrl.abort();
        inflight.current = null;
      }
      clearRetry();
      if (phaseRef.current !== "EMPTY") {
        setError("offline");
        setPhase("OFFLINE");
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(
    () => () => {
      inflight.current?.ctrl.abort();
      clearRetry();
    },
    [],
  );

  return useMemo(
    () => ({
      phase,
      result,
      provisional,
      pending: showPending,
      error: error ?? PHASE_ERROR[phase] ?? null,
      retry,
      submitNext,
      prime,
    }),
    [phase, result, provisional, showPending, error, retry, submitNext, prime],
  );
}
