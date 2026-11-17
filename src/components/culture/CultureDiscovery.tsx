import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CultureLocale } from "@/lib/culture/types";
import type { CultureDiscoveryProps, CultureListEntry } from "./contract";
import { cultureCopy } from "./copy";
import {
  DEFAULT_PAGE_SIZE,
  useCultureFeed,
  useFacets,
  useFeatured,
  useIsOnline,
  useSavedCulture,
} from "./useDiscovery";
import { compositionFor, isWideComposition } from "./compositions";
import { CultureCard } from "./CultureCard";
import { CultureFeatured } from "./CultureFeatured";
import { CultureControls } from "./CultureControls";
import { CalmNotice, FeedSkeleton, FeaturedSkeleton, MoreErrorNotice } from "./CultureStates";
import { CultureDetail } from "./CultureDetail";
import { localized } from "./format";

const SAVED_STEP = 24;

function matchesLocal(entry: CultureListEntry, query: string): boolean {
  if (!query) return true;
  const haystack = [
    entry.title.en,
    entry.title.ar,
    entry.title.de,
    entry.titleOriginal ?? "",
    entry.category,
    entry.continent,
    ...entry.countries,
    ...entry.tags,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * The discovery section that lives below the translator.
 *
 * Reading order: a quiet introduction, one editorial feature, a search/filter surface, then
 * a mixed feed of genuinely different card compositions. The initial paint is small; more
 * arrives through an explicit control, with an IntersectionObserver that only nudges it —
 * guarded by an in-flight flag, a cooldown and a cap on automatic pages, so no scroll
 * position can start an endless request chain. Opening a record puts it in a dialog; closing
 * restores both focus (through useFocusTrap) and the exact scroll position.
 */
export function CultureDiscovery({
  adapter,
  locale,
  pageSize = DEFAULT_PAGE_SIZE,
  className,
}: CultureDiscoveryProps) {
  const copy = cultureCopy(locale);
  const headingId = useId();
  const feed = useCultureFeed(adapter, pageSize);
  const facets = useFacets(adapter);
  const featured = useFeatured(adapter);
  const saved = useSavedCulture(adapter.saved);
  const online = useIsOnline(adapter);

  const [view, setView] = useState<"discover" | "saved">("discover");
  const [savedLimit, setSavedLimit] = useState(SAVED_STEP);
  const [openId, setOpenId] = useState<string | null>(null);
  const scrollRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pushedEntry = useRef(false);
  const popping = useRef(false);
  const toggleSaved = saved.toggle;

  const query = feed.search.trim().toLowerCase();
  const savedEntries = saved.entries;
  const visibleSaved = useMemo(
    () => savedEntries.filter((entry) => matchesLocal(entry, query)),
    [savedEntries, query],
  );
  const shownSaved = useMemo(() => visibleSaved.slice(0, savedLimit), [visibleSaved, savedLimit]);

  const changeView = useCallback((next: "discover" | "saved") => {
    setView(next);
    setSavedLimit(SAVED_STEP);
  }, []);

  const openRecord = useCallback((entry: CultureListEntry) => {
    if (typeof window !== "undefined") scrollRef.current = window.scrollY;
    setOpenId(entry.id);
  }, []);

  /**
   * Closing also removes the reading's own history entry, so the browser's back gesture after
   * a reading does not reopen it. Related records replace the content without a new entry.
   */
  const closeRecord = useCallback(() => {
    if (pushedEntry.current) {
      pushedEntry.current = false;
      popping.current = true;
      window.history.back();
    }
    setOpenId(null);
  }, []);

  const openRelated = useCallback((entry: CultureListEntry) => {
    setOpenId(entry.id);
  }, []);

  // Closing the reading puts the person back exactly where they were, not at the top.
  useEffect(() => {
    if (openId !== null) return;
    const y = scrollRef.current;
    if (!y) return;
    scrollRef.current = 0;
    window.scrollTo(0, y);
  }, [openId]);

  // One history entry for the whole reading (including related records). Browser/Android
  // back closes it instead of leaving the translator; the entry is popped when it closes.
  useEffect(() => {
    if (openId === null || typeof window === "undefined") return undefined;
    if (!pushedEntry.current) {
      const current =
        window.history.state && typeof window.history.state === "object"
          ? (window.history.state as Record<string, unknown>)
          : {};
      window.history.pushState({ ...current, cultureDetail: true }, "");
      pushedEntry.current = true;
    }
    const onPopState = () => {
      if (popping.current) {
        popping.current = false;
        return;
      }
      if (!pushedEntry.current) return;
      pushedEntry.current = false;
      setOpenId(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [openId]);

  // The observer only nudges the feed; every guard lives in the hook.
  const { canLoadMore, loadMore: loadMorePage } = feed;
  useEffect(() => {
    if (view !== "discover" || !canLoadMore) return undefined;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((item) => item.isIntersecting)) loadMorePage(true);
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadMore, loadMorePage, view]);

  const savedCount = saved.ids.size;

  return (
    <>
      <section
        dir={locale === "ar" ? "rtl" : "ltr"}
        lang={locale}
        aria-labelledby={headingId}
        className={"w-full border-t border-border px-4 pb-16 pt-9 sm:px-6 " + (className ?? "")}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <header className="flex flex-col gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-faint">
              {copy.sectionLabel}
            </p>
            <h2 id={headingId} className="sr-only">
              {copy.feedLabel}
            </h2>
            <p className="max-w-[54ch] text-[clamp(17px,2.4vw,21px)] font-medium leading-relaxed text-foreground">
              {copy.introLine}
            </p>
          </header>

          {featured.status === "loading" ? <FeaturedSkeleton /> : null}
          {featured.status === "ready" && featured.item ? (
            <CultureFeatured
              entry={featured.item}
              locale={locale}
              copy={copy}
              saved={saved.ids.has(featured.item.id)}
              onOpen={openRecord}
              onToggleSaved={toggleSaved}
            />
          ) : null}

          <CultureControls
            feed={feed}
            facets={facets}
            copy={copy}
            locale={locale}
            view={view}
            savedCount={savedCount}
            onViewChange={changeView}
          />

          {view === "saved" ? (
            <div aria-busy={false}>
              {shownSaved.length === 0 ? (
                <CalmNotice
                  locale={locale}
                  title={query ? copy.empty : savedCount > 0 ? copy.savedUncached : copy.savedEmpty}
                />
              ) : (
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {shownSaved.map((entry) => (
                    <li
                      key={entry.id}
                      className={
                        isWideComposition(compositionFor(entry.category)) ? "sm:col-span-2" : ""
                      }
                    >
                      <CultureCard
                        entry={entry}
                        locale={locale}
                        copy={copy}
                        saved={saved.ids.has(entry.id)}
                        onOpen={openRecord}
                        onToggleSaved={toggleSaved}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {visibleSaved.length > shownSaved.length ? (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setSavedLimit((limit) => limit + SAVED_STEP)}
                    className="press min-h-11 rounded-full border border-border px-5 text-[13.5px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {copy.more}
                  </button>
                </div>
              ) : null}
            </div>
          ) : feed.status === "loading" ? (
            <FeedSkeleton locale={locale} copy={copy} />
          ) : feed.status === "error" ? (
            <CalmNotice
              locale={locale}
              tone={feed.error === "offline" ? "offline" : "quiet"}
              title={feed.error === "offline" ? copy.offlineTitle : copy.errorTitle}
              body={feed.error === "offline" ? copy.offlineBody : copy.errorBody}
              actionLabel={copy.retry}
              onAction={feed.retry}
            />
          ) : feed.entries.length === 0 ? (
            <CalmNotice
              locale={locale}
              title={copy.empty}
              actionLabel={feed.activeFilters ? copy.clearFilters : undefined}
              onAction={feed.activeFilters ? feed.clearFilters : undefined}
            />
          ) : (
            <div>
              {!online ? (
                <p
                  role="status"
                  className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground"
                >
                  {copy.offlineBody}
                </p>
              ) : null}
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {feed.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className={
                      isWideComposition(compositionFor(entry.category)) ? "sm:col-span-2" : ""
                    }
                  >
                    <CultureCard
                      entry={entry}
                      locale={locale}
                      copy={copy}
                      saved={saved.ids.has(entry.id)}
                      onOpen={openRecord}
                      onToggleSaved={toggleSaved}
                    />
                  </li>
                ))}
              </ul>

              {feed.canLoadMore ? (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <div ref={sentinelRef} aria-hidden className="h-px w-full" />
                  <button
                    type="button"
                    onClick={() => feed.loadMore(false)}
                    disabled={feed.loadingMore}
                    aria-busy={feed.loadingMore}
                    className="press min-h-11 rounded-full border border-border px-5 text-[13.5px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {feed.loadingMore ? copy.loadingMore : copy.more}
                  </button>
                  {feed.moreError ? (
                    <MoreErrorNotice
                      message={feed.moreError === "offline" ? copy.offlineTitle : copy.errorTitle}
                      retryLabel={copy.retry}
                      onRetry={feed.retry}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {openId ? (
        <CultureDetail
          key={openId}
          adapter={adapter}
          itemId={openId}
          locale={locale}
          copy={copy}
          online={online}
          saved={saved.ids.has(openId)}
          onToggleSaved={() => toggleSaved(openId)}
          onClose={closeRecord}
          onOpenRelated={openRelated}
        />
      ) : null}
    </>
  );
}
