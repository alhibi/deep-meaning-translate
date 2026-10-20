import { memo, useRef } from "react";
import { stableTokens, tokenize } from "./streamingTokens";

/**
 * Renders a growing translation so it feels typed by the model itself:
 * words already shown stay still; only new or rewritten words glide in,
 * staggered slightly when several arrive in one chunk.
 */
export const StreamingText = memo(function StreamingText({ text }: { text: string }) {
  const prev = useRef<string[]>([]);
  const gen = useRef(0);
  const keys = useRef<string[]>([]);
  const tokens = tokenize(text);
  const keep = stableTokens(prev.current, tokens);
  if (keep < tokens.length || tokens.length !== prev.current.length) gen.current += 1;
  const nextKeys = tokens.map((_, i) => (i < keep ? keys.current[i]! : `${gen.current}-${i}`));
  prev.current = tokens;
  keys.current = nextKeys;
  let fresh = 0;
  return (
    <>
      {tokens.map((tok, i) => {
        if (i < keep || /^\s+$/.test(tok)) return <span key={nextKeys[i]}>{tok}</span>;
        const delay = Math.min(fresh++, 10) * 22;
        return (
          <span key={nextKeys[i]} className="word-in" style={{ animationDelay: `${delay}ms` }}>
            {tok}
          </span>
        );
      })}
    </>
  );
});
