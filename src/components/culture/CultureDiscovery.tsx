import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { CultureDiscoveryAdapter } from "@/lib/culture/adapter";
import type { CultureIndexEntry, CultureLocale } from "@/lib/culture/types";
import { CultureCard, FeatureComposition } from "./CultureCompositions";
import { CultureFilters } from "./CultureFilters";
import { CultureReading } from "./CultureReading";
import { CultureEmpty, CultureEndNote, CultureFailure, CultureLoading } from "./CultureStates";
import { COPY } from "./copy";
import { directionOf } from "./format";
import { useCultureFeed } from "./useDiscovery";

/**
 * The written culture library, composed below the translator.
 *
 * A small label, an editorial introduction, today's reading, then a mixed feed with six
 * written compositions, one quiet index of controls, a saved shelf and an explicit "more to
 * read" step. Nothing auto-loads: there is no scroll sentinel, no request per keystroke and
 * no duplicate piece. Opening a piece is a real dialog with a restored place on close.
 */

export interface CultureDiscoveryProps {
  adapter: CultureDiscoveryAdapter;
  locale: CultureLocale;
}

export function CultureDiscovery({ adapter, locale }: CultureDiscoveryProps) {
  const copy = COPY[locale];
  const dir = directionOf(locale);
  const headingId = useId();
  const feed = useCultureFeed(adapter);
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrollPosition = useRef<number | null>(null);
  const surpriseIndex = useRef(0);

  const openEntry = useCallback((entry: CultureIndexEntry) => {
    scrollPosition.current = typeof window === "undefined" ? 0 : window.scrollY;
    setActiveId(entry.id);
  }, []);

  const openById = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const closeReading = useCallback(() => {
    setActiveId(null);
    const previous = scrollPosition.current;
    scrollPosition.current = null;
    // The reading dialog is unmounted by the same commit; restoring in the handler keeps
    // the page exactly where the person left it, with no visible jump.
    if (previous !== null && typeof window !== "undefined") window.scrollTo(0, previous);
  }, []);

  const toggleSaved = useCallback(
    (id: string) => {
      feed.toggleSaved(id);
    },
    [feed],
  );

  const featuredVisible = !feed.savedOnly && !feed.filtersActive && feed.featured !== null;
  const featuredId = featuredVisible ? feed.featured?.id : undefined;
  const feedEntries = useMemo(
    () => feed.entries.filter((entry) => entry.id !== featuredId),
    [feed.entries, featuredId],
  );

  const anotherDiscovery = useCallback(() => {
    const pool = feed.entries.filter((entry) => entry.id !== featuredId);
    if (pool.length === 0) {
      if (feed.featured) openEntry(feed.featured);
      return;
    }
    const entry = pool[surpriseIndex.current % pool.length];
    surpriseIndex.current += 1;
    if (entry) openEntry(entry);
  }, [feed.entries, feed.featured, featuredId, openEntry]);

  const activeSaved = activeId ? feed.isSaved(activeId) : false;

  return (
    <section
      dir={dir}
      aria-labelledby={headingId}
      data-culture-section
      data-state={feed.status}
      data-saved-view={feed.savedOnly ? "true" : "false"}
      className="mx-auto w-full max-w-[764px] px-4 pb-10 pt-8 sm:px-6"
    >
      <header className="border-t border-foreground/25 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[10.5px] uppercase tracking-[0.18em] text-signal-text">
            {copy.sectionLabel}
          </p>
          <p className="text-[10.5px] uppercase tracking-[0.12em] text-faint">
            {copy.featuredLabel}
          </p>
        </div>
        <h2
          id={headingId}
          className="mt-4 max-w-[22ch] text-balance font-display text-[clamp(1.7rem,4.6vw,2.6rem)] font-medium leading-[1.12] tracking-[-0.025em] text-foreground"
        >
          {copy.feedLabel}
        </h2>
        <p className="mt-4 max-w-[58ch] text-[16px] leading-[1.7] text-muted-foreground">
          {copy.intro}
        </p>
        <p className="mt-3 max-w-[56ch] text-[12.5px] italic leading-[1.6] text-faint">
          {copy.standfirst}
        </p>
      </header>

      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3">
        <button
          type="button"
          data-culture-another
          onClick={anotherDiscovery}
          className="press-soft group/another inline-flex min-h-9 items-center gap-2 text-[12px] font-medium uppercase tracking-[0.12em] text-signal-text"
        >
          <span
            aria-hidden="true"
            className="inline-block transition-transform duration-200 group-hover/another:rotate-45"
          >
            ✦
          </span>
          {copy.anotherDiscovery}
        </button>
        {feed.status === "ready" && feed.total > 0 ? (
          <p className="text-[10.5px] uppercase tracking-[0.12em] text-faint tabular-nums">
            {feed.total}
          </p>
        ) : null}
      </div>

      {featuredVisible && feed.featured ? (
        <div data-culture-featured className="mt-6">
          <FeatureComposition
            entry={feed.featured}
            locale={locale}
            saved={feed.isSaved(feed.featured.id)}
            onOpen={openEntry}
            onToggleSaved={toggleSaved}
          />
        </div>
      ) : null}

      <CultureFilters
        locale={locale}
        facets={feed.facets}
        savedOnly={feed.savedOnly}
        savedCount={feed.savedIds.size}
        search={feed.search}
        searchPending={feed.searchPending}
        category={feed.category}
        continent={feed.continent}
        country={feed.country}
        contentType={feed.contentType}
        language={feed.language}
        filtersActive={feed.filtersActive}
        onSearch={feed.setSearch}
        onCategory={feed.setCategory}
        onContinent={feed.setContinent}
        onCountry={feed.setCountry}
        onContentType={feed.setContentType}
        onLanguage={feed.setLanguage}
        onSavedOnly={feed.setSavedOnly}
        onClear={feed.clearFilters}
      />

      <div className="mt-10 flex items-baseline justify-between gap-4 border-b border-foreground/25 pb-2">
        <h3 className="text-[10.5px] uppercase tracking-[0.18em] text-foreground">
          {feed.savedOnly ? copy.savedView : copy.feedLabel}
        </h3>
        {feed.savedOnly ? (
          <p className="text-[10.5px] uppercase tracking-[0.1em] text-faint">
            {copy.savedOnDevice}
          </p>
        ) : null}
      </div>

      <div className="mt-6" aria-live="polite">
        {feed.status === "loading" ? <CultureLoading locale={locale} /> : null}
        {feed.status === "error" ||
        feed.status === "offline" ||
        feed.status === "catalog-unavailable" ? (
          <CultureFailure locale={locale} kind={feed.status} onRetry={feed.retry} />
        ) : null}
        {feed.status === "empty" ? (
          <CultureEmpty
            locale={locale}
            filtered={feed.filtersActive}
            savedOnly={feed.savedOnly}
            onClear={feed.clearFilters}
          />
        ) : null}
        {feed.status === "ready" ? (
          <div data-culture-feed className="space-y-8">
            {feedEntries.map((entry) => (
              <CultureCard
                key={entry.id}
                entry={entry}
                locale={locale}
                saved={feed.isSaved(entry.id)}
                onOpen={openEntry}
                onToggleSaved={toggleSaved}
              />
            ))}
          </div>
        ) : null}
      </div>

      {feed.status === "ready" && !feed.savedOnly ? (
        <div className="mt-8">
          {feed.moreError ? (
            <div data-culture-more-error className="flex flex-wrap items-baseline gap-3">
              <p className="text-[12px] leading-relaxed text-muted-foreground">{copy.errorBody}</p>
              <button
                type="button"
                onClick={feed.loadMore}
                className="press-soft min-h-9 text-[11px] font-medium uppercase tracking-[0.12em] text-signal-text"
              >
                {copy.retry}
              </button>
            </div>
          ) : feed.canLoadMore || feed.cooldown ? (
            <button
              type="button"
              data-culture-more
              onClick={feed.loadMore}
              disabled={!feed.canLoadMore}
              aria-busy={feed.loadingMore || undefined}
              className="press-soft inline-flex min-h-11 items-center gap-2 border-b border-current pb-1 text-[12px] font-medium uppercase tracking-[0.12em] text-foreground disabled:cursor-default disabled:border-transparent disabled:text-faint"
            >
              {feed.loadingMore ? copy.loadingMore : copy.more}
              <span aria-hidden="true" className="text-[13px]">
                ↓
              </span>
            </button>
          ) : feed.pageCount > 0 ? (
            <CultureEndNote locale={locale} />
          ) : null}
        </div>
      ) : null}

      {activeId ? (
        <CultureReading
          adapter={adapter}
          id={activeId}
          locale={locale}
          saved={activeSaved}
          onClose={closeReading}
          onOpenRelated={openById}
          onToggleSaved={toggleSaved}
        />
      ) : null}
    </section>
  );
}
