import { callShadow } from "../native/rpc";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { Dialect, StyleOverride } from "./types";
import {
  carryLosses,
  isShadowCandidate,
  type Loss,
  type ShadowIncomplete,
  type ShadowResult,
} from "./shadow";
import { enqueueEnrichment } from "./enrichment";

const CACHE_LIMIT = 30;
/**
 * Bumped when the shadow payload/offset model changes; old cached losses must not render.
 * v2: findings carry `kind` and long-text offsets are absolute in the whole source.
 */
const SHADOW_CACHE_VERSION = 2;
/** "Keep as is" decisions are per exact sentence; the map is a cache too, so it is bounded. */
const DISMISSED_LIMIT = 24;
/** The shadow falls only after the translation has rested — never while typing. */
export const SHADOW_DELAY = 600;

export type ShadowState =
  | { status: "off" | "idle" | "loading" }
  | {
      status: "ready";
      losses: Loss[];
      carried?: boolean;
      /** Set only when part of the analysis could not be completed; never for a full answer. */
      incomplete?: ShadowIncomplete;
    };

/** Shared settled states: returning a fresh object on every keystroke re-rendered the route. */
const IDLE: ShadowState = { status: "idle" };
const OFF: ShadowState = { status: "off" };

export function useShadow(opts: {
  text: string;
  translation: string;
  source: string;
  target: string;
  style: StyleOverride;
  dialect: Dialect;
  uiLocale: Locale;
  settled: boolean;
  enabled: boolean;
}) {
  const analyze = callShadow;
  const [state, setState] = useState<ShadowState>({ status: "idle" });
  const generation = useRef(0);
  /** Set when the effect tears down (dependency change or unmount): late continuations are inert. */
  const disposed = useRef(false);
  const cache = useRef(new Map<string, ShadowResult | null>());
  const dismissed = useRef(new Map<string, Set<string>>());
  const carry = useRef<{ translation: string; losses: Loss[] } | null>(null);
  const { text, source, target, style, uiLocale, settled, enabled } = opts;
  // The exact string the result panel renders. Trimming it here shifted every offset for
  // a translation that arrived with surrounding whitespace, so the shadow could mark the
  // wrong characters. The server bounds the translation length instead.
  const translation = opts.translation;
  const dialect = target === "ar" ? opts.dialect : "auto";
  // The full draft is sent: the server aligns long texts into bounded, overlapping
  // sentence windows and returns offsets against this same normalized source. Slicing on
  // the device would multiply requests and could split an idiom across windows.
  const normalized = text.trim().replace(/\s+/gu, " ");
  // JSON rather than "|" joins: source text and translation are user content, and two
  // different (text, translation) pairs could otherwise serialize to one key and show one
  // sentence's losses over another sentence.
  const key = JSON.stringify([
    SHADOW_CACHE_VERSION,
    source,
    target,
    style,
    dialect,
    uiLocale,
    normalized,
    translation,
  ]);
  const keyRef = useRef(key);
  // eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered
  keyRef.current = key;

  const visible = useCallback((k: string, r: ShadowResult | null): ShadowState => {
    if (!r) return { status: "idle" };
    const gone = dismissed.current.get(k);
    const losses = gone ? r.losses.filter((l) => !gone.has(l.id)) : r.losses;
    // A partial analysis is reported next to its surviving findings, never as a full one.
    return { status: "ready", losses, ...(r.incomplete ? { incomplete: r.incomplete } : {}) };
  }, []);

  useEffect(() => {
    disposed.current = false;
    const token = ++generation.current;
    const controller = new AbortController();
    const teardown = () => {
      controller.abort();
      disposed.current = true;
    };
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (shadow preference)
      setState((s) => (s.status === "off" ? s : OFF));
      return teardown;
    }
    if (!settled || !translation || !isShadowCandidate(normalized)) {
      setState((s) => (s.status === "idle" ? s : IDLE));
      return teardown;
    }
    if (cache.current.has(key)) {
      const cached = cache.current.get(key) ?? null;
      cache.current.delete(key); // recency order: evict least recently used, not oldest inserted
      cache.current.set(key, cached);
      setState(visible(key, cached));
      return teardown;
    }
    // Just applied a fix: the untouched losses stay visible while the rest is re-checked.
    const c = carry.current;
    carry.current = null;
    if (c && c.translation === translation)
      setState({ status: "ready", losses: carryLosses(c.losses, translation, ""), carried: true });
    else setState({ status: "idle" });
    const id = setTimeout(() => {
      if (token !== generation.current || disposed.current || controller.signal.aborted) return;
      if (!c) setState({ status: "loading" });
      // Shares the paced background door with the dictionary: one quiet request at a time.
      // Its signal is the transport's signal: a superseded shadow aborts the wire, and a
      // second identical analysis joins the one already running instead of paying twice.
      void enqueueEnrichment(
        (signal) =>
          analyze({
            data: {
              text: normalized,
              translation,
              source,
              target,
              style,
              uiLocale,
              dialect,
            },
            signal,
          }),
        {
          purpose: "shadow",
          signal: controller.signal,
          key,
          isValid: () => token === generation.current && !disposed.current,
        },
      )
        .then((res) => {
          if (token !== generation.current || disposed.current) return;
          const value = res?.shadow ?? null;
          cache.current.set(key, value);
          if (cache.current.size > CACHE_LIMIT) {
            const first = cache.current.keys().next().value;
            if (first !== undefined) cache.current.delete(first);
          }
          setState(visible(key, value));
        })
        .catch(() => {
          // A shadow failure is not a translation failure: the sentence stays as it is and
          // the hint simply never appears.
          if (token === generation.current && !disposed.current)
            setState((s) => (s.status === "idle" ? s : IDLE));
        });
    }, SHADOW_DELAY);
    return () => {
      clearTimeout(id);
      // A queued analysis for a sentence that is gone is skipped before any network, and
      // an in-flight one is released; the teardown flag makes late continuations inert.
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key already encodes these values (and the ref is a generation token, not a node)
  }, [key, enabled, settled, analyze, visible]);

  /** "Keep as is": hides one loss for this exact sentence. */
  const dismiss = useCallback((id: string) => {
    const k = keyRef.current;
    const set = dismissed.current.get(k) ?? new Set<string>();
    set.add(id);
    if (!dismissed.current.has(k)) {
      dismissed.current.set(k, set);
      if (dismissed.current.size > DISMISSED_LIMIT) {
        const oldest = dismissed.current.keys().next().value;
        if (oldest !== undefined) dismissed.current.delete(oldest);
      }
    }
    setState((s) =>
      s.status === "ready" ? { ...s, losses: s.losses.filter((l) => l.id !== id) } : s,
    );
  }, []);

  /** Before a fix is applied: remember the other losses so they don't flicker away. */
  const stateRef = useRef(state);
  // eslint-disable-next-line react-hooks/refs -- latest-value/generation ref, read only from async callbacks — not rendered
  stateRef.current = state;
  const prepareApply = useCallback((lossId: string, nextTranslation: string) => {
    const s = stateRef.current;
    carry.current =
      s.status === "ready"
        ? { translation: nextTranslation.trim(), losses: s.losses.filter((l) => l.id !== lossId) }
        : null;
  }, []);

  return { state, dismiss, prepareApply };
}
