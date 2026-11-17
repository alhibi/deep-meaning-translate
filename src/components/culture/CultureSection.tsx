import { useMemo } from "react";
import { createCultureDiscoveryAdapter, type CultureDiscoveryAdapter } from "@/lib/culture/adapter";
import type { CultureLocale } from "@/lib/culture/types";
import { useTodayKey } from "@/lib/useTodayKey";
import { CultureDiscovery } from "./CultureDiscovery";

/**
 * The route's only entry to the library.
 *
 * The route keeps owning placement and supplies the interface language; the section owns
 * its production adapter so an existing
 *   <CultureSection locale={locale} />
 * call keeps working unchanged. Tests and future owners can inject another adapter; a new
 * adapter identity is treated as a new catalogue by the feed hook.
 */
export function CultureSection({
  locale,
  adapter,
}: {
  locale: CultureLocale;
  adapter?: CultureDiscoveryAdapter;
}) {
  const day = useTodayKey();
  const production = useMemo(
    () => (adapter ? null : createCultureDiscoveryAdapter({ dayKey: () => day })),
    [adapter, day],
  );
  const active = adapter ?? production;
  if (!active) return null;
  return <CultureDiscovery adapter={active} locale={locale} />;
}
