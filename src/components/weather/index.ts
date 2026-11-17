export { WeatherStrip } from "./WeatherStrip";
export { WeatherSheet } from "./WeatherSheet";
export { COPY } from "./copy";
export type {
  WeatherErrorKind,
  WeatherForecastView,
  WeatherFreshnessView,
  WeatherLocationReason,
  WeatherLocationStatus,
  WeatherLocationView,
  WeatherPending,
  WeatherSheetProps,
  WeatherStatus,
  WeatherStripProps,
  WeatherSurface,
} from "./state";

/**
 * Integration contract (the route owns the wiring; this module owns rendering).
 *
 * A06 supplies `useWeather()`: { snapshot, status, freshness, offline, refreshing, error,
 * units, setUnits, refresh }. A05 supplies the location layer: { status, pending, canEnable,
 * reason, enableLocation, ... } plus its own city picker, which the route opens from
 * `onChooseCity`. Map them one-to-one:
 *
 *   const weather = useWeather({ place: location.place, language: locale });
 *   <WeatherStrip
 *     locale={locale}
 *     units={weather.units}
 *     forecast={{
 *       snapshot: weather.snapshot,
 *       status: weather.status,
 *       freshness: weather.freshness,
 *       offline: weather.offline,
 *       refreshing: weather.refreshing,
 *       error: weather.error,
 *     }}
 *     location={{
 *       status: location.status,
 *       pending: location.pending,
 *       canEnable: location.canEnable,
 *       reason: location.reason,
 *     }}
 *     onRefresh={weather.refresh}
 *     onEnableLocation={() => void location.enableLocation()}
 *     onChooseCity={openCityPicker}
 *     onUnitsChange={weather.setUnits}
 *   />
 *
 * The strip renders the no-place invitation itself, so it must stay mounted when
 * `location.place === null`; `useWeather` may be idle in that case. It never requests a
 * location on mount — only the person's tap on "Use my location" does.
 */
