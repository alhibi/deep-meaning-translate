import { useId, useMemo } from "react";
import { Search } from "lucide-react";
import {
  CULTURE_CATEGORIES,
  type CultureCategory,
  type CultureContinent,
  type CultureLocale,
} from "@/lib/culture/types";
import type { CultureFacets } from "./contract";
import type { CultureCopy } from "./copy";
import type { CultureFeed } from "./useDiscovery";
import { countryName, formatCount } from "./format";

const ALL_CONTINENTS: CultureContinent[] = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];

const SELECT_CLASS =
  "h-11 min-w-0 w-full rounded-xl border border-border bg-card px-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function FieldLabel({ children, htmlFor }: { children: string; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="text-[11px] leading-none text-faint">
      {children}
    </label>
  );
}

/**
 * The compact filter surface: one search field, three native selects, one saved view.
 *
 * Search is debounced by the feed hook before it becomes a query, so holding a key down
 * cannot turn into a request per character. Options come from the index facets when they
 * are available and from the built-in category/continent lists otherwise — a failed facet
 * read must never leave the person with an unusable filter.
 */
export function CultureControls({
  feed,
  facets,
  copy,
  locale,
  view,
  savedCount,
  onViewChange,
}: {
  feed: CultureFeed;
  facets: CultureFacets | null;
  copy: CultureCopy;
  locale: CultureLocale;
  view: "discover" | "saved";
  savedCount: number;
  onViewChange: (view: "discover" | "saved") => void;
}) {
  const countries = useMemo(() => {
    if (facets && facets.countries.length) return facets.countries;
    const seen = new Map<string, string>();
    for (const entry of feed.entries) {
      for (const code of entry.countries) {
        if (!seen.has(code)) seen.set(code, code);
      }
    }
    return [...seen.values()].map((value) => ({ value, count: 0 }));
  }, [facets, feed.entries]);

  const categories = useMemo(() => {
    if (facets && facets.categories.length) return facets.categories;
    return CULTURE_CATEGORIES.map((value) => ({ value, count: 0 }));
  }, [facets]);

  const continents = useMemo(() => {
    if (facets && facets.continents.length) return facets.continents;
    return ALL_CONTINENTS.map((value) => ({ value, count: 0 }));
  }, [facets]);

  const countSuffix = (count: number) => (count > 0 ? " · " + formatCount(count, locale) : "");
  const fieldId = useId();
  const categoryId = fieldId + "-category";
  const continentId = fieldId + "-continent";
  const countryId = fieldId + "-country";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-card px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <Search aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
          <span className="sr-only">{copy.searchLabel}</span>
          <input
            type="search"
            value={feed.search}
            onChange={(event) => feed.setSearch(event.target.value)}
            placeholder={copy.searchPlaceholder}
            aria-label={copy.searchLabel}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-faint"
          />
        </label>
        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-card p-1">
          <button
            type="button"
            aria-pressed={view === "discover"}
            onClick={() => onViewChange("discover")}
            className={
              "press-soft min-h-11 rounded-lg px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (view === "discover"
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground")
            }
          >
            {copy.allItems}
          </button>
          <button
            type="button"
            aria-pressed={view === "saved"}
            onClick={() => onViewChange("saved")}
            className={
              "press-soft min-h-11 rounded-lg px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (view === "saved" ? "bg-muted font-medium text-foreground" : "text-muted-foreground")
            }
          >
            {copy.savedView}
            {savedCount > 0 ? (
              <span className="ms-1.5 tabular-nums text-faint">
                {formatCount(savedCount, locale)}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {view === "discover" ? (
        <div role="group" aria-label={copy.filtersLabel} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={categoryId}>{copy.filterCategory}</FieldLabel>
              <select
                id={categoryId}
                value={feed.category ?? ""}
                onChange={(event) =>
                  feed.setCategory((event.target.value || undefined) as CultureCategory | undefined)
                }
                className={SELECT_CLASS}
              >
                <option value="">{copy.allCategories}</option>
                {categories.map((option) => (
                  <option key={option.value} value={option.value}>
                    {copy.categories[option.value]}
                    {countSuffix(option.count)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={continentId}>{copy.filterContinent}</FieldLabel>
              <select
                id={continentId}
                value={feed.continent ?? ""}
                onChange={(event) =>
                  feed.setContinent(
                    (event.target.value || undefined) as CultureContinent | undefined,
                  )
                }
                className={SELECT_CLASS}
              >
                <option value="">{copy.allContinents}</option>
                {continents.map((option) => (
                  <option key={option.value} value={option.value}>
                    {copy.continents[option.value]}
                    {countSuffix(option.count)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={countryId}>{copy.filterCountry}</FieldLabel>
              <select
                id={countryId}
                value={feed.country ?? ""}
                onChange={(event) => feed.setCountry(event.target.value || undefined)}
                className={SELECT_CLASS}
              >
                <option value="">{copy.allCountries}</option>
                {countries.map((option) => (
                  <option key={option.value} value={option.value}>
                    {countryName(option.value, locale)}
                    {countSuffix(option.count)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {feed.activeFilters ? (
            <div>
              <button
                type="button"
                onClick={feed.clearFilters}
                className="press-soft min-h-11 rounded-full px-3 text-[12.5px] text-muted-foreground underline decoration-border underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copy.clearFilters}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{copy.savedOnDevice}</p>
      )}
    </div>
  );
}
