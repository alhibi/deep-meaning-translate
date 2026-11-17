import { memo, useEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export const OfflinePill = memo(function OfflinePill() {
  const { t } = useI18n();
  // Start offline=false on both server and client so the first render matches;
  // the real connectivity state arrives in the effect below. Reading
  // `navigator.onLine` in the initializer mismatched SSR (workerd reports
  // onLine=false) and broke hydration.
  const [offline, setOffline] = useState(false);
  const [restored, setRestored] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const onOffline = () => {
      if (timer.current) clearTimeout(timer.current);
      setRestored(false);
      setOffline(true);
    };

    const onOnline = () => {
      setOffline(false);
      setRestored(true);
      timer.current = setTimeout(() => {
        setRestored(false);
      }, 2500);
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!offline && !restored) return null;

  return (
    <aside
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(0.6rem,env(safe-area-inset-top))] z-[60] flex justify-center px-4"
    >
      <div
        className={`animate-rise flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12px] font-medium shadow-md backdrop-blur-md transition-all ${
          offline
            ? "border-warning/30 bg-surface/90 text-warning"
            : "border-success/30 bg-surface/90 text-success"
        }`}
      >
        {offline ? (
          <WifiOff className="size-3.5 shrink-0" strokeWidth={2} />
        ) : (
          <Wifi className="size-3.5 shrink-0" strokeWidth={2} />
        )}
        <span>{offline ? t("offlinePill") : t("onlinePill")}</span>
      </div>
    </aside>
  );
});
