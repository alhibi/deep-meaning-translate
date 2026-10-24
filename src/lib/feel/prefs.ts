import { useSyncExternalStore } from "react";

/**
 * Device-only feel settings. Nothing here is sent anywhere.
 *
 * Sound is **off** by default: an app that makes noise without being asked is an
 * app people uninstall. Haptics are on by default because they are silent,
 * invisible to anyone nearby, and already gated on `prefers-reduced-motion`.
 * Everything read back is validated, so damaged or foreign values fall back to
 * the defaults instead of reaching the audio or vibration APIs.
 */
export interface FeelPrefs {
  /** Tiny synthesised interface sounds. Opt-in. */
  sound: boolean;
  /** Vibration feedback for completed actions. */
  haptics: boolean;
}

const KEY = "lingua.feel.v1";
export const DEFAULT_FEEL: FeelPrefs = { sound: false, haptics: true };

export function parseFeelPrefs(value: unknown): FeelPrefs {
  const p = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    sound: typeof p["sound"] === "boolean" ? p["sound"] : DEFAULT_FEEL.sound,
    haptics: typeof p["haptics"] === "boolean" ? p["haptics"] : DEFAULT_FEEL.haptics,
  };
}

let current: FeelPrefs | null = null;
const subscribers = new Set<() => void>();

function read(): unknown {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}

export function getFeelPrefs(): FeelPrefs {
  if (current) return current;
  if (typeof window === "undefined") return DEFAULT_FEEL;
  current = parseFeelPrefs(read());
  return current;
}

export function setFeelPrefs(patch: Partial<FeelPrefs>): FeelPrefs {
  const next = { ...getFeelPrefs(), ...patch };
  current = next;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode: the choice still applies for this session */
    }
  }
  for (const fn of subscribers) fn();
  return next;
}

/** For tests and for the "forget everything" path: back to defaults, on disk too. */
export function resetFeelPrefs() {
  current = null;
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to clean */
    }
  }
  for (const fn of subscribers) fn();
}

export function useFeelPrefs(): FeelPrefs {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    getFeelPrefs,
    () => DEFAULT_FEEL,
  );
}
