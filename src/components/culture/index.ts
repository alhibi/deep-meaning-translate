/**
 * Public surface of the cultural-discovery section (A11).
 *
 * Integrate in the translator route below the workspace:
 *   <CultureDiscovery adapter={adapter} locale={locale} />
 * where `adapter = createCultureDiscoveryAdapter({ dayKey: () => todayKey })` is created once
 * (module scope or a useMemo with no changing dependency) and `locale` is the active
 * interface locale. The section owns its copy, states and dialog; the route owns placement,
 * spacing (via className) and the adapter's construction.
 */
export { CultureDiscovery } from "./CultureDiscovery";
export { COPY, cultureCopy } from "./copy";
export type { CultureCopy } from "./copy";
export type {
  CultureDetailItem,
  CultureDiscoveryAdapter,
  CultureDiscoveryProps,
  CultureFacetOption,
  CultureFacets,
  CultureListEntry,
  CultureListPage,
  CulturePageQuery,
  CultureSavedPort,
} from "./contract";
export { createCultureDiscoveryAdapter } from "@/lib/culture/adapter";
export type { CultureAdapterOptions } from "@/lib/culture/adapter";
export {
  AUTO_PAGE_LIMIT,
  DEFAULT_PAGE_SIZE,
  MORE_COOLDOWN_MS,
  SEARCH_DEBOUNCE_MS,
} from "./useDiscovery";
