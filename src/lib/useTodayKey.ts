import { useSyncExternalStore } from "react";
import { dayKey } from "./stats/engine";

/**
 * The device clock is an external system: reading it during render would make a
 * component impure and pin "today" to whatever the first paint saw. This store
 * exposes a cached day key through `useSyncExternalStore`, so components stay pure
 * and a page left open overnight rolls over at local midnight on its own.
 *
 * The server snapshot is empty on purpose: history lives on the device, so the
 * server already renders the empty state — the first client snapshot then supplies
 * the day without a hydration mismatch.
 */
let current = "";
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule() {
  if (timer) clearTimeout(timer);
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    5,
    0,
  ).getTime();
  timer = setTimeout(
    () => {
      current = dayKey(Date.now());
      for (const listener of listeners) listener();
      schedule();
    },
    Math.max(1000, nextMidnight - now.getTime()),
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (current === "") current = dayKey(Date.now());
  schedule();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => current;
const getServerSnapshot = () => "";

/** Today as `YYYY-MM-DD` in the device's own time zone; `""` before hydration. */
export function useTodayKey(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test seam: forget the cached day so a fresh subscription re-reads the clock. */
export function resetTodayKeyForTests(): void {
  current = "";
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  listeners.clear();
}
