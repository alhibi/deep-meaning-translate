import { memo } from "react";

/**
 * The name introduces itself: every so often the word "today" is swept away and
 * replaced by the line "say it naturally." Two layered spans, compositor-only
 * transitions, one shared `tagline` flag — the timing lives in the page, the
 * choreography lives here.
 */
export const Wordmark = memo(function Wordmark({
  tagline,
  onToggle,
}: {
  tagline: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={tagline}
      className="press-soft -ms-2 inline-flex items-center gap-2 rounded-full px-2 py-1 text-[15px] font-semibold tracking-[-0.01em] text-foreground"
    >
      {/* Signature mark: a small clay diamond that spins into the gust. */}
      <span
        aria-hidden
        className="grid size-2 shrink-0 place-items-center transition-[transform,opacity] duration-[700ms] ease-[cubic-bezier(0.65,0,0.35,1)]"
        style={{
          transform: tagline ? "rotate(225deg) scale(0.7)" : "rotate(0deg) scale(1)",
          opacity: tagline ? 0.55 : 1,
        }}
      >
        <span className="size-1.5 rotate-45 rounded-[1.5px] bg-signal" />
      </span>
      {/* Storm swap: the outgoing word is swept away (blur + skew + stretch) while the
          incoming one condenses out of the blur — overlapped, never a pause. */}
      <span className="relative block h-[19px]">
        <span
          aria-hidden
          className="font-literary block h-0 overflow-hidden whitespace-nowrap text-start text-[16px] italic lowercase leading-[19px]"
        >
          say it naturally.
        </span>
        <span
          aria-hidden={tagline}
          className="block origin-left whitespace-nowrap text-start leading-[19px] will-change-[transform,filter,opacity] rtl:origin-right"
          style={{
            transition: tagline
              ? "transform 480ms cubic-bezier(0.7,0,0.84,0), filter 420ms cubic-bezier(0.5,0,0.75,0), opacity 460ms cubic-bezier(0.5,0,0.75,0), letter-spacing 480ms cubic-bezier(0.7,0,0.84,0)"
              : "transform 760ms cubic-bezier(0.16,1,0.3,1) 140ms, filter 700ms cubic-bezier(0.16,1,0.3,1) 140ms, opacity 520ms ease-out 140ms, letter-spacing 760ms cubic-bezier(0.16,1,0.3,1) 140ms",
            transform: tagline ? "translateX(55%) skewX(-24deg) scaleX(1.35)" : "none",
            filter: tagline ? "blur(9px)" : "blur(0)",
            opacity: tagline ? 0 : 1,
            letterSpacing: tagline ? "0.45em" : "-0.01em",
          }}
        >
          today
        </span>
        <span
          aria-hidden={!tagline}
          className="font-literary absolute inset-0 block origin-left whitespace-nowrap text-start text-[16px] font-normal italic lowercase leading-[19px] tracking-[0.01em] text-muted-foreground will-change-[transform,filter,opacity] rtl:origin-right"
          style={{
            transition: tagline
              ? "transform 820ms cubic-bezier(0.16,1,0.3,1) 120ms, filter 760ms cubic-bezier(0.16,1,0.3,1) 120ms, opacity 560ms ease-out 120ms"
              : "transform 460ms cubic-bezier(0.7,0,0.84,0), filter 400ms cubic-bezier(0.5,0,0.75,0), opacity 440ms cubic-bezier(0.5,0,0.75,0)",
            transform: tagline ? "none" : "translateX(-18%) skewX(16deg) scaleX(1.2)",
            filter: tagline ? "blur(0)" : "blur(10px)",
            opacity: tagline ? 1 : 0,
          }}
        >
          say it naturally.
        </span>
      </span>
    </button>
  );
});
