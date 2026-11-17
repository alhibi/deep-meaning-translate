import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, X } from "lucide-react";
import type { CultureLocale } from "@/lib/culture/types";
import type { CultureDetailItem, CultureDiscoveryAdapter, CultureListEntry } from "./contract";
import type { CultureCopy } from "./copy";
import { useAndroidBack } from "@/lib/useAndroidBack";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useCultureRecord } from "./useDiscovery";
import {
  categoryLabel,
  directionOf,
  formatDate,
  languageName,
  licenseName,
  localized,
  placeLine,
  provenanceLabel,
  textDirection,
} from "./format";
import { MediaBlock, SaveButton, metaClass } from "./CultureBits";
import { CalmNotice } from "./CultureStates";

/**
 * The reading surface for one discovery.
 *
 * It is a real dialog: focus moves in, Tab wraps, focus returns to the card that opened it,
 * Escape and Android back close it, and the browser history entry it pushes means the
 * browser's own back gesture closes the reading instead of leaving the translator. The
 * opener's scroll position is restored by the section after the dialog unmounts.
 *
 * Provenance is never hidden: an institutional description and AI-assisted editorial are
 * labelled differently next to the words they describe, and the source, licence,
 * attribution and image credit are always one tap away.
 */

export interface CultureDetailProps {
  adapter: CultureDiscoveryAdapter;
  itemId: string;
  locale: CultureLocale;
  copy: CultureCopy;
  online: boolean;
  saved: boolean;
  onToggleSaved: () => void;
  onClose: () => void;
  onOpenRelated: (entry: CultureListEntry) => void;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] leading-snug text-faint">{label}</dt>
      <dd className="m-0 text-[13px] leading-relaxed text-foreground">{value}</dd>
    </div>
  );
}

function DetailBody({
  headingId,
  item,
  related,
  locale,
  copy,
  onOpenRelated,
}: {
  headingId: string;
  item: CultureDetailItem;
  related: CultureListEntry[];
  locale: CultureLocale;
  copy: CultureCopy;
  onOpenRelated: (entry: CultureListEntry) => void;
}) {
  const title = localized(item.title, locale);
  const original = item.title.original?.trim();
  const originalLanguage = item.title.originalLanguage;
  const hasOriginal = Boolean(original && original !== title);
  const originalDirection = textDirection(original, originalLanguage);
  const summary = localized(item.summary, locale);
  const description = localized(item.description, locale);
  const distinctive = localized(item.whyDistinctive, locale);
  const place = placeLine(item.place, locale, copy);
  const modified = formatDate(item.source.modified, locale);

  return (
    <article className="flex flex-col gap-5">
      {item.media ? (
        <MediaBlock
          media={item.media}
          alt={title}
          aspect="aspect-[16/9]"
          copy={copy}
          fallback={null}
        />
      ) : null}

      <header className="flex flex-col gap-2">
        <h2
          id={headingId}
          data-autofocus
          tabIndex={-1}
          className="text-[24px] font-medium leading-tight text-foreground outline-none sm:text-[27px]"
        >
          {title}
        </h2>
        {hasOriginal ? (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12.5px] text-faint">
            <span>{copy.originalLanguageLabel}</span>
            <span
              lang={originalLanguage}
              dir={originalDirection}
              className={
                "text-[17px] leading-relaxed text-foreground " +
                (originalDirection === "rtl" ? "font-arabic" : "")
              }
            >
              {original}
            </span>
            {originalLanguage ? (
              <span className="text-faint">{languageName(originalLanguage, locale)}</span>
            ) : null}
          </p>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          <span>{categoryLabel(item.taxonomy.category, copy)}</span>
          {place ? (
            <>
              <span aria-hidden>·</span>
              <span>{place}</span>
            </>
          ) : null}
        </p>
      </header>

      <section aria-label={copy.summaryLabel} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[12px] font-normal text-faint">{copy.summaryLabel}</h3>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
            {provenanceLabel(item.provenance, copy)}
          </span>
        </div>
        <p className="max-w-[68ch] text-[15px] leading-relaxed text-foreground">{summary}</p>
        {description && description !== summary ? (
          <p className="max-w-[68ch] text-[14.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </section>

      {distinctive ? (
        <section aria-label={copy.whyDistinctive} className="border-s-2 border-border-strong ps-4">
          <h3 className="text-[12px] font-normal text-faint">{copy.whyDistinctive}</h3>
          <p className="mt-1.5 max-w-[68ch] text-[14.5px] leading-relaxed text-foreground">
            {distinctive}
          </p>
        </section>
      ) : null}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <MetaRow label={copy.placeLabel} value={place} />
        {item.place.community ? (
          <MetaRow label={copy.communityLabel} value={item.place.community} />
        ) : null}
        {item.period ? <MetaRow label={copy.periodLabel} value={item.period} /> : null}
        {item.subject ? <MetaRow label={copy.subjectLabel} value={item.subject} /> : null}
      </dl>

      {item.tags.length ? (
        <section aria-label={copy.tagsLabel} className="flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] leading-relaxed text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </section>
      ) : null}

      {related.length ? (
        <section aria-label={copy.relatedLabel}>
          <h3 className="text-[12px] font-normal text-faint">{copy.relatedLabel}</h3>
          <ul className="mt-1 flex flex-col divide-y divide-border">
            {related.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onOpenRelated(entry)}
                  className="press-soft flex min-h-11 w-full items-center justify-between gap-3 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 truncate text-[14px] text-foreground">
                    {localized(entry.title, locale)}
                  </span>
                  <span className="shrink-0 text-[11px] text-faint">
                    {categoryLabel(entry.category, copy)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label={copy.sourceLabel} className="rounded-2xl bg-card p-4">
        <h3 className="text-[12px] font-normal text-faint">{copy.sourceLabel}</h3>
        <a
          href={item.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex min-h-11 items-center gap-1 text-[14px] font-medium text-foreground underline decoration-border underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {item.source.organization}
          <ArrowUpRight aria-hidden className="size-4" strokeWidth={1.75} />
          <span className="sr-only">{copy.opensInNewTab}</span>
        </a>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] leading-relaxed text-muted-foreground">
          <span className="text-faint">{copy.licenseLabel}</span>
          {item.source.licenseUrl ? (
            <a
              href={item.source.licenseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-foreground underline decoration-border underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {licenseName(item.source.license)}
              <span className="sr-only">{copy.opensInNewTab}</span>
            </a>
          ) : (
            <span className="text-foreground">{licenseName(item.source.license)}</span>
          )}
        </p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          <span className="text-faint">{copy.attributionLabel}: </span>
          {item.source.attribution}
        </p>
        {modified ? (
          <p className="mt-1 text-[12px] leading-relaxed text-faint">
            {copy.modifiedLabel}: {modified}
          </p>
        ) : null}
      </section>
    </article>
  );
}

export function CultureDetail({
  adapter,
  itemId,
  locale,
  copy,
  online,
  saved,
  onToggleSaved,
  onClose,
  onOpenRelated,
}: CultureDetailProps) {
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const record = useCultureRecord(adapter, itemId, online);
  const closed = useRef(false);

  const requestClose = useCallback(() => {
    // One close per mount: Escape, the scrim and the close control can arrive together.
    if (closed.current) return;
    closed.current = true;
    onClose();
  }, [onClose]);

  useFocusTrap(true, dialogRef);
  useAndroidBack(true, requestClose);

  // The browser history entry belongs to the section (one entry for the whole reading,
  // including related records); this dialog only reports that it wants to close.

  // The page behind the dialog must not scroll while the reading does.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      requestClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50" dir={directionOf(locale)}>
      <div aria-hidden className="absolute inset-0 bg-background/80" onClick={requestClose} />
      <div className="absolute inset-0 flex items-stretch justify-center sm:p-6">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={record.state.status === "ready" ? headingId : undefined}
          aria-label={record.state.status === "ready" ? undefined : copy.detailLoading}
          tabIndex={-1}
          className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden bg-surface outline-none sm:h-[min(92dvh,880px)] sm:rounded-[24px]"
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className={metaClass(locale)}>
              {record.state.status === "ready"
                ? categoryLabel(record.state.item.taxonomy.category, copy)
                : copy.detailLoading}
            </span>
            <span className="flex items-center gap-1">
              {record.state.status === "ready" ? (
                <SaveButton saved={saved} copy={copy} onToggle={onToggleSaved} />
              ) : null}
              <button
                type="button"
                onClick={requestClose}
                aria-label={copy.detailClose}
                className="press-soft grid size-11 place-items-center rounded-full text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden className="size-[18px]" strokeWidth={1.75} />
              </button>
            </span>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
            {record.state.status === "loading" ? (
              <div aria-busy="true">
                <p role="status" className={metaClass(locale)}>
                  {copy.detailLoading}
                </p>
                <div aria-hidden className="mt-4 flex flex-col gap-3">
                  <div className="h-5 w-2/3 rounded-full bg-muted" />
                  <div className="h-3 w-full rounded-full bg-muted" />
                  <div className="h-3 w-5/6 rounded-full bg-muted" />
                </div>
              </div>
            ) : record.state.status === "error" ? (
              <CalmNotice
                locale={locale}
                tone={record.state.offline ? "offline" : "quiet"}
                title={record.state.offline ? copy.offlineTitle : copy.detailError}
                body={record.state.offline ? copy.offlineBody : copy.errorBody}
                actionLabel={copy.retry}
                onAction={record.retry}
              />
            ) : (
              <DetailBody
                headingId={headingId}
                item={record.state.item}
                related={record.state.related}
                locale={locale}
                copy={copy}
                onOpenRelated={onOpenRelated}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
