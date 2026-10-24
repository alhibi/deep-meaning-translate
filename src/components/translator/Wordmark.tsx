import { memo } from "react";

/**
 * The name introduces itself: the word "today" cross-fades through a soft blur
 * into the line "say it naturally." Two layered spans, compositor-only
 * transitions, one shared `tagline` flag — the timing lives in the page, the
 * choreography lives here. The swap is a fade, never a gust: no skew, stretch
 * or letter-spacing, so the mark stays still and premium-quiet.
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
      {/* Signature mark: a small clay diamond that turns a quarter-turn and rests. */}
      <span
        aria-hidden
        className="grid size-2 shrink-0 place-items-center transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          transform: tagline ? "rotate(90deg)" : "rotate(0deg)",
          opacity: tagline ? 0.6 : 1,
        }}
      >
        <span className="size-1.5 rotate-45 rounded-[1.5px] bg-signal" />
      </span>
      {/* Quiet swap: the outgoing word dissolves through a blur while the incoming
          one condenses out of it — overlapped, never a pause, never a gust. */}
      <span className="relative block h-[19px]">
        <span
          aria-hidden
          className="font-literary block h-0 overflow-hidden whitespace-nowrap text-start text-[16px] italic lowercase leading-[19px]"
        >
          say it naturally.
        </span>
        <span
          aria-hidden={tagline}
          className="block whitespace-nowrap text-start leading-[19px]"
          style={{
            transition:
              "transform 520ms cubic-bezier(0.22,1,0.36,1), filter 480ms cubic-bezier(0.22,1,0.36,1), opacity 460ms ease-out",
            transform: tagline ? "translateY(-3px)" : "none",
            filter: tagline ? "blur(6px)" : "blur(0)",
            opacity: tagline ? 0 : 1,
          }}
        >
          today
        </span>
        <span
          aria-hidden={!tagline}
          className="font-literary absolute inset-0 block whitespace-nowrap text-start text-[16px] font-normal italic lowercase leading-[19px] tracking-[0.01em] text-muted-foreground"
          style={{
            transition:
              "transform 620ms cubic-bezier(0.22,1,0.36,1) 90ms, filter 560ms cubic-bezier(0.22,1,0.36,1) 90ms, opacity 520ms ease-out 90ms",
            transform: tagline ? "none" : "translateY(3px)",
            filter: tagline ? "blur(0)" : "blur(6px)",
            opacity: tagline ? 1 : 0,
          }}
        >
          say it naturally.
        </span>
      </span>
    </button>
  );
});
