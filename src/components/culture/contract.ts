import type { CultureLocale } from "@/lib/culture/types";
import type { CultureDiscoveryAdapter } from "@/lib/culture/adapter";

/**
 * Component-side contract for the discovery section.
 *
 * The data interfaces live in src/lib/culture/adapter.ts — one definition that the engine
 * implements and the UI consumes (lib <- components, never the reverse). They are re-exported
 * here so component code has a single local import path, and CultureDiscoveryProps stays
 * beside the component that owns it.
 */
export type {
  CultureDetailItem,
  CultureDiscoveryAdapter,
  CultureFacetOption,
  CultureFacets,
  CultureListEntry,
  CultureListPage,
  CulturePageQuery,
  CultureSavedPort,
} from "@/lib/culture/adapter";

/** Props the translator route passes to the section. Nothing else is required. */
export interface CultureDiscoveryProps {
  adapter: CultureDiscoveryAdapter;
  /** Interface language: copy, number/place names and layout direction follow it. */
  locale: CultureLocale;
  /** Cards per page (first paint stays small). Default 8. */
  pageSize?: number | undefined;
  className?: string | undefined;
}
