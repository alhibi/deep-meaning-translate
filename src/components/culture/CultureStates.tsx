import type { CultureLocale } from "@/lib/culture/types";
import type { CultureCopy } from "./copy";
import { metaClass } from "./CultureBits";

/** Loading: a quiet line, then static skeletons at the real card aspect ratios. */
export function FeedSkeleton({ locale, copy }: { locale: CultureLocale; copy: CultureCopy }) {
  return (
    <div aria-busy="true">
      <p role="status" className={metaClass(locale)}>
        {copy.loading}
      </p>
      <div aria-hidden className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="overflow-hidden rounded-2xl bg-card">
          <div className="aspect-[4/3] w-full bg-muted" />
          <div className="flex flex-col gap-2 p-4">
            <div className="h-2.5 w-24 rounded-full bg-muted" />
            <div className="h-4 w-2/3 rounded-full bg-muted" />
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl bg-card">
          <div className="aspect-[4/3] w-full bg-muted" />
          <div className="flex flex-col gap-2 p-4">
            <div className="h-2.5 w-20 rounded-full bg-muted" />
            <div className="h-4 w-1/2 rounded-full bg-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The featured slot before its record answers: reserved height, so nothing jumps. */
export function FeaturedSkeleton() {
  return (
    <div aria-hidden className="overflow-hidden rounded-[24px] bg-card">
      <div className="aspect-[16/10] w-full bg-muted" />
      <div className="flex flex-col gap-2 px-5 pb-5 pt-4">
        <div className="h-2.5 w-20 rounded-full bg-muted" />
        <div className="h-5 w-2/3 rounded-full bg-muted" />
      </div>
    </div>
  );
}

/** Calm failure, empty and offline surfaces: a sentence, at most one action, no codes. */
export function CalmNotice({
  locale,
  title,
  body,
  actionLabel,
  onAction,
  tone = "quiet",
}: {
  locale: CultureLocale;
  title: string;
  body?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  tone?: "quiet" | "offline" | undefined;
}) {
  return (
    <div
      className={
        "rounded-2xl px-5 py-6 " +
        (tone === "offline" ? "border border-border bg-transparent" : "bg-card")
      }
    >
      <p className="text-[14.5px] font-medium leading-snug text-foreground">{title}</p>
      {body ? (
        <p className="mt-1.5 max-w-[56ch] text-[13.5px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      ) : null}
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="press mt-4 min-h-11 rounded-full border border-border px-5 text-[13.5px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Inline "more failed" note: the loaded cards stay, the retry is for the next page. */
export function MoreErrorNotice({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <p
      role="status"
      className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 rounded-full px-3 text-[12.5px] font-medium text-foreground underline decoration-border underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {retryLabel}
      </button>
    </p>
  );
}
