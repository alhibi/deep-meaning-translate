import { useCallback, useState } from "react";
import { COPY, fill } from "./copy";
import type { WeatherStripProps } from "./state";
import { resolveWeatherSurface } from "./state";
import { buildReadout, locationMessage } from "./view";
import { WeatherGlyph } from "./WeatherGlyph";
import { WeatherSheet } from "./WeatherSheet";

/**
 * Compact weather strip: a content-driven readout, not a dashboard card.
 *
 * Height budget (logical px, fixed rows so a state change cannot move the page):
 *   shell padding 2 × 10  +  main row 34  +  gap 4  +  meta row 16  +  gap 4  +  rail row 17
 * = 95 px; 74 px when the hourly rail is hidden at < 380 px. Nothing depends on measurement,
 * `ResizeObserver`, inline height or a transition, so loading → ready never reflows.
 *
 * The forecast area is one button that opens the expanded dialog; the rail row carries the
 * provider attribution link, because a link cannot legally live inside a button.
 */
export function WeatherStrip(props: WeatherStripProps) {
  const { locale, forecast, location, units } = props;
  const copy = COPY[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const [open, setOpen] = useState(props.defaultOpen === true);
  const close = useCallback(() => setOpen(false), []);
  const surface = resolveWeatherSurface({ forecast, location });

  const showForecast = surface.kind === "forecast";
  const showQuietLoading = surface.kind === "loading";

  if (showForecast || showQuietLoading) {
    const readout = surface.kind === "forecast" ? buildReadout(surface, locale, units) : null;
    const loadingLabel =
      surface.kind === "loading" && surface.locating ? copy.locating : copy.loading;
    const ariaLabel = readout
      ? fill(copy.openForecastAria, {
          place: readout.placeName,
          temperature: readout.temperatureWithUnit,
          condition: readout.condition,
          status: readout.statusLine,
        })
      : loadingLabel;
    const hours = readout?.hours.slice(0, 3) ?? [];
    return (
      <section
        dir={dir}
        aria-label={copy.title}
        aria-busy={showQuietLoading || undefined}
        data-weather-strip
        data-layout="strip"
        data-surface={surface.kind}
        className={STRIP_SHELL}
      >
        <button
          type="button"
          data-strip-main
          disabled={!showForecast}
          aria-haspopup={showForecast ? "dialog" : undefined}
          aria-expanded={showForecast ? open : undefined}
          aria-label={ariaLabel}
          onClick={showForecast ? () => setOpen(true) : undefined}
          className={STRIP_BUTTON}
        >
          <span data-strip-row="main" className="flex h-[34px] items-center gap-2.5">
            <span data-slot="glyph" className="grid size-6 shrink-0 place-items-center">
              <WeatherGlyph
                symbol={readout?.symbol ?? "unknown"}
                isDay={readout?.isDay ?? true}
                className={readout ? "size-6 text-muted-foreground" : "size-6 text-faint"}
              />
            </span>
            <span
              data-slot="temperature"
              dir="ltr"
              className="text-[28px] font-medium leading-none tracking-[-0.02em] tabular-nums text-foreground"
            >
              {readout?.temperature ?? "—"}
            </span>
            <span
              data-slot="condition"
              className="min-w-0 truncate text-[13px] text-muted-foreground"
            >
              {readout?.condition ?? copy.checking}
            </span>
            <span
              data-slot="range"
              dir="ltr"
              className="ms-auto shrink-0 text-[13px] tabular-nums text-muted-foreground"
            >
              {readout?.range ?? ""}
            </span>
            <span
              data-slot="precipitation"
              dir="ltr"
              className="shrink-0 text-[11.5px] tabular-nums text-faint"
            >
              {readout?.precipitation ?? ""}
            </span>
          </span>
          <span data-strip-row="meta" className="flex h-[16px] items-center gap-1.5">
            <span
              data-slot="place"
              className="min-w-0 truncate text-[12.5px] font-medium text-muted-foreground"
            >
              {readout?.placeName ?? ""}
            </span>
            <span aria-hidden="true" className="shrink-0 text-border-strong">
              ·
            </span>
            <span data-slot="status" className="min-w-0 truncate text-[11.5px] text-faint">
              {readout?.statusLine ?? loadingLabel}
            </span>
          </span>
        </button>

        <span data-strip-row="rail" className="flex h-[17px] items-center gap-2 overflow-hidden">
          <span className="hidden min-w-0 items-center gap-2.5 overflow-hidden min-[380px]:flex">
            {hours.map((hour) => (
              <span
                key={hour.key}
                data-hour
                dir="ltr"
                className="inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap text-[11px] tabular-nums"
              >
                <span className="text-faint">{hour.clock}</span>
                <span className="text-muted-foreground">{hour.temperature}</span>
              </span>
            ))}
            {readout === null ? (
              <span data-hour className="text-[11px] tabular-nums text-faint">
                — — —
              </span>
            ) : null}
          </span>
          {readout?.attribution ? (
            readout.attribution.url ? (
              <a
                data-strip-attribution
                href={readout.attribution.url}
                target="_blank"
                rel="noopener noreferrer"
                className="press-soft ms-auto shrink-0 truncate text-[10.5px] text-faint underline decoration-border-strong underline-offset-2"
              >
                {readout.attribution.text}
              </a>
            ) : (
              <span className="ms-auto shrink-0 truncate text-[10.5px] text-faint">
                {readout.attribution.text}
              </span>
            )
          ) : (
            <span className="ms-auto" aria-hidden="true" />
          )}
        </span>

        {showForecast ? (
          <WeatherSheet
            open={open}
            onClose={close}
            locale={locale}
            forecast={forecast}
            location={location}
            units={units}
            onRefresh={props.onRefresh}
            onEnableLocation={props.onEnableLocation}
            onChooseCity={props.onChooseCity}
            onUnitsChange={props.onUnitsChange}
          />
        ) : null}
      </section>
    );
  }

  return (
    <LocationSurface
      surface={surface}
      locale={locale}
      dir={dir}
      pending={location.pending ?? "none"}
      canEnable={location.canEnable !== false}
      onRefresh={props.onRefresh}
      onEnableLocation={props.onEnableLocation}
      onChooseCity={props.onChooseCity}
    />
  );
}

function LocationSurface({
  surface,
  locale,
  dir,
  pending,
  canEnable,
  onRefresh,
  onEnableLocation,
  onChooseCity,
}: {
  surface: Exclude<ReturnType<typeof resolveWeatherSurface>, { kind: "forecast" }>;
  locale: WeatherStripProps["locale"];
  dir: "rtl" | "ltr";
  pending: "none" | "locating" | "searching";
  canEnable: boolean;
  onRefresh: () => void;
  onEnableLocation: () => void;
  onChooseCity: () => void;
}) {
  const copy = COPY[locale];
  const locating = pending === "locating";
  const message = locationMessage(surface, locale, pending);
  const showEnable = (surface.kind === "permission" || surface.kind === "denied") && canEnable;
  const showCity =
    surface.kind === "permission" ||
    surface.kind === "denied" ||
    surface.kind === "unsupported" ||
    surface.kind === "need-place" ||
    surface.kind === "error";
  const showRetry = surface.kind === "error" || surface.kind === "offline-empty";
  return (
    <section
      dir={dir}
      aria-label={copy.title}
      aria-busy={locating || surface.kind === "loading" || undefined}
      data-weather-strip
      data-layout="strip"
      data-surface={surface.kind}
      className={STRIP_SHELL}
    >
      <p data-slot="message" className="min-w-0 text-[12.5px] leading-snug text-muted-foreground">
        {message}
      </p>
      {showEnable || showCity || showRetry ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {showEnable ? (
            <button
              type="button"
              onClick={onEnableLocation}
              disabled={locating}
              className="press inline-flex min-h-11 items-center rounded-full bg-signal px-3.5 text-[12px] font-medium text-signal-foreground disabled:opacity-50"
            >
              {copy.enableLocation}
            </button>
          ) : null}
          {showCity ? (
            <button
              type="button"
              onClick={onChooseCity}
              className="press inline-flex min-h-11 items-center rounded-full border border-border px-3.5 text-[12px] text-muted-foreground"
            >
              {copy.chooseCity}
            </button>
          ) : null}
          {showRetry ? (
            <button
              type="button"
              onClick={onRefresh}
              className="press inline-flex min-h-11 items-center rounded-full border border-border px-3.5 text-[12px] text-muted-foreground"
            >
              {copy.retry}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Row budget: 2 × 10 padding + 34 + 4 + 16 + 4 + 17 = 95 logical px (min 72 declared). */
const STRIP_SHELL =
  // Same card inset and inner gutter as the translator canvas: the strip shares the
  // canvas' left and right edges (12px) and its text starts on the canvas text axis (32px).
  "mx-3 flex min-h-[72px] w-auto flex-col gap-1 rounded-2xl bg-surface px-5 py-2.5 text-start";
const STRIP_BUTTON = "press flex w-full flex-col gap-1 rounded-xl";
