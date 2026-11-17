import type { CultureFacets } from "@/lib/culture/adapter";
import type {
  CultureCategory,
  CultureContentType,
  CultureContinent,
  CultureLocale,
} from "@/lib/culture/types";
import { COPY } from "./copy";
import { LANGUAGE_NAMES } from "./format";
import { ALL_CATEGORIES, CONTINENTS, CONTENT_TYPES } from "./useDiscovery";

/**
 * The reading controls, not a form panel: one search line and a row of typographic
 * selectors. Nothing is a pill and nothing floats above the page — the controls read as
 * part of the index. Native selects keep the keyboard and screen-reader behaviour that a
 * custom menu would have to re-earn.
 */

function optionsOf<T extends string>(
  values: readonly T[],
  label: (value: T) => string,
  counts?: readonly { value: T; count: number }[],
): { value: T; label: string }[] {
  const countByValue = new Map((counts ?? []).map((facet) => [facet.value, facet.count]));
  return values.map((value) => {
    const count = countByValue.get(value);
    return {
      value,
      label: count && count > 0 ? label(value) + " · " + count : label(value),
    };
  });
}

function SelectControl<T extends string>({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  allLabel: string;
  options: readonly { value: T; label: string }[];
  onChange(value: T | undefined): void;
}) {
  return (
    <label className="group relative flex min-w-0 flex-col gap-1 border-b border-border pb-1.5 focus-within:border-signal-text">
      <span className="text-[10px] uppercase tracking-[0.12em] text-faint">{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next ? (next as T) : undefined);
        }}
        className="min-h-7 w-full cursor-pointer appearance-none bg-transparent pe-4 text-[13px] text-foreground outline-none"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2 end-0 text-[9px] text-faint"
      >
        ▾
      </span>
    </label>
  );
}

export interface CultureFiltersProps {
  locale: CultureLocale;
  facets: CultureFacets | null;
  savedOnly: boolean;
  savedCount: number;
  search: string;
  searchPending: boolean;
  category: CultureCategory | undefined;
  continent: CultureContinent | undefined;
  country: string | undefined;
  contentType: CultureContentType | undefined;
  language: CultureLocale | undefined;
  filtersActive: boolean;
  onSearch(value: string): void;
  onCategory(value: CultureCategory | undefined): void;
  onContinent(value: CultureContinent | undefined): void;
  onCountry(value: string | undefined): void;
  onContentType(value: CultureContentType | undefined): void;
  onLanguage(value: CultureLocale | undefined): void;
  onSavedOnly(value: boolean): void;
  onClear(): void;
}

export function CultureFilters(props: CultureFiltersProps) {
  const { locale, facets } = props;
  const copy = COPY[locale];
  const categories = optionsOf(
    facets?.categories.map((facet) => facet.value) ?? ALL_CATEGORIES,
    (value) => copy.categories[value],
    facets?.categories,
  );
  const continents = optionsOf(
    facets?.continents.map((facet) => facet.value) ?? CONTINENTS,
    (value) => copy.continents[value],
    facets?.continents,
  );
  const countries = optionsOf(
    facets?.countries.map((facet) => facet.value) ?? [],
    (value) => value,
    facets?.countries,
  );
  const types = optionsOf(
    facets?.types.map((facet) => facet.value) ?? CONTENT_TYPES,
    (value) => copy.types[value],
    facets?.types,
  );

  return (
    <div data-culture-filters className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-[10.5px] uppercase tracking-[0.14em] text-faint">{copy.filtersLabel}</p>
        <div
          role="group"
          aria-label={copy.feedLabel}
          className="flex items-baseline gap-4 text-[11px] uppercase tracking-[0.1em]"
        >
          <button
            type="button"
            data-culture-view="all"
            aria-pressed={!props.savedOnly}
            onClick={() => props.onSavedOnly(false)}
            className={
              "press-soft min-h-7 border-b pb-0.5 " +
              (!props.savedOnly
                ? "border-foreground text-foreground"
                : "border-transparent text-faint hover:text-foreground")
            }
          >
            {copy.allView}
          </button>
          <button
            type="button"
            data-culture-view="saved"
            aria-pressed={props.savedOnly}
            onClick={() => props.onSavedOnly(true)}
            className={
              "press-soft min-h-7 border-b pb-0.5 " +
              (props.savedOnly
                ? "border-foreground text-foreground"
                : "border-transparent text-faint hover:text-foreground")
            }
          >
            {copy.savedView}
            {props.savedCount > 0 ? (
              <span className="ms-1 tabular-nums text-faint">{props.savedCount}</span>
            ) : null}
          </button>
        </div>
      </div>

      <label className="mt-4 flex items-baseline gap-3 border-b border-border pb-2 focus-within:border-signal-text">
        <span className="sr-only">{copy.searchLabel}</span>
        <span aria-hidden="true" className="text-[15px] text-faint">
          ⌕
        </span>
        <input
          type="search"
          value={props.search}
          onChange={(event) => props.onSearch(event.target.value)}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchLabel}
          data-culture-search
          className="min-h-8 w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-faint"
        />
        {props.searchPending ? (
          <span
            aria-live="polite"
            className="shrink-0 text-[10.5px] uppercase tracking-[0.1em] text-faint"
          >
            {copy.searching}
          </span>
        ) : null}
        {props.savedOnly ? (
          <span className="shrink-0 text-[10.5px] uppercase tracking-[0.1em] text-faint">
            {copy.savedOnDevice}
          </span>
        ) : null}
      </label>

      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        <SelectControl
          label={copy.filterCategory}
          value={props.category}
          allLabel={copy.allCategories}
          options={categories}
          onChange={props.onCategory}
        />
        <SelectControl
          label={copy.filterContinent}
          value={props.continent}
          allLabel={copy.allContinents}
          options={continents}
          onChange={props.onContinent}
        />
        {countries.length > 0 ? (
          <SelectControl
            label={copy.filterCountry}
            value={props.country}
            allLabel={copy.allCountries}
            options={countries}
            onChange={props.onCountry}
          />
        ) : null}
        <SelectControl
          label={copy.filterType}
          value={props.contentType}
          allLabel={copy.allTypes}
          options={types}
          onChange={props.onContentType}
        />
        <SelectControl
          label={copy.filterLanguage}
          value={props.language}
          allLabel={copy.allLanguages}
          options={(Object.keys(LANGUAGE_NAMES) as CultureLocale[]).map((value) => ({
            value,
            label: LANGUAGE_NAMES[value],
          }))}
          onChange={props.onLanguage}
        />
        {props.filtersActive ? (
          <button
            type="button"
            data-culture-clear
            onClick={props.onClear}
            className="press-soft min-h-9 justify-self-start self-end border-b border-transparent pb-0.5 text-start text-[11px] font-medium uppercase tracking-[0.1em] text-signal-text hover:border-current"
          >
            {copy.clearFilters}
          </button>
        ) : null}
      </div>
    </div>
  );
}
