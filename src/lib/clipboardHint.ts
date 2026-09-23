import { useEffect, useState } from "react";

/**
 * Whether there is copied text waiting to be pasted.
 * Browsers only let us look when clipboard-read permission is already granted;
 * otherwise we rely on copies we can observe (in this page, or via our own Copy button).
 */
let known = false;
const listeners = new Set<(v: boolean) => void>();
function set(v: boolean) {
  known = v;
  listeners.forEach((fn) => fn(v));
}

/** Call after the app writes to the clipboard itself (navigator.clipboard.writeText fires no copy event). */
export function notifyCopied() {
  set(true);
}

async function probe() {
  try {
    const perm = await navigator.permissions?.query({ name: "clipboard-read" as PermissionName });
    if (perm?.state !== "granted") return;
    const value = await navigator.clipboard.readText();
    set(!!value.trim());
  } catch {
    /* unsupported or blocked — keep what we observed */
  }
}

export function useClipboardHint(): boolean {
  const [has, setHas] = useState(known);
  useEffect(() => {
    listeners.add(setHas);
    const onCopy = () => set(true);
    const onVisible = () => document.visibilityState === "visible" && void probe();
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void probe();
    return () => {
      listeners.delete(setHas);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);
  return has;
}
