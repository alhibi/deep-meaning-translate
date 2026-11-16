import { useCallback, useEffect, useState } from "react";
import { readDeviceValue, writeDeviceValue } from "./persistence/settings";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "lingua.install.dismissed";

/** Exposes install only when the browser actually offers it, and never after a dismissal. */
export function useInstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (readDeviceValue(DISMISS_KEY)) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    const onInstalled = () => setEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!evt) return;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === "dismissed") void writeDeviceValue(DISMISS_KEY, "1");
    setEvt(null);
  }, [evt]);

  return { canInstall: evt !== null, install };
}
