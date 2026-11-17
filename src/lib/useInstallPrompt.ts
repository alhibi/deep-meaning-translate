import { useCallback, useEffect, useState } from "react";
import { readDeviceValue, writeDeviceValue } from "./persistence/settings";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "lingua.install.dismissed";

function isIosBrowser(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return isIos && !isStandalone;
}

/** Exposes install when the browser offers it or on iOS Safari, and never after a dismissal. */
export function useInstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if ((navigator as unknown as { standalone?: boolean }).standalone === true) return;
    if (readDeviceValue(DISMISS_KEY)) return;

    if (isIosBrowser()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial device capability detection
      setIsIos(true);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    const onInstalled = () => {
      setEvt(null);
      setIsIos(false);
      setShowIosGuide(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (isIos) {
      setShowIosGuide(true);
      return;
    }
    if (!evt) return;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === "dismissed") void writeDeviceValue(DISMISS_KEY, "1");
    setEvt(null);
  }, [evt, isIos]);

  const closeIosGuide = useCallback(() => {
    setShowIosGuide(false);
  }, []);

  const dismissForever = useCallback(() => {
    void writeDeviceValue(DISMISS_KEY, "1");
    setShowIosGuide(false);
    setIsIos(false);
    setEvt(null);
  }, []);

  const canInstall = evt !== null || isIos;

  return { canInstall, install, isIos, showIosGuide, closeIosGuide, dismissForever };
}
