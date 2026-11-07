import type { Prefs, Session } from "../persist";
import { checkSource } from "./languageCheck";
import {
  DEFAULT_BRAIN,
  effectiveBrain,
  type Brain,
  type Dialect,
  type StyleOverride,
  type TranslationResult,
} from "./types";

/**
 * What the translator must restore when a saved session is reopened.
 *
 * A session is the *current thought*: its text, its language pair, its style and the
 * translation that was on screen. Preferences only describe the last-used defaults.
 * Restoring the preference pair instead of the session pair used to prime a cache key
 * the first request could never find — the draft returned, the translation vanished,
 * and the sentence was paid for again. Keeping the decision here, pure and tested,
 * stops those two paths from drifting apart.
 */
export interface RestorePlan {
  text: string;
  /** The pair shown in the language bar. */
  source: string;
  target: string;
  /** What the model is told; a strong writing-system mismatch means "auto". */
  requestSource: string;
  style: StyleOverride;
  dialect: Dialect;
  brain: Brain;
  result: TranslationResult | null;
}

export function restorePlan(session: Session, prefs: Prefs | null): RestorePlan {
  const dialect: Dialect = prefs?.dialect ?? "auto";
  return {
    text: session.text,
    source: session.source,
    target: session.target,
    requestSource: checkSource(session.text, session.source)?.strong ? "auto" : session.source,
    style: session.style,
    dialect,
    brain: effectiveBrain(prefs?.brain ?? DEFAULT_BRAIN),
    result: session.result,
  };
}
