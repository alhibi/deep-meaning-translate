import { useCallback, useEffect, useRef, useState } from "react";

export const THEMES = ["dark", "forest", "rose"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = "lingua.theme.v1";

export function parseTheme(value: unknown): Theme {
  return value === "forest" || value === "rose" ? value : "dark";
}

export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "dark";
}

/** Runs before paint; old light choices and damaged storage restore the dark default. */
export const THEME_BOOT = `(function(){var t="dark";try{var s=localStorage.getItem("${THEME_KEY}");if(s==="forest"||s==="rose")t=s;}catch(e){}var d=document.documentElement;d.classList.add("dark");d.dataset.theme=t;d.style.colorScheme="dark";})();`;

function current(): Theme {
  return parseTheme(document.documentElement.dataset["theme"]);
}

function apply(t: Theme) {
  const d = document.documentElement;
  d.classList.remove("light");
  d.classList.add("dark");
  d.dataset["theme"] = t;
  d.style.colorScheme = "dark";
  const color = getComputedStyle(d).getPropertyValue("--background").trim();
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute("content", color));
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");
  const selected = useRef<Theme>("dark");
  const activeTransition = useRef<{ skipTransition: () => void } | null>(null);

  useEffect(() => {
    const t = current();
    selected.current = t;
    setTheme(t);
    apply(t);
    return () => activeTransition.current?.skipTransition();
  }, []);

  /** Toggle with a circular reveal spreading from (x, y). */
  const toggle = useCallback((x: number, y: number) => {
    const next = nextTheme(selected.current);
    selected.current = next;
    activeTransition.current?.skipTransition();
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode: still switch */
    }
    const run = () => {
      apply(selected.current);
      setTheme(selected.current);
    };
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void>; skipTransition: () => void };
    };
    if (reduce) {
      run();
      return;
    }
    if (!doc.startViewTransition) {
      document.documentElement.classList.add("theme-fade");
      run();
      window.setTimeout(() => document.documentElement.classList.remove("theme-fade"), 500);
      return;
    }
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const vt = doc.startViewTransition(run);
    activeTransition.current = vt;
    void vt.ready.then(() => {
      if (activeTransition.current !== vt) return;
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        {
          duration: 720,
          easing: "cubic-bezier(0.65, 0, 0.35, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    }).catch(() => { /* Interrupted reveals still apply the most recent choice. */ });
  }, []);

  return { theme, toggle };
}
