import { memo, useRef } from "react";
import { stableTokens, tokenize } from "./streamingTokens";

/** Most words in one render that earn the full arrival animation. */
const ANIMATE_LIMIT = 28;

/**
 * Renders a growing translation so it feels written by the model itself: words already
 * shown stay still; only new or rewritten words whip in on the whirlwind, staggered when
 * several arrive in one chunk. The caret is the only "still generating" cue, and it is
 * purely decorative — screen readers get the settled answer through the panel's live
 * region, never every streaming revision.
 */
export const StreamingText = memo(function StreamingText({
  text,
  live = false,
}: {
  text: string;
  live?: boolean;
}) {
  const tokens = tokenize(text);
  const lastText = useRef<string | null>(null);
  /** Which tokens arrived in this answer and earned the animation. */
  const animated = useRef<boolean[]>([]);
  const previous = useRef<string[]>([]);
  const gen = useRef(0);
  const keys = useRef<string[]>([]);

  // A re-render with unchanged text (another state update in the same beat) must keep
  // the classes of the render that actually introduced the words. Recomputing the
  // stable prefix here would mark everything stable and strip the animation immediately.
  if (lastText.current !== text || animated.current.length !== tokens.length) {
    const keep = stableTokens(previous.current, tokens);
    if (keep < tokens.length || tokens.length !== previous.current.length) gen.current += 1;
    const nextKeys = tokens.map((_, i) => {
      if (i < keep) return keys.current[i]!;
      return `${gen.current}-${i}`;
    });
    let fresh = 0;
    const before = animated.current;
    animated.current = tokens.map((tok, i) => {
      // A word that is already whirling keeps its class when the next chunk arrives, so
      // a fast stream cannot cut its animation short mid-flight.
      if (i < keep) return before[i] ?? false;
      if (/^\s+$/.test(tok)) return false;
      if (fresh >= ANIMATE_LIMIT) {
        fresh += 1;
        return false;
      }
      fresh += 1;
      return true;
    });
    previous.current = tokens;
    keys.current = nextKeys;
    lastText.current = text;
  }

  let fresh = 0;
  return (
    <>
      {tokens.map((tok, i) => {
        if (!animated.current[i]) return <span key={keys.current[i]}>{tok}</span>;
        const delay = Math.min(fresh++, 8) * 16;
        return (
          <span key={keys.current[i]} className="word-in" style={{ animationDelay: `${delay}ms` }}>
            {tok}
          </span>
        );
      })}
      {live && text.trim() ? <span key="caret" aria-hidden className="stream-caret" /> : null}
    </>
  );
});
