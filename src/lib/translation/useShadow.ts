import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { Dialect, StyleOverride } from "./types";
import { carryLosses, isShadowCandidate, type Loss, type ShadowResult } from "./shadow";
import { analyzeShadow } from "./shadow.functions";

const CACHE_LIMIT = 30;
/** The shadow falls only after the translation has rested — never while typing. */
export const SHADOW_DELAY = 600;

export type ShadowState =
  | { status: "off" | "idle" | "loading" }
  | { status: "ready"; losses: Loss[]; carried?: boolean };

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
  const analyze = useServerFn(analyzeShadow);
  const [state, setState] = useState<ShadowState>({ status: "idle" });
  const generation = useRef(0);
  const cache = useRef(new Map<string, ShadowResult | null>());
  const dismissed = useRef(new Map<string, Set<string>>());
  const carry = useRef<{ translation: string; losses: Loss[] } | null>(null);
  const { text, source, target, style, uiLocale, settled, enabled } = opts;
  const translation = opts.translation.trim();
  const dialect = target === "ar" ? opts.dialect : "auto";
  const normalized = text.trim().replace(/\s+/gu, " ");
  const key = `${source}|${target}|${style}|${dialect}|${uiLocale}|${normalized}|${translation}`;
  const keyRef = useRef(key);
  keyRef.current = key;

  const visible = useCallback((k: string, r: ShadowResult | null): ShadowState => {
    if (!r) return { status: "idle" };
    const gone = dismissed.current.get(k);
    return { status: "ready", losses: gone ? r.losses.filter((l) => !gone.has(l.id)) : r.losses };
  }, []);

  useEffect(() => {
    const token = ++generation.current;
    if (!enabled) return setState({ status: "off" });
    if (!settled || !translation || !isShadowCandidate(normalized)) return setState({ status: "idle" });
    if (cache.current.has(key)) return setState(visible(key, cache.current.get(key) ?? null));
    // Just applied a fix: the untouched losses stay visible while the rest is re-checked.
    const c = carry.current;
    carry.current = null;
    if (c && c.translation === translation)
      setState({ status: "ready", losses: carryLosses(c.losses, translation, ""), carried: true });
    else setState({ status: "idle" });
    const id = setTimeout(() => {
      if (token !== generation.current) return;
      if (!c) setState({ status: "loading" });
      void analyze({
        data: {
          text: normalized,
          translation,
          source,
          target,
          style,
          uiLocale,
          dialect,
        },
      })
        .then((res) => {
          if (token !== generation.current) return;
          const value = res?.shadow ?? null;
          cache.current.set(key, value);
          if (cache.current.size > CACHE_LIMIT) {
            const first = cache.current.keys().next().value;
            if (first !== undefined) cache.current.delete(first);
          }
          setState(visible(key, value));
        })
        .catch(() => {
          if (token === generation.current) setState({ status: "idle" });
        });
    }, SHADOW_DELAY);
    return () => clearTimeout(id);
  }, [key, enabled, settled, analyze, visible]);

  /** "Keep as is": hides one loss for this exact sentence. */
  const dismiss = useCallback(
    (id: string) => {
      const k = keyRef.current;
      const set = dismissed.current.get(k) ?? new Set<string>();
      set.add(id);
      dismissed.current.set(k, set);
      setState((s) => (s.status === "ready" ? { ...s, losses: s.losses.filter((l) => l.id !== id) } : s));
    },
    [],
  );

  /** Before a fix is applied: remember the other losses so they don't flicker away. */
  const stateRef = useRef(state);
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
