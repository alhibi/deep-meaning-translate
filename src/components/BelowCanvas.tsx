import { lazy, Suspense } from "react";
import type { Locale } from "@/lib/i18n";
import { SHOW_CULTURE, SHOW_WEATHER } from "@/lib/features";
import { DeferredMount } from "./DeferredMount";

/**
 * The continued surfaces below the translator canvas.
 *
 * In this release both product switches are off, so this composition renders nothing:
 * the translator stays one screen and no weather/location request or discovery chunk is
 * ever reached. The sections keep their lazy, deferred, below-the-fold composition for
 * the day the switch is turned back on; hiding them is not deleting them.
 */
const WeatherSection = lazy(() =>
  import("@/components/weather/WeatherSection").then((m) => ({ default: m.WeatherSection })),
);
const CultureSection = lazy(() =>
  import("@/components/culture/CultureSection").then((m) => ({ default: m.CultureSection })),
);

export function BelowCanvas({
  locale,
  paused,
  showWeather = SHOW_WEATHER,
  showCulture = SHOW_CULTURE,
}: {
  locale: Locale;
  /** The composer is busy: the weather strip must not refresh while a sentence is in flight. */
  paused: boolean;
  /** Overridable so the regression test can prove both the shipped and the restored state. */
  showWeather?: boolean;
  showCulture?: boolean;
}) {
  if (!showWeather && !showCulture) return null;
  return (
    <>
      {showWeather ? (
        <DeferredMount
          placeholder={
            <div className="mx-3 h-[95px] shrink-0" aria-hidden data-weather-placeholder="true" />
          }
        >
          <Suspense fallback={<div className="mx-3 h-[95px] shrink-0" aria-hidden />}>
            <WeatherSection locale={locale} paused={paused} />
          </Suspense>
        </DeferredMount>
      ) : null}
      {showCulture ? (
        <DeferredMount>
          <Suspense fallback={<div className="min-h-px" aria-hidden />}>
            <CultureSection locale={locale} />
          </Suspense>
        </DeferredMount>
      ) : null}
    </>
  );
}
