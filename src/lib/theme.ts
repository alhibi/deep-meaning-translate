import { useCallback, useEffect, useRef, useState } from "react";
import { writeDeviceValue } from "./persistence/settings";

export const THEMES = ["dark", "light", "vivid"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = "lingua.theme.v1";

/**
 * Three themes and only three: clay dark, paper light, and `vivid` — a cool near-black
 * with an electric signal, for the person who finds the calm palette too quiet.
 *
 * Every other saved value falls back to clay dark. That includes the retired navy and
 * burgundy themes: an old preference must land on a palette that exists, not on a
 * half-applied one.
 */
export function parseTheme(value: unknown): Theme {
  return value === "light" ? "light" : value === "vivid" ? "vivid" : "dark";
}

export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "dark";
}

/**
 * Shared validation runs before paint, so no visit ever flashes the wrong palette.
 * The class name *is* the theme name (`dark` / `light` / `vivid`), which keeps this
 * boot script and the CSS in `styles.css` from drifting apart — there is no mapping
 * table here that the stylesheet has to agree with.
 */
export const THEME_BOOT = `(function(){var P=${parseTheme.toString()};var t="dark";try{var s=localStorage.getItem("${THEME_KEY}");t=s===null?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):P(s);}catch(e){}var d=document.documentElement;d.classList.remove("dark","light","vivid");d.classList.add(t);d.dataset.theme=t;d.style.colorScheme=t==="light"?"light":"dark";})();`;

function current(): Theme {
  return parseTheme(document.documentElement.dataset["theme"]);
}

/**
 * Keep the browser chrome in step with the document palette (mobile address bar, PWA).
 * The root route calls this once after mount: `/stats` renders no ThemeToggle, so
 * without it a light visit kept the hardcoded dark `theme-color` from the server head.
 */
export function syncThemeColor(): void {
  if (typeof document === "undefined") return;
  const color = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
  // jsdom has no stylesheet; never blank the meta with an empty computed value.
  if (!color) return;
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute("content", color));
}

function apply(t: Theme) {
  const d = document.documentElement;
  d.classList.remove("dark", "light", "vivid");
  d.classList.add(t);
  d.dataset["theme"] = t;
  // `vivid` is a dark palette: form controls, scrollbars and the UA colour scheme
  // all follow the dark branch, exactly as they do for clay dark.
  d.style.colorScheme = t === "light" ? "light" : "dark";
  syncThemeColor();
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");
  const selected = useRef<Theme>("dark");
  const activeTransition = useRef<{ skipTransition: () => void } | null>(null);

  useEffect(() => {
    const t = current();
    selected.current = t;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
    setTheme(t);
    apply(t);
    return () => activeTransition.current?.skipTransition();
  }, []);

  /** Toggle with a circular reveal spreading from (x, y). */
  const toggle = useCallback((x: number, y: number) => {
    const next = nextTheme(selected.current);
    selected.current = next;
    activeTransition.current?.skipTransition();
    // The palette switches immediately; the durable choice is written by the active
    // adapter (DataStore in the app, the same localStorage key in a browser).
    void writeDeviceValue(THEME_KEY, next);
    const run = () => {
      apply(selected.current);
      setTheme(selected.current);
    };
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => {
        ready: Promise<void>;
        finished: Promise<void>;
        skipTransition: () => void;
      };
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
    // Route navigation fades across; the theme *spreads*. Both use the same root
    // pseudo-elements, so the reveal marks the document while it owns them —
    // otherwise one of the two would be left with no animation at all.
    document.documentElement.classList.add("theme-reveal");
    void vt.finished
      .catch(() => {})
      .then(() => document.documentElement.classList.remove("theme-reveal"));
    void vt.ready
      .then(() => {
        if (activeTransition.current !== vt) return;
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          {
            duration: 720,
            easing: "cubic-bezier(0.65, 0, 0.35, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        /* Interrupted reveals still apply the most recent choice. */
      });
  }, []);

  return { theme, toggle };
}
