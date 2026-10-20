import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Lets the translation area expand downward fluidly. The outer box only holds a fixed
 * height while it animates; once settled it returns to natural (auto) height, so the
 * text can never be clipped even if a resize notification is missed (seen on Android).
 */
export function GrowBox({ children, className }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  const [growing, setGrowing] = useState(false);
  const last = useRef(0);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    last.current = el.offsetHeight;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      const next = el.offsetHeight;
      const prev = last.current;
      if (next === prev) return;
      last.current = next;
      const up = next > prev;
      cancelAnimationFrame(raf);
      // Pin the previous height, then animate to the new one on the next frame.
      setH((cur) => cur ?? prev);
      raf = requestAnimationFrame(() => {
        setH(next);
        setGrowing(up);
      });
      clearTimeout(timer);
      timer = setTimeout(() => {
        setGrowing(false);
        setH(null); // release to auto: content always fully visible
      }, 520);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={outer}
      className={`grow-box ${growing ? "is-growing" : ""}`}
      style={h == null ? undefined : { height: h }}
    >
      <div ref={inner} className={className}>
        {children}
      </div>
    </div>
  );
}
