import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Lets the translation area expand downward fluidly: the outer height follows the
 * measured content with a soft, slightly springy ease instead of jumping line by line.
 * Shrinking is quicker so clearing never feels sluggish.
 */
export function GrowBox({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  const [growing, setGrowing] = useState(false);
  const last = useRef(0);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      const next = el.offsetHeight;
      if (next === last.current) return;
      const up = next > last.current;
      last.current = next;
      setH(next);
      setGrowing(up);
      clearTimeout(timer);
      timer = setTimeout(() => setGrowing(false), 520);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      className={`grow-box ${growing ? "is-growing" : ""}`}
      style={h == null ? undefined : { height: h }}
    >
      <div ref={inner} className={className}>
        {children}
      </div>
    </div>
  );
}
