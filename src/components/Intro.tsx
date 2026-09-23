import { ArrowDown } from "lucide-react";
import { useEffect, useState } from "react";
import { markIntroSeen } from "@/lib/intro";
import { useI18n } from "@/lib/i18n";
import { tick } from "@/lib/haptics";

export function Intro({ onComplete }: { onComplete: () => void }) {
  const { t, rtl } = useI18n();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function enter() {
    if (leaving) return;
    tick();
    markIntroSeen();
    setLeaving(true);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(onComplete, reduceMotion ? 20 : 880);
  }

  return (
    <section
      data-testid="first-intro"
      data-leaving={leaving || undefined}
      dir={rtl ? "rtl" : "ltr"}
      className="intro-screen fixed inset-0 z-[100] flex min-h-[100dvh] flex-col overflow-hidden bg-background px-7 pad-safe-top pad-safe-bottom"
      aria-label={t("introLabel")}
    >
      <div aria-hidden className="intro-thread intro-thread-a" />
      <div aria-hidden className="intro-thread intro-thread-b" />

      <div className="intro-brand flex items-center gap-2 text-[15px] font-semibold text-foreground">
        <span className="size-1.5 rotate-45 rounded-[1.5px] bg-signal" />
        today
      </div>

      <div className="intro-center relative flex flex-1 flex-col items-center justify-center text-center">
        <div className="intro-icon-wrap relative grid size-40 place-items-center sm:size-44">
          <span
            aria-hidden
            className="intro-ring absolute inset-0 rounded-full border border-border-strong"
          />
          <img
            src="/icon-monochrome-512.png"
            alt=""
            className="intro-cat relative size-36 object-contain sm:size-40"
          />
        </div>
        <h1 className="intro-title mt-8 max-w-[330px] text-balance text-[34px] font-medium leading-[1.12] text-foreground">
          {t("introTitle")}
        </h1>
        <p className="intro-copy mt-4 max-w-[300px] text-pretty text-[15px] leading-7 text-muted-foreground">
          {t("introCopy")}
        </p>
      </div>

      <button
        type="button"
        data-testid="intro-enter"
        onClick={enter}
        className="intro-action press-soft mx-auto mb-2 flex min-h-14 w-full max-w-sm items-center justify-between rounded-lg border border-border-strong bg-card px-5 text-start text-[15px] font-medium text-foreground"
      >
        <span>{t("introEnter")}</span>
        <span className="grid size-8 place-items-center rounded-full bg-signal text-signal-foreground">
          <ArrowDown className="size-4" strokeWidth={1.8} />
        </span>
      </button>
    </section>
  );
}
