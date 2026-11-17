import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { useWeather } from "@/lib/weather/useWeather";
import { useWeatherLocation } from "@/lib/weather/useWeatherLocation";
import { WeatherCityPicker } from "./WeatherCityPicker";
import { WeatherStrip } from "./WeatherStrip";
import { COPY } from "./copy";

/**
 * The weather module as it sits in the product: a compact strip under the translator and
 * an explicit place picker. It owns its two quiet hooks; the route only supplies the
 * interface language and whether the composer is busy (so a refresh never competes with
 * the sentence someone is typing).
 */
export function WeatherSection({ locale, paused }: { locale: Locale; paused: boolean }) {
  const location = useWeatherLocation({ language: locale });
  const weather = useWeather({
    place: location.place,
    language: locale,
    deferRefresh: paused,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const rtl = locale === "ar";

  return (
    <section dir={rtl ? "rtl" : "ltr"} aria-label={COPY[locale].title} className="shrink-0">
      <WeatherStrip
        locale={locale}
        units={weather.units}
        forecast={{
          snapshot: weather.snapshot,
          status: weather.status,
          freshness: weather.freshness,
          offline: weather.offline,
          refreshing: weather.refreshing,
          // A cancelled in-flight request is not a failure to show; the strip has no
          // stale error to report in that case.
          error: weather.error === "cancelled" ? null : weather.error,
        }}
        location={{
          status: location.status,
          pending: location.pending,
          canEnable: location.canEnable,
          reason: location.reason,
        }}
        onRefresh={weather.refresh}
        onEnableLocation={() => {
          void location.enableLocation();
        }}
        onChooseCity={() => setPickerOpen(true)}
        onUnitsChange={weather.setUnits}
      />
      {pickerOpen ? (
        <WeatherCityPicker
          open
          locale={locale}
          location={location}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </section>
  );
}
