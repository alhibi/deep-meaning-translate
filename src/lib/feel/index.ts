/**
 * One place the app asks to be felt.
 *
 * Call sites say *what happened* (`feel.confirm()`), never *how*: whether that becomes
 * a vibration, a synthesised tone, both, or nothing at all is decided here, from the
 * person's own settings and the device's own limits. That keeps 15 call sites honest —
 * none of them can accidentally vibrate with sound off, or play audio on a phone that
 * is set to reduced motion.
 *
 * The object is a module singleton rather than a hook on purpose: settings are read at
 * call time, so toggling sound in the Feel sheet applies to the very next tap without
 * re-creating a single callback or re-rendering a single tree.
 */
import { buzz, type Gesture } from "./haptics";
import { getFeelPrefs } from "./prefs";
import { speak } from "./sound";

export type { Gesture };

/** Fire one gesture through every channel the person has left switched on. */
function gesture(name: Gesture): void {
  const { sound, haptics } = getFeelPrefs();
  if (haptics) buzz(name, true);
  if (sound) speak(name);
}

export const feel = {
  /** A choice was made: an option in a sheet, a toggle, a segmented control. */
  tap: () => gesture("tap"),
  /** An action completed and the user should trust it: copied, saved, applied. */
  confirm: () => gesture("confirm"),
  /** A translation landed. The signature moment of the product. */
  arrive: () => gesture("arrive"),
  /** The two languages exchanged places. */
  swap: () => gesture("swap"),
  /** Something was dismissed: a hint, a suggestion, a sheet. */
  dismiss: () => gesture("dismiss"),
} satisfies Record<Gesture, () => void>;
