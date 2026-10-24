import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** jsdom (and any layout-less environment) reports no boxes at all for the page. */
const hasLayout = () =>
  typeof document !== "undefined" && document.body.getClientRects().length > 0;

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      !el.hasAttribute("hidden") &&
      el.getAttribute("aria-hidden") !== "true" &&
      !el.closest("[inert]") &&
      // A layout check only where layout exists: jsdom has none, and skipping it there
      // would make the trap impossible to test.
      (!hasLayout() || el.getClientRects().length > 0),
  );
}

/**
 * A dialog that behaves like one: focus moves inside when it opens, never escapes
 * while it is open (Tab and Shift+Tab wrap), and returns to where it came from when
 * it closes. Sheets can stack, so the trap is scoped to the topmost element that
 * claims it — the last opened sheet wins, like the Escape/Back handling already does.
 */
const openTraps: symbol[] = [];

export function useFocusTrap(open: boolean, container: RefObject<HTMLElement | null>) {
  const id = useRef(Symbol("focus-trap"));
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const root = container.current;
    if (!root) return undefined;

    const trapId = id.current;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openTraps.push(trapId);

    const isTopMost = () => openTraps.at(-1) === trapId;

    // Focus now: effects run after the commit, so the sheet's contents already exist.
    // (Waiting a frame let the focus land after the person could already have typed.)
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusable(root)[0];
    (first ?? root).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !isTopMost()) return;
      const items = focusable(root);
      if (!items.length) {
        event.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof Node && root.contains(active);
      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? lastItem : firstItem).focus();
        return;
      }
      if (event.shiftKey && active === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const index = openTraps.lastIndexOf(trapId);
      if (index >= 0) openTraps.splice(index, 1);
      // Return focus to the control that opened the sheet, so keyboard and screen-reader
      // users continue exactly where they left off.
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [open, container]);
}
