import { useMemo } from "react";
import { createCultureDiscoveryAdapter } from "@/lib/culture/adapter";
import type { CultureLocale } from "@/lib/culture/types";
import { useTodayKey } from "@/lib/useTodayKey";
import { CultureDiscovery } from "./CultureDiscovery";

/**
 * The discovery section below the translator: a naturally continuing page, not an overlay
 * and not a feed that competes with the sentence above it. The catalog is loaded lazily by
 * the adapter, the route only supplies the interface language.
 */
export function CultureSection({ locale }: { locale: CultureLocale }) {
  const day = useTodayKey();
  const adapter = useMemo(() => createCultureDiscoveryAdapter({ dayKey: () => day }), [day]);
  return <CultureDiscovery adapter={adapter} locale={locale} />;
}
