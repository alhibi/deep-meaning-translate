import { readDeviceValue, storageReachable, writeDeviceValue } from "./persistence/settings";

export const INTRO_KEY = "lingua.intro.seen.v1";
/** Marks the document before paint when this visit will open the intro. */
const INTRO_ATTR = "data-intro";

export function shouldShowIntro(): boolean {
  // An intro that cannot be remembered would return on every visit; stay silent instead.
  if (!storageReachable()) return false;
  return readDeviceValue(INTRO_KEY) !== "1";
}

/**
 * The intro is a full-screen takeover, so the shell must not paint behind it first.
 *
 * This runs before paint, exactly like `THEME_BOOT`: the document records whether an
 * intro is pending, and CSS holds the translator back until the intro mounts or this
 * visit decides not to show one. Without it, a first visit paints the translator and
 * then covers it — the flash that the theme boot script already exists to prevent.
 *
 * It stays silent when storage is blocked: the app must remain usable, and an intro
 * that cannot be remembered would return on every visit.
 */
export const INTRO_BOOT = `(function(){try{if(localStorage.getItem("${INTRO_KEY}")!=="1")document.documentElement.setAttribute("${INTRO_ATTR}","open");}catch(e){}})();`;

/** True while the pre-paint gate is holding the shell for the intro. */
export function introPending(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(INTRO_ATTR);
}

/** Release the gate: the intro mounted, or this visit will not show one. */
export function releaseIntroGate(): void {
  if (typeof document !== "undefined") document.documentElement.removeAttribute(INTRO_ATTR);
}

export function markIntroSeen(): void {
  // Storage is optional; the translator must remain usable without it.
  void writeDeviceValue(INTRO_KEY, "1");
  // Released before the exit animation, so the translator is already there when the
  // intro slides away instead of appearing through a hole.
  releaseIntroGate();
}
