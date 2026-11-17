import type { CultureLocale } from "@/lib/culture/types";
import { COPY } from "./copy";

/**
 * Local, calm states for the library. A failed catalogue never takes the translator down
 * with it: these surfaces are typographic, quietly worded, and each offers the one action
 * that makes sense. Loading keeps its height, so a slow read does not move the page under
 * a finger.
 */

export function CultureLoading({ locale }: { locale: CultureLocale }) {
  const copy = COPY[locale];
  return (
    <div
      data-culture-state="loading"
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="border-t border-border pt-4"
    >
      <p className="text-[11px] uppercase tracking-[0.14em] text-faint">{copy.loading}</p>
      <div aria-hidden="true" className="mt-6 space-y-6">
        <div className="space-y-3">
          <span className="block h-2.5 w-24 animate-pulse rounded-[2px] bg-border motion-reduce:animate-none" />
          <span className="block h-9 w-4/5 animate-pulse rounded-[2px] bg-border motion-reduce:animate-none" />
          <span className="block h-3 w-full animate-pulse rounded-[2px] bg-border motion-reduce:animate-none" />
          <span className="block h-3 w-2/3 animate-pulse rounded-[2px] bg-border motion-reduce:animate-none" />
        </div>
        <div className="space-y-2.5 border-t border-border pt-4">
          <span className="block h-2.5 w-16 animate-pulse rounded-[2px] bg-border motion-reduce:animate-none" />
          <span className="block h-3 w-full animate-pulse rounded-[2px] bg-border motion-reduce:animate-none" />
          <span className="block h-3 w-3/4 animate-pulse rounded-[2px] bg-border motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}

export function CultureEmpty({
  locale,
  filtered,
  savedOnly,
  onClear,
}: {
  locale: CultureLocale;
  filtered: boolean;
  savedOnly: boolean;
  onClear(): void;
}) {
  const copy = COPY[locale];
  return (
    <div data-culture-state="empty" className="border-t border-border pt-6">
      <p className="max-w-[46ch] text-[16px] leading-[1.65] text-muted-foreground">
        {savedOnly ? copy.savedEmpty : copy.empty}
      </p>
      {filtered ? (
        <button
          type="button"
          onClick={onClear}
          className="press-soft mt-4 inline-flex min-h-9 items-center text-[12px] font-medium uppercase tracking-[0.12em] text-signal-text"
        >
          {copy.clearFilters}
        </button>
      ) : null}
    </div>
  );
}

export type CultureFailureKind = "error" | "offline" | "catalog-unavailable";

export function CultureFailure({
  locale,
  kind,
  onRetry,
}: {
  locale: CultureLocale;
  kind: CultureFailureKind;
  onRetry(): void;
}) {
  const copy = COPY[locale];
  const title =
    kind === "offline"
      ? copy.offlineTitle
      : kind === "catalog-unavailable"
        ? copy.catalogTitle
        : copy.errorTitle;
  const body =
    kind === "offline"
      ? copy.offlineBody
      : kind === "catalog-unavailable"
        ? copy.catalogBody
        : copy.errorBody;
  return (
    <div data-culture-state={kind} role="alert" className="border-t border-border pt-6">
      <p className="text-[11px] uppercase tracking-[0.14em] text-signal-text">{copy.feedLabel}</p>
      <p className="mt-2 max-w-[52ch] text-[19px] font-medium leading-[1.35] text-foreground">
        {title}
      </p>
      <p className="mt-2 max-w-[52ch] text-[14.5px] leading-[1.65] text-muted-foreground">{body}</p>
      {kind === "catalog-unavailable" ? null : (
        <button
          type="button"
          data-culture-retry
          onClick={onRetry}
          className="press-soft mt-4 inline-flex min-h-9 items-center border-b border-current pb-0.5 text-[12px] font-medium uppercase tracking-[0.12em] text-foreground"
        >
          {copy.retry}
        </button>
      )}
    </div>
  );
}

export function CultureEndNote({ locale }: { locale: CultureLocale }) {
  const copy = COPY[locale];
  return (
    <p
      data-culture-state="end"
      className="border-t border-border pt-4 text-[11px] uppercase tracking-[0.12em] text-faint"
    >
      {copy.endOfFeed}
    </p>
  );
}
