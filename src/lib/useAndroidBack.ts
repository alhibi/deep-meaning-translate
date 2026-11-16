import { useEffect } from "react";

/**
 * Let an open overlay claim the Android back gesture.
 *
 * The native shell dispatches a cancelable `lingua:back` event. Listeners run in
 * registration order (child effects before the route effect), so a sheet can close and
 * mark the event handled before `index.tsx` decides to leave the app. Without this a
 * language/model/voice sheet closed *and* the app quit on the same back press (A4-03).
 */
export function useAndroidBack(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: Event) => {
      event.preventDefault();
      onBack();
    };
    window.addEventListener("lingua:back", handler);
    return () => window.removeEventListener("lingua:back", handler);
  }, [active, onBack]);
}
