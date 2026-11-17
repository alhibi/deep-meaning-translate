import { ArrowDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { markIntroSeen } from "@/lib/intro";
import { useI18n } from "@/lib/i18n";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { feel } from "@/lib/feel";

/**
 * The intro is server-rendered, so a fast visitor can tap "ابدأ" before React has
 * hydrated and attached `onClick` — that tap used to be lost and the overlay stayed
 * up forever. This capture listener runs when the module evaluates (before
 * hydration) and remembers the tap; the mount effect below then honours it.
 * After hydration React's own handler takes over and the flag is irrelevant.
 */
const INTRO_TAP_KEY = "__linguaIntroTap";
if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-testid="first-intro"]')) {
        (window as unknown as Record<string, boolean>)[INTRO_TAP_KEY] = true;
      }
    },
    true,
  );
}

export function Intro({ onComplete }: { onComplete: () => void }) {
  const { t, rtl } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const [leaving, setLeaving] = useState(false);
  /**
   * The intro is in the server-rendered tree for every visit, and CSS decides whether
   * it is shown (the pre-paint gate). Reading the computed display, rather than a prop,
   * keeps server and client markup identical while still making a returning visitor's
   * copy disappear instead of holding focus or the page scroll.
   */
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || getComputedStyle(el).display === "none") {
      onComplete();
      return;
    }
    setShown(true);
    // A tap that landed before hydration was remembered by the module-scope
    // listener above; honour it now that handlers exist.
    if ((window as unknown as Record<string, boolean>)[INTRO_TAP_KEY]) {
      delete (window as unknown as Record<string, boolean>)[INTRO_TAP_KEY];
      enter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enter is stable enough here; run once at mount
  }, [onComplete]);

  /*
   * This is a modal, not a decorative section: it covers the viewport and locks the
   * page, so it must own focus like every other overlay in the app. The page marks
   * the translator `inert` while this is open, which is why a screen reader cannot
   * wander into controls hidden behind it.
   */
  useFocusTrap(shown, ref);

  useEffect(() => {
    if (!shown) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [shown]);

  function enter() {
    if (leaving) return;
    feel.confirm();
    markIntroSeen();
    setLeaving(true);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(onComplete, reduceMotion ? 20 : 1200);
  }

  return (
    <section
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="intro-title"
      data-testid="first-intro"
      data-leaving={leaving || undefined}
      dir={rtl ? "rtl" : "ltr"}
      onKeyDown={(event) => {
        // Escape is the keyboard way out of a modal, and the only action here is to
        // begin translating.
        if (event.key === "Escape") enter();
      }}
      className="intro-screen fixed inset-0 z-[100] flex min-h-[100dvh] flex-col overflow-hidden bg-background px-7 pad-safe-top pad-safe-bottom"
    >
      <div aria-hidden className="intro-thread intro-thread-a" />
      <div aria-hidden className="intro-thread intro-thread-b" />
      <span aria-hidden className="intro-bloom" />

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
          {/* 320 px covers the 160 px slot at 2×; the PNG is the fallback for a
              browser without WebP. Explicit dimensions keep the layout still. */}
          <picture>
            <source type="image/webp" srcSet="/icon-monochrome-320.webp" />
            <img
              src="/icon-monochrome-512.png"
              alt=""
              width={320}
              height={320}
              fetchPriority="high"
              decoding="async"
              className="intro-cat relative size-36 object-contain sm:size-40"
            />
          </picture>
        </div>
        <h1
          id="intro-title"
          className="intro-title mt-8 max-w-[330px] text-balance text-[34px] font-medium leading-[1.12] text-foreground"
        >
          {t("introTitle")}
        </h1>
        <p className="intro-copy mt-4 max-w-[300px] text-pretty text-[15px] leading-7 text-muted-foreground">
          {t("introCopy")}
        </p>
      </div>

      <button
        type="button"
        data-autofocus
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
