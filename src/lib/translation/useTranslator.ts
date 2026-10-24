import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { repairTranslation } from "./translate.functions";
import { parseResult } from "./parse";
import { verifyTranslation } from "./verify";
import type { Dialect, StyleOverride, TranslationResult } from "./types";
import { DEFAULT_BRAIN, type Brain } from "./types";
import { delayFor, isProvisional, normalize, worthTranslating } from "./scheduler";
import { metrics } from "./metrics";
import { streamTranslate, warmTranslation } from "./stream";
import { memoryGet, memorySet } from "./memory";

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
/** Longest the screen goes without a fresh request while someone types non-stop. */
const MAX_WAIT_MS = 650;
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
  brain?: Brain;
  onSuccess?: (result: TranslationResult, text: string, provisional: boolean) => void;
}) {
  const { text, source, target, onSuccess } = opts;
  const style = opts.style;
  const dialect: Dialect = target === "ar" ? (opts.dialect ?? "auto") : "auto";
  const brain: Brain = opts.brain ?? DEFAULT_BRAIN;
  const brainRef = useRef(brain);
  // eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered
  brainRef.current = brain;
  const styleKey = `${dialect === "auto" ? style : `${style}~${dialect}`}@${brain}`;
  const callRepair = useServerFn(repairTranslation);

  const [phase, setPhase] = useState<Phase>("EMPTY");
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [provisional, setProvisional] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [showPending, setShowPending] = useState(false);
  /** Words are already flowing in — no loading dim, it should feel live. */
  const [streaming, setStreaming] = useState(false);

  const latest = useRef(0);
  const inflight = useRef<{
    ctrl: AbortController;
    key: string;
    norm: string;
    prov: boolean;
  } | null>(null);
  /**
   * A live stream for an earlier prefix of the current text keeps running instead of
   * being cancelled, so continuous typing still shows words flowing in — never a gap.
   */
  const lingering = useRef<AbortController | null>(null);
  /** Request token of the text currently on screen; older streams never overwrite it. */
  const shown = useRef(0);
  /** Length of the text on screen: a newer stream takes over only once it catches up (no shrinking flicker). */
  const shownLen = useRef(0);
  const dropLingering = () => {
    lingering.current?.abort();
    lingering.current = null;
  };
  const committedKey = useRef<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cache = useRef(new Map<string, Cached>());
  const deliberate = useRef(false);
  const lastRaw = useRef("");
  const lastKeyAt = useRef(0);
  const lastSentAt = useRef(0);
  const intervals = useRef<number[]>([]);
  const lastParams = useRef("");
  const current = useRef({ norm: "", key: "", provisional: false });
  const hasResult = useRef(false);
  // eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered
  hasResult.current = !!result;
  const resultRef = useRef<TranslationResult | null>(null);
  // eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered
  resultRef.current = result;
  const successRef = useRef(onSuccess);
  // eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered
  successRef.current = onSuccess;

  const clearRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };

  const commit = useCallback(
    (key: string, value: TranslationResult, prov: boolean, norm: string) => {
      committedKey.current = key;
      shownLen.current = value.translation.length;
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
        shown.current = ++latest.current;
        dropLingering();
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

      // Device memory: a sentence settled in an earlier session returns with no
      // request at all. Only settled text is ever stored, so a hit is a final answer.
      const stored = memoryGet(key);
      if (stored) {
        cache.current.set(key, { result: stored, at: Date.now(), provisional: false });
        shown.current = ++latest.current;
        dropLingering();
        if (inflight.current) {
          inflight.current.ctrl.abort();
          inflight.current = null;
          metrics.cancel();
        }
        metrics.cacheHit();
        commit(key, stored, false, norm);
        return;
      }

      if (isOffline()) {
        setError("offline");
        setPhase("OFFLINE");
        return;
      }

      const prev = inflight.current;
      if (prev) {
        if (prev.prov && prov && norm.startsWith(prev.norm)) {
          dropLingering();
          lingering.current = prev.ctrl; // still useful: its text is a prefix of what's typed now
        } else {
          prev.ctrl.abort();
          metrics.cancel();
        }
      }
      const token = ++latest.current;
      const ctrl = new AbortController();
      inflight.current = { ctrl, key, norm, prov };
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, REQUEST_TIMEOUT_MS);

      setStreaming(false);
      setPhase(attempt > 0 ? "RETRYING" : hasResult.current ? "UPDATING" : "TRANSLATING");
      metrics.request();
      lastSentAt.current = Date.now();
      const started = performance.now();

      const fail = (kind: ErrorKind) => {
        metrics.error(kind);
        // A throttled *live* request is not the user's problem: they are mid-word, and
        // the settled sentence will be translated on its own pause. Never interrupt typing
        // with a rate message — keep what is on screen and stay quiet.
        if (kind === "rate" && prov) {
          setPhase(hasResult.current ? "COMPLETE" : "READY");
          return;
        }
        const transient = kind === "rate" || kind === "network" || kind === "provider";
        if (transient && attempt === 0) {
          metrics.retry();
          setPhase("RETRYING");
          retryTimer.current = setTimeout(
            () => {
              // eslint-disable-next-line react-hooks/immutability -- ref-held timers/controllers are mutable by design
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
        const data = { text: norm, source, target, style, dialect, brain, partial: prov };
        // Live typing streams plain text so words appear as they are generated;
        // a finished sentence gets the full structured, verified translation.
        const onText = (partialText: string) => {
          if (token < shown.current || ctrl.signal.aborted) return;
          if (token > shown.current && partialText.length < shownLen.current) return;
          shown.current = token;
          shownLen.current = partialText.length;
          setStreaming(true);
          setResult((r) => liveResult(r, partialText, source, target));
          setProvisional(true);
        };
        const res:
          | { ok: true; result: TranslationResult; needsRepair: boolean }
          | { ok: false; kind: ErrorKind } = prov
          ? await streamTranslate(data, ctrl.signal, onText, "live").then((r) =>
              r.ok
                ? {
                    ok: true as const,
                    result: liveResult(resultRef.current, r.text, source, target),
                    needsRepair: false,
                  }
                : r,
            )
          : await streamTranslate(data, ctrl.signal, onText, "full").then((r) => {
              if (!r.ok) return r;
              try {
                const parsed = parseResult(r.text, data);
                return {
                  ok: true as const,
                  result: parsed,
                  needsRepair: verifyTranslation(data, parsed).length > 0,
                };
              } catch {
                return { ok: false as const, kind: "provider" as const };
              }
            });
        if (token !== latest.current) return; // superseded — shown live at most, never committed
        metrics.latency(performance.now() - started);
        if (res.ok) {
          cache.current.set(key, { result: res.result, at: Date.now(), provisional: prov });
          if (cache.current.size > CACHE_LIMIT)
            cache.current.delete(cache.current.keys().next().value as string);
          shown.current = token;
          commit(key, res.result, prov, norm);
          // Only a settled, verified answer is remembered. A provisional stream is
          // plain text that never went through `verify`, so storing it would let an
          // unchecked reading answer for this sentence forever after.
          if (!prov) memorySet(key, res.result);
          if (!prov) {
            // Shown already. Finished sentences get a quiet second look (repair for
            // lost numbers/links, otherwise the second brain's review); the result is
            // swapped in only if it is still on screen.
            void callRepair({ data: { request: data, previous: res.result } })
              .then((r) => {
                if (
                  !r?.result ||
                  committedKey.current !== key ||
                  current.current.key !== key ||
                  token !== latest.current
                )
                  return;
                const c = cache.current.get(key);
                if (c) c.result = r.result;
                // The repaired reading supersedes the stored one, so a later session
                // gets the corrected text rather than the pre-repair draft.
                memorySet(key, r.result);
                setResult(r.result);
                successRef.current?.(r.result, norm, prov);
              })
              .catch(() => {});
          }
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
        if (lingering.current === ctrl) lingering.current = null;
      }
    },
    [callRepair, commit, source, target, style, dialect, brain],
  );

  // Warm the path to the translation service on the first keystroke, once per visit.
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current || !text.trim()) return;
    warmed.current = true;
    warmTranslation();
  }, [text]);

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
    if (!worthTranslating(norm)) {
      shown.current = ++latest.current;
      shownLen.current = 0;
      dropLingering();
      clearRetry();
      inflight.current?.ctrl.abort();
      inflight.current = null;
      committedKey.current = null;
      current.current = { norm: "", key: "", provisional: false };
      deliberate.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
      setResult(null);
      setError(null);
      setProvisional(false);
      setStreaming(false);
      setPhase(norm ? "TYPING" : "EMPTY");
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

    // Continuous typing never pauses long enough for the debounce, so after
    // MAX_WAIT_MS without a request, each finished word goes out immediately.
    const starved = now - lastSentAt.current > MAX_WAIT_MS && /\s$/.test(text);
    const delay =
      isDeliberate || paramsChanged || starved
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
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
      cache.current.set(keyOf(normalize(raw), s, t, `${st}@${brainRef.current}`), {
        result: value,
        at: Date.now(),
        provisional: false,
      });
    },
    [],
  );

  // Resume automatically once the connection is back.
  const retryRef = useRef(retry);
  // eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered
  retryRef.current = retry;
  const phaseRef = useRef(phase);
  // eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered
  phaseRef.current = phase;
  useEffect(() => {
    const onOnline = () => {
      const p = phaseRef.current;
      if (p === "OFFLINE" || p === "PROVIDER_ERROR" || p === "TIMEOUT") retryRef.current();
    };
    const onOffline = () => {
      dropLingering();
      if (inflight.current) {
        shown.current = ++latest.current;
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
      shown.current = ++latest.current;
      current.current = { norm: "", key: "", provisional: false };
      committedKey.current = null;
      inflight.current?.ctrl.abort();
      dropLingering();
      clearRetry();
    },
    [],
  );

  return useMemo(
    () => ({
      phase,
      result,
      provisional,
      pending: showPending && !streaming,
      error: error ?? PHASE_ERROR[phase] ?? null,
      retry,
      submitNext,
      prime,
    }),
    [phase, result, provisional, showPending, streaming, error, retry, submitNext, prime],
  );
}
