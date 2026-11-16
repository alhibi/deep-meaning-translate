import { useState, useSyncExternalStore } from "react";
import { RotateCw, X } from "lucide-react";
import { appUpdateAvailable, subscribeAppUpdate } from "@/lib/pwa";
import { useI18n } from "@/lib/i18n";
import { feel } from "@/lib/feel";

/**
 * A quiet, dismissible update pill for the web app. It appears only when a service
 * worker that was already controlling this page hands over to a newer one — never on a
 * first visit — and it never reloads on its own: the person is usually mid-sentence.
 */
export function UpdateNotice() {
  const ready = useSyncExternalStore(subscribeAppUpdate, appUpdateAvailable, () => false);
  const [dismissed, setDismissed] = useState(false);
  const { t } = useI18n();
  if (!ready || dismissed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="animate-rise pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-border-strong bg-card py-1.5 pe-1.5 ps-3.5">
        <span className="truncate text-[12.5px] text-muted-foreground">{t("updateReady")}</span>
        <button
          type="button"
          onClick={() => {
            feel.confirm();
            window.location.reload();
          }}
          className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-signal px-3 text-[12px] font-medium text-signal-foreground"
        >
          <RotateCw className="size-3.5" strokeWidth={2} aria-hidden />
          {t("updateNow")}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("updateLater")}
          className="press grid size-8 shrink-0 place-items-center rounded-full text-faint hover:text-foreground"
        >
          <X className="size-3.5" strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </div>
  );
}
