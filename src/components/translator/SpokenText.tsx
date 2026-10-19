import { memo, useMemo } from "react";
import { tokenize } from "./streamingTokens";

/**
 * Read-along view while the translation is spoken: words already said settle
 * to full ink, the current word lifts with a clay glow, upcoming words wait dimmed.
 */
export const SpokenText = memo(function SpokenText({
  text,
  current,
}: {
  text: string;
  current: number;
}) {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <>
      {tokens.map((tok, i) =>
        /^\s+$/.test(tok) ? (
          <span key={i}>{tok}</span>
        ) : (
          <span
            key={i}
            data-state={i < current ? "said" : i === current ? "now" : "next"}
            className="spoken-word"
          >
            {tok}
          </span>
        ),
      )}
    </>
  );
});
