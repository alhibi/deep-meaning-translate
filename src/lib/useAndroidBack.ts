import { useEffect } from "react";

/**
 * Let an open overlay claim the Android back gesture.
 *
 * `dispatchBack()` in the native shell dispatches the cancelable `lingua:back` event and
 * only decides the route/exit **after** every listener has run, by checking
 * `defaultPrevented`. That is what makes listener order safe: a mounted sheet closes and
 * cancels; the root sees the cancellation and does not exit. Without it a language/model/
 * voice sheet closed *and* the app quit on the same back press (A4-03).
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
