import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Mounts its children only when the sentinel approaches the viewport.
 *
 * The discovery catalog is large and nobody should pay for it before scrolling towards it;
 * once mounted it stays mounted, so browsing back up never rebuilds the section. In
 * environments without IntersectionObserver (SSR, jsdom tests) it mounts on the next tick
 * rather than silently never appearing.
 */
export function DeferredMount({
  children,
  placeholder = null,
  // A phone viewport is 844 px tall, so a large margin started the discovery mount during
  // the first-load window (A14 measured 8 image requests before any scroll). This keeps the
  // section strictly below the fold until the person approaches it.
  rootMargin = "160px 0px",
}: {
  children: ReactNode;
  placeholder?: ReactNode;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return undefined;
    let cancelled = false;
    const mount = () => {
      if (!cancelled) setMounted(true);
    };
    const node = ref.current;
    if (typeof IntersectionObserver === "undefined" || !node) {
      const id = setTimeout(mount, 0);
      return () => {
        cancelled = true;
        clearTimeout(id);
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) mount();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [mounted, rootMargin]);

  return <div ref={ref}>{mounted ? children : placeholder}</div>;
}
