import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "lingua.theme.v1";
const COLORS: Record<Theme, string> = { dark: "#12100F", light: "#F7F3EC" };

/** Runs before paint (inlined in <head>): stored choice, else the system's. No flash. */
export const THEME_BOOT = `(function(){try{var s=localStorage.getItem("${THEME_KEY}");var t=s==="light"||s==="dark"?s:(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");var d=document.documentElement;d.classList.add(t);d.style.colorScheme=t;}catch(e){document.documentElement.classList.add("dark")}})();`;

function current(): Theme {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function apply(t: Theme) {
  const d = document.documentElement;
  d.classList.remove("light", "dark");
  d.classList.add(t);
  d.style.colorScheme = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", COLORS[t]));
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const t = current();
    setTheme(t);
    apply(t);
    // Follow the system until the user picks explicitly.
    const mq = matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (localStorage.getItem(THEME_KEY)) return;
      const next: Theme = mq.matches ? "light" : "dark";
      apply(next);
      setTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /** Toggle with a circular reveal spreading from (x, y). */
  const toggle = useCallback((x: number, y: number) => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode: still switch */
    }
    const run = () => {
      apply(next);
      setTheme(next);
    };
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    if (!doc.startViewTransition || reduce) {
      document.documentElement.classList.add("theme-fade");
      run();
      window.setTimeout(() => document.documentElement.classList.remove("theme-fade"), 500);
      return;
    }
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const vt = doc.startViewTransition(run);
    void vt.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 720, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  }, []);

  return { theme, toggle };
}
