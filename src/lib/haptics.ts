/** A single, very short tick — only for meaningful, completed actions. */
export function tick() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    navigator.vibrate(6);
  } catch {
    /* unsupported */
  }
}
