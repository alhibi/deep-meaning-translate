import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callRepair } from "../native/rpc";
import { parseResult } from "./parse";
import { verifyTranslation } from "./verify";
import type { Dialect, StyleOverride, TranslationResult } from "./types";
import { DEFAULT_BRAIN, type Brain } from "./types";
import { delayFor, isProvisional, normalize, worthTranslating } from "./scheduler";
import { metrics } from "./metrics";
import { streamTranslate, warmTranslation } from "./stream";
import { memoryGet, memorySet } from "./memory";
import { enqueueEnrichment } from "./enrichment";

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
/**
 * How long an unchanged, still-provisional draft waits before its full reading starts.
 * Measured from the last text change, never from the live answer's arrival: anchoring the
 * clock to the live commit added the entire live round trip (0.7–2.0 s measured) to every
 * settled sentence.
 */
const FULL_READING_PAUSE_MS = 1_200;
const CACHE_LIMIT = 60;
/** Longest the screen goes without a fresh request while someone types non-stop. */
const MAX_WAIT_MS = 650;
const CACHE_TTL_MS = 30 * 60_000;

interface Cached {
  result: TranslationResult;
  at: number;
  provisional: boolean;
  full: boolean;
}

const keyOf = (text: string, source: string, target: string, style: string) =>
  `${source}|${target}|${style}|${text}`;

/**
 * The one definition of a request's identity. The in-flight cache, the device memory
 * and session priming must all agree, or a restored translation is re-requested and
 * primed results are never found.
 */
export function translationKey(
  text: string,
  source: string,
  target: string,
  style: StyleOverride,
  dialect: Dialect,
  brain: Brain,
): string {
  const styleKey = `${dialect === "auto" ? style : `${style}~${dialect}`}@${brain}`;
  return keyOf(normalize(text), source, target, styleKey);
}

/** A live reading has no detected metadata yet; never inherit another draft's language. */
function liveResult(translation: string, source: string, target: string): TranslationResult {
  return {
    sourceLanguage: source,
    targetLanguage: target,
    translation,
    tone: "",
    formality: "",
    confidence: 0.8,
    isAmbiguous: false,
    alternativeTranslations: [],
    notes: "",
  };
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * One React commit per displayed frame instead of one per provider delta.
 *
 * SSE frequently delivers dozens of small chunks per second. Committing each chunk made
 * the whole translator reconcile for text that had not visibly changed yet, which is the
 * main source of jank while an answer streams on a phone. The buffer is flushed on the
 * next animation frame, and the final result is always committed from the response text,
 * so coalescing can never lose or reorder the answer.
 */
const scheduleFrame = (cb: () => void): number =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(cb)
    : (setTimeout(cb, 16) as unknown as number);
const cancelFrame = (id: number): void => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
};

export function useTranslator(opts: {
  text: string;
  source: string;
  target: string;
  style: StyleOverride;
  dialect?: Dialect;
  brain?: Brain;
  /** An IME owns the draft until composition ends; never translate its candidate buffer. */
  composing?: boolean;
  /**
   * A translation carried over from this tab's previous mount (returning from another
   * route). It is shown on the first paint and its key is treated as committed, so the
   * scheduler neither re-requests it nor briefly replaces it with a loading state.
   */
  restored?: TranslationResult | null;
  onSuccess?: (result: TranslationResult, text: string, provisional: boolean) => void;
}) {
  const { text, source, target, onSuccess } = opts;
  const style = opts.style;
  const dialect: Dialect = target === "ar" ? (opts.dialect ?? "auto") : "auto";
  const brain: Brain = opts.brain ?? DEFAULT_BRAIN;
  const styleKey = `${dialect === "auto" ? style : `${style}~${dialect}`}@${brain}`;
  const composing = opts.composing ?? false;
  const normalized = normalize(text);
  const wantedKey = worthTranslating(normalized)
    ? keyOf(normalized, source, target, styleKey)
    : null;
  const restored = opts.restored ?? null;
  const restoredKey = restored ? keyOf(normalize(text), source, target, styleKey) : null;

  const [phase, setPhase] = useState<Phase>(restored ? "COMPLETE" : "EMPTY");
  const [result, setResult] = useState<TranslationResult | null>(restored);
  // The displayed answer has its own identity. Keeping it while editing must never
  // make it eligible for Copy, Save, enrichment or session persistence for a new draft.
  const [displayedKey, setDisplayedKey] = useState<string | null>(restoredKey);
  const displayedKeyRef = useRef<string | null>(restoredKey);
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
  const shownLen = useRef(restored?.translation.length ?? 0);
  const dropLingering = () => {
    lingering.current?.abort();
    lingering.current = null;
  };
  const committedKey = useRef<string | null>(restoredKey);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cache = useRef(new Map<string, Cached>());
  /** Paint frames and request watchdogs, so an unmount can cancel every one of them. */
  const frames = useRef(new Set<number>());
  const requestTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  /** The quiet review (if any) whose result may still replace this sentence. */
  const repairAbort = useRef<AbortController | null>(null);
  /** After unmount a late transport callback must not schedule paint or write state. */
  const disposed = useRef(false);
  const deliberate = useRef(false);
  const lastRaw = useRef("");
  const lastKeyAt = useRef(0);
  const lastSentAt = useRef(0);
  const intervals = useRef<number[]>([]);
  const lastParams = useRef("");
  const current = useRef({ norm: "", key: "", provisional: false, params: "", composing: false });
  const hasResult = useRef(false);
  // eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered
  hasResult.current = !!result;
  /** Whether the reading on screen is still a provisional live guess. Read by the pause timer. */
  const provisionalRef = useRef(false);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref, read only from the pause timer — not rendered
  provisionalRef.current = provisional;
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
      // The answer is final: an older prefix stream has nothing left to contribute and
      // must stop spending provider work on a sentence nobody is waiting for.
      lingering.current?.abort();
      lingering.current = null;
      displayedKeyRef.current = key;
      setDisplayedKey(key);
      setResult(value);
      setProvisional(prov);
      setStreaming(false);
      setError(null);
      setPhase("COMPLETE");
      successRef.current?.(value, norm, prov);
    },
    [],
  );

  const run = useCallback(
    async (norm: string, key: string, prov: boolean, attempt = 0) => {
      if (current.current.composing || current.current.key !== key) return;
      const active = inflight.current;
      if (active?.key === key && (!active.prov || prov)) {
        metrics.deduped();
        return;
      }
      clearRetry();
      setError(null);

      const hit = cache.current.get(key);
      // An explicit submission upgrades a cached live reading to a verified full one.
      if (hit && (hit.full || prov) && Date.now() - hit.at < CACHE_TTL_MS) {
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
        cache.current.set(key, { result: stored, at: Date.now(), provisional: false, full: true });
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
          dropLingering();
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
      requestTimers.current.add(timer);

      setStreaming(false);
      setPhase(attempt > 0 ? "RETRYING" : hasResult.current ? "UPDATING" : "TRANSLATING");
      metrics.request();
      lastSentAt.current = Date.now();
      const started = performance.now();

      const fail = (kind: ErrorKind, allowRetry = true) => {
        metrics.error(kind);
        // A throttled *live* request is not the user's problem: they are mid-word, and
        // the settled sentence will be translated on its own pause. Never interrupt typing
        // with a rate message — keep what is on screen and stay quiet.
        if (kind === "rate" && prov) {
          setPhase("READY");
          retryTimer.current = setTimeout(() => {
            if (token !== latest.current || current.current.key !== key) return;
            current.current.provisional = false;
            // eslint-disable-next-line react-hooks/immutability -- deferred self-call after initialization, guarded by the draft generation
            void run(norm, key, false);
          }, 1200);
          return;
        }
        const transient = kind === "rate" || kind === "network" || kind === "provider";
        if (allowRetry && transient && attempt === 0) {
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

      // Streaming paint coalescing: one commit per displayed frame. Declared outside the
      // try so an error or a superseded stream can always cancel the pending frame.
      let frame = 0;
      let pendingText = "";
      const paint = () => {
        frame = 0;
        const partialText = pendingText;
        if (disposed.current || !partialText || token < shown.current || ctrl.signal.aborted)
          return;
        const draft = current.current;
        const ownsDraft = token === latest.current && draft.key === key;
        const usefulPrefix =
          prov &&
          draft.provisional &&
          draft.norm.startsWith(norm) &&
          draft.params === `${source}|${target}|${styleKey}`;
        if (draft.composing || (!ownsDraft && !usefulPrefix)) return;
        if (token > shown.current && partialText.length < shownLen.current) return;
        // A newer stream has caught up with what is on screen: the older prefix stream
        // has done its job, so cancel it instead of letting two providers finish.
        if (lingering.current && lingering.current !== ctrl) {
          lingering.current.abort();
          lingering.current = null;
        }
        shown.current = token;
        shownLen.current = partialText.length;
        displayedKeyRef.current = key;
        setDisplayedKey(key);
        setStreaming(true);
        // Metadata from a previous draft is not evidence about this stream.
        setResult(liveResult(partialText, source, target));
        setProvisional(true);
      };
      const onText = (partialText: string) => {
        if (disposed.current) return;
        pendingText = partialText;
        if (frame) return;
        const id = scheduleFrame(() => {
          frames.current.delete(id);
          paint();
        });
        frame = id;
        frames.current.add(id);
      };
      /** Cancel a pending paint so it can never overwrite a more complete answer. */
      const dropFrame = () => {
        if (frame) {
          cancelFrame(frame);
          frames.current.delete(frame);
        }
        frame = 0;
      };

      try {
        const data = { text: norm, source, target, style, dialect, brain, partial: prov };
        // Live typing streams plain text so words appear as they are generated;
        // a finished sentence gets the full structured, verified translation.
        /**
         * A structured answer that failed to parse or that the provider cut at its token
         * ceiling is salvaged as plain live text once. A very long pasted sentence then
         * still produces a readable translation instead of a provider error, and the
         * person never has to understand why the JSON was incomplete.
         */
        let salvaged = false;
        const salvage = async (): Promise<TranslationResult | null> => {
          salvaged = true;
          const live = await streamTranslate(
            { ...data, partial: true },
            ctrl.signal,
            onText,
            "live",
          );
          dropFrame();
          if (!live.ok) return null;
          const value = liveResult(live.text, source, target);
          // A plain-text fallback is not exempt from the deterministic checks: a model
          // that degenerates into a repetition loop must surface as an error, not as a
          // wall of invented text replacing the translation.
          return verifyTranslation(data, value).length ? null : value;
        };
        type Settled =
          | {
              ok: true;
              result: TranslationResult;
              needsRepair: boolean;
              salvaged?: true;
              /** Who actually wrote it; absent when the transport cannot say. */
              writer?: Brain;
            }
          | { ok: false; kind: ErrorKind; cancelled?: true };
        let res: Settled;
        if (prov) {
          const r = await streamTranslate(data, ctrl.signal, onText, "live");
          res = r.ok
            ? {
                ok: true,
                result: liveResult(r.text, source, target),
                needsRepair: false,
              }
            : r;
        } else {
          const r = await streamTranslate(data, ctrl.signal, onText, "full");
          // This run was superseded while the full request was finishing. Its buffered
          // live paint may still be the newest text on screen, so leave it to land and
          // never spend a salvage request nobody is waiting for.
          if (token !== latest.current || current.current.key !== key) return;
          dropFrame();
          if (!r.ok) {
            res = r;
            // A provider error may be a cut-off answer or a transport failure; one plain
            // live request can still salvage a readable translation.
            if (r.kind === "provider" && attempt === 0) {
              const value = await salvage();
              if (value) res = { ok: true, result: value, needsRepair: false, salvaged: true };
            }
          } else {
            try {
              const parsed = parseResult(r.text, data);
              res = {
                ok: true,
                result: parsed,
                needsRepair: verifyTranslation(data, parsed).length > 0,
                ...(r.writer ? { writer: r.writer } : {}),
              };
            } catch {
              const value = attempt === 0 ? await salvage() : null;
              res = value
                ? { ok: true, result: value, needsRepair: false, salvaged: true }
                : { ok: false, kind: "provider" };
            }
          }
        }
        if (token !== latest.current || current.current.key !== key) return; // superseded — shown live at most, never committed
        dropFrame();
        if (timedOut) {
          metrics.timeout();
          setError("timeout");
          setPhase("TIMEOUT");
          return;
        }
        if (ctrl.signal.aborted) return;
        metrics.latency(performance.now() - started);
        if (res.ok) {
          cache.current.set(key, {
            result: res.result,
            at: Date.now(),
            provisional: prov,
            full: !prov,
          });
          if (cache.current.size > CACHE_LIMIT)
            cache.current.delete(cache.current.keys().next().value as string);
          shown.current = token;
          commit(key, res.result, prov, norm);
          // Only a settled, verified answer is remembered. A provisional stream — and a
          // salvaged plain-text answer that never went through `verify` — must not
          // answer for this sentence forever after from device memory.
          const verified = !prov && !res.salvaged;
          if (verified) memorySet(key, res.result);
          if (verified && (res.needsRepair || res.writer === "luna")) {
            // Shown already. Finished sentences get a quiet second look only when it can
            // change something: deterministic issues need a repair, and DeepSeek only
            // reviews sentences Luna actually wrote. A clean DeepSeek result — including
            // one that rescued a failed Luna request — would make a guaranteed-null round
            // trip, so it is not sent at all.
            //
            // The review is quiet background work, so it waits at the same paced door as
            // the dictionary and the shadow — with the highest priority, because its
            // result can replace the sentence already on screen. Its own signal makes a
            // superseded review cancel before it spends a request.
            repairAbort.current?.abort();
            const review = new AbortController();
            repairAbort.current = review;
            void enqueueEnrichment(
              (signal) =>
                callRepair({
                  data: {
                    request: { ...data, ...(res.writer ? { writer: res.writer } : {}) },
                    previous: res.result,
                  },
                  signal,
                }),
              {
                purpose: "review",
                signal: review.signal,
                key,
                isValid: () =>
                  committedKey.current === key &&
                  current.current.key === key &&
                  token === latest.current,
              },
            )
              .then((r) => {
                if (
                  !r?.result ||
                  review.signal.aborted ||
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
        } else if (res.cancelled) {
          // The server ended an outdated stream quietly: not an error, never a retry.
          setPhase(hasResult.current ? "COMPLETE" : "READY");
        } else {
          // If salvage was already attempted, repeating the same expensive full request
          // would only delay the honest error.
          fail(res.kind, !salvaged);
        }
      } catch {
        // A paint scheduled by the failed stream must not land after the error state.
        // A superseded prefix stream is not an error for the screen: let its frame land.
        if (token === latest.current) dropFrame();
        if (token !== latest.current || current.current.key !== key) return;
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
        if (token === latest.current) {
          dropFrame();
          setStreaming(false);
        }
        clearTimeout(timer);
        requestTimers.current.delete(timer);
        if (inflight.current?.ctrl === ctrl) inflight.current = null;
        if (lingering.current === ctrl) lingering.current = null;
      }
    },
    [commit, source, target, style, dialect, brain, styleKey],
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
      repairAbort.current?.abort();
      repairAbort.current = null;
      inflight.current?.ctrl.abort();
      inflight.current = null;
      committedKey.current = null;
      current.current = { norm: "", key: "", provisional: false, params: "", composing };
      deliberate.current = false;
      displayedKeyRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the external request/stream snapshot when the draft becomes empty
      setDisplayedKey(null);
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
    if (!composing) deliberate.current = false;
    const prov = isProvisional(norm, text, isDeliberate);
    const key = keyOf(norm, source, target, styleKey);
    const previous = current.current;

    if (key !== previous.key || composing !== previous.composing) {
      // Invalidate NOW, not when the debounced replacement eventually starts. Otherwise
      // an old completion/retry can land during the pause and be archived for a new draft.
      clearRetry();
      latest.current++;
      // A quiet review belongs to the sentence that asked for it; a new draft must not be
      // improved, archived or repeated by it.
      repairAbort.current?.abort();
      repairAbort.current = null;
      const append =
        !composing &&
        !paramsChanged &&
        prov &&
        previous.norm &&
        norm.length > previous.norm.length &&
        norm.startsWith(previous.norm);
      const active = inflight.current;
      if (append && active?.prov) {
        dropLingering();
        lingering.current = active.ctrl;
        inflight.current = null;
      } else if (!append || active) {
        active?.ctrl.abort();
        inflight.current = null;
        dropLingering();
        shown.current = latest.current;
        // Catch-up is useful only for an append. Deleting/replacing words must be able
        // to show a shorter translation from its very first chunk.
        shownLen.current = 0;
        setStreaming(false);
      }
      setError(null);
      setShowPending(false);
    }
    current.current = { norm, key, provisional: prov, params, composing };

    if (composing) {
      setPhase("TYPING");
      return;
    }
    if (key === committedKey.current && displayedKeyRef.current === key) {
      setPhase("COMPLETE");
      setStreaming(false);
      metrics.deduped();
      return;
    }
    if (key === inflight.current?.key) {
      metrics.deduped();
      return;
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
  }, [text, source, target, styleKey, run, composing]);

  // A watchdog for a scheduler that never fires: text is visible, worth translating, but
  // the phase is still waiting and no request is in flight. Force one after a short grace.
  useEffect(() => {
    const norm = normalize(text);
    if (composing || !worthTranslating(norm)) return;
    if (phase !== "SCHEDULED" && phase !== "READY") return;
    const key = keyOf(norm, source, target, styleKey);
    const id = setTimeout(() => {
      if (inflight.current || committedKey.current === key) return;
      void run(norm, key, isProvisional(norm, text, false));
    }, 1_800);
    return () => clearTimeout(id);
  }, [text, phase, source, target, styleKey, run, composing]);

  // A pause finishes the thought, not the verification. Request one full reading even
  // without punctuation; never relabel unchecked live text as a settled/archiveable one.
  //
  // The clock starts at the last text change. Waiting for the provisional live answer to
  // arrive before starting it serialised two provider round trips: measured on the
  // deployed route the full request only left 1.2 s AFTER the live stream completed
  // (≈2.7–3.2 s after the last keystroke), although the full reading itself takes under
  // a second. The pause is unchanged; only the moment it starts counting is.
  useEffect(() => {
    if (composing) return;
    const norm = normalize(text);
    if (!worthTranslating(norm)) return;
    // Text that already ends a thought or a line goes straight to the full request from
    // the scheduler; this pause upgrade exists for text still open mid-thought.
    if (!isProvisional(norm, text, false)) return;
    const key = keyOf(norm, source, target, styleKey);
    const id = setTimeout(() => {
      if (disposed.current) return;
      const draft = current.current;
      if (draft.composing || draft.key !== key) return;
      // Nothing left to upgrade: a settled reading or a full request already in flight.
      if (committedKey.current === key && !provisionalRef.current) return;
      if (inflight.current?.key === key && !inflight.current.prov) return;
      draft.provisional = false;
      void run(draft.norm, draft.key, false);
    }, FULL_READING_PAUSE_MS);
    return () => clearTimeout(id);
  }, [text, source, target, styleKey, composing, run]);

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
    if (!norm || current.current.composing) return;
    committedKey.current = null;
    void run(norm, key, prov);
  }, [run]);

  /** Mark the next text change as a deliberate submission (paste, share, restore). */
  const submitNext = useCallback(() => {
    deliberate.current = true;
  }, []);

  /**
   * Force a request for the current text. Auto-translation normally runs from the
   * scheduler, but a controlled input inside an Android IME/WebView can keep the visible
   * value while the React state (and therefore the scheduler) lags. The explicit action
   * reads the value from the field and runs immediately, so the person always has a way
   * to translate what they can see.
   */
  const translateNow = useCallback(
    (raw: string) => {
      const norm = normalize(raw);
      if (composing || !worthTranslating(norm)) return;
      const key = keyOf(norm, source, target, styleKey);
      if (key !== current.current.key) {
        // Explicit recovery may read a DOM value React has not mirrored yet.
        shown.current = ++latest.current;
        shownLen.current = 0;
        inflight.current?.ctrl.abort();
        inflight.current = null;
        dropLingering();
        repairAbort.current?.abort();
        repairAbort.current = null;
        setStreaming(false);
      }
      current.current = {
        norm,
        key,
        provisional: false,
        params: `${source}|${target}|${styleKey}`,
        composing: false,
      };
      committedKey.current = null;
      void run(norm, key, false);
    },
    [run, source, target, styleKey, composing],
  );

  /** Seed a known result (e.g. restored session) so it shows without a new request. */
  const prime = useCallback(
    (
      raw: string,
      at: {
        source: string;
        target: string;
        style: StyleOverride;
        dialect: Dialect;
        brain: Brain;
      },
      value: TranslationResult,
    ) => {
      cache.current.set(translationKey(raw, at.source, at.target, at.style, at.dialect, at.brain), {
        result: value,
        at: Date.now(),
        provisional: false,
        full: true,
      });
    },
    [],
  );

  const stale = !!result && (displayedKey !== wantedKey || composing);
  const settled = !!result && !stale && !provisional && phase === "COMPLETE";
  const working = composing || phase === "SCHEDULED" || phase === "READY" || busy;

  // Resume automatically once the connection is back. Losing connectivity must not
  // erase the eligibility of an answer that is already complete for the current draft.
  const settledRef = useRef(settled);
  // eslint-disable-next-line react-hooks/refs -- latest eligibility snapshot, read only by the external offline event
  settledRef.current = settled;
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
      setStreaming(false);
      dropLingering();
      repairAbort.current?.abort();
      repairAbort.current = null;
      if (inflight.current) {
        shown.current = ++latest.current;
        inflight.current.ctrl.abort();
        inflight.current = null;
      }
      clearRetry();
      if (phaseRef.current !== "EMPTY" && !settledRef.current) {
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

  // Development StrictMode mounts effects, cleans them up and mounts them again on the
  // same instance. The teardown below marks the instance disposed, so the remount must
  // re-arm it — otherwise every streamed word is dropped for the rest of the session (the
  // request still runs and paints nothing). Production mounts once; the latch is the same.
  useEffect(() => {
    disposed.current = false;
  }, []);

  useEffect(
    () => () => {
      // Route change / unmount: nothing belonging to this screen may keep running, paint
      // or hold a timer. Mark disposed FIRST so a transport callback that fires during
      // teardown cannot schedule a new frame.
      disposed.current = true;
      shown.current = ++latest.current;
      current.current = { norm: "", key: "", provisional: false, params: "", composing: false };
      committedKey.current = null;
      inflight.current?.ctrl.abort();
      dropLingering();
      clearRetry();
      repairAbort.current?.abort();
      repairAbort.current = null;
      for (const frame of frames.current) cancelFrame(frame);
      frames.current.clear();
      for (const timer of requestTimers.current) clearTimeout(timer);
      requestTimers.current.clear();
    },
    [],
  );

  return useMemo(
    () => ({
      phase,
      result,
      provisional,
      stale,
      settled,
      working,
      streaming,
      pending: showPending && !streaming,
      error: error ?? PHASE_ERROR[phase] ?? null,
      retry,
      translateNow,
      submitNext,
      prime,
    }),
    [
      phase,
      result,
      provisional,
      showPending,
      streaming,
      stale,
      settled,
      working,
      error,
      retry,
      translateNow,
      submitNext,
      prime,
    ],
  );
}
