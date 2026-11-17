import { memo } from "react";
import { tokenize } from "./streamingTokens";

/** The echo must have the exact same whitespace/line boxes as the native field below it. */
export const DictationText = memo(function DictationText({
  text,
  baseLength,
}: {
  text: string;
  baseLength: number;
}) {
  let offset = 0;
  return (
    <>
      {tokenize(text).map((token, index) => {
        const fresh = offset >= baseLength && /\S/.test(token);
        offset += token.length;
        return (
          <span key={index} className={fresh ? "speech-word" : undefined}>
            {token}
          </span>
        );
      })}
    </>
  );
});
