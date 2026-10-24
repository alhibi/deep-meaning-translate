/**
 * Haptic vocabulary.
 *
 * One shared 6 ms tick was enough while the app had one meaningful action. It now has
 * several, and a vibration that says "copied" should not feel identical to one that
 * says "you picked a language". Each gesture gets a distinct rhythm, kept short enough
 * that two quick taps never blur into one another.
 *
 * Two hard rules, both respected below:
 * - `prefers-reduced-motion` means no vibration at all — a person who asked for calm
 *   asked for calm in their hand too, not only on screen;
 * - vibration is best-effort: iOS Safari has no `navigator.vibrate`, and a desktop
 *   browser has no motor. Absence is normal, never an error.
 */
import type { Gesture } from "./sound";

export type { Gesture };

/** Vibration rhythm per gesture, in milliseconds (on, off, on…). */
const PATTERN: Record<Gesture, number[]> = {
  tap: [5],
  confirm: [7, 24, 10],
  arrive: [9, 28, 6],
  swap: [6, 16, 6],
  dismiss: [8],
};

/** True when the device can vibrate and the person has not asked for reduced motion. */
export function canVibrate(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  if (typeof window === "undefined") return false;
  try {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/** Vibrate one gesture, if this device can and the caller is allowed to ask. */
export function buzz(gesture: Gesture, allowed = true): void {
  if (!allowed || !canVibrate()) return;
  try {
    navigator.vibrate(PATTERN[gesture]);
  } catch {
    /* unsupported or blocked: silence is the correct fallback */
  }
}
