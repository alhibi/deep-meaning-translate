import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useAndroidBack } from "@/lib/useAndroidBack";
import { COPY, fill } from "./copy";
import type { WeatherSheetProps } from "./state";
import { resolveWeatherSurface } from "./state";
import { buildReadout } from "./view";
import { WeatherGlyph } from "./WeatherGlyph";
import type { WeatherUnits } from "@/lib/weather/types";

const UNIT_VALUES: readonly WeatherUnits[] = ["metric", "imperial"];

/**
 * The expanded forecast. A real dialog: focus is trapped and returned, Escape and Android back
 * close it, the page behind it cannot scroll, and nothing is written to the route or the
 * translator's state. The compact strip stays mounted underneath (it is the focus opener).
 */
export function WeatherSheet(props: WeatherSheetProps) {
  const { open, onClose, locale, forecast, location, units } = props;
  const copy = COPY[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const titleId = useId();
  const hourlyHeadingId = useId();
  const dailyHeadingId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);

  useFocusTrap(open, sheetRef);
  useAndroidBack(open, onClose);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const surface = resolveWeatherSurface({ forecast, location });
  const readout = surface.kind === "forecast" ? buildReadout(surface, locale, units) : null;
  const title = readout?.placeName ?? copy.title;
  const refreshing = forecast.refreshing === true;

  return createPortal(
    <div
      ref={sheetRef}
      tabIndex={-1}
      dir={dir}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-busy={refreshing || undefined}
      data-weather-sheet
      data-surface={surface.kind}
      className="fixed inset-0 z-50 outline-none"
    >
      <div
        onClick={onClose}
        aria-hidden="true"
        data-sheet-scrim
        className="animate-sheet-scrim absolute inset-0 bg-background/70"
      />
      <div className="animate-sheet-in absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-[26px] border-t border-border bg-surface">
        <header className="shrink-0 px-5 pb-2 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.08em] text-faint">{copy.title}</p>
              <h2
                id={titleId}
                data-sheet-title
                className="truncate text-[17px] font-semibold tracking-[-0.01em] text-foreground"
              >
                {title}
              </h2>
              {readout?.placeCredit ? (
                <p data-place-credit className="mt-0.5 truncate text-[10.5px] text-faint">
                  {readout.placeCredit}
                </p>
              ) : null}
              {readout ? (
                <p
                  data-sheet-status
                  className="mt-1 text-[12px] leading-snug text-muted-foreground"
                >
                  {readout.statusLine}
                  {refreshing ? ` · ${copy.updating}` : ""}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              data-autofocus
              onClick={onClose}
              aria-label={copy.close}
              className="press-soft -me-1 grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="size-[18px]" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          {readout && readout.notes.length > 0 ? (
            <ul data-sheet-notes className="mt-1.5 space-y-0.5">
              {readout.notes.map((note, index) => (
                <li
                  key={`note-${index}`}
                  className="text-[11.5px] leading-snug text-muted-foreground"
                >
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {readout ? (
            <>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="text-[12px] text-faint">{copy.units}</span>
                <div
                  role="group"
                  aria-label={copy.units}
                  className="flex shrink-0 rounded-full bg-card p-0.5"
                >
                  {UNIT_VALUES.map((value) => {
                    const active = units === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={active}
                        aria-label={value === "metric" ? copy.celsius : copy.fahrenheit}
                        onClick={() => {
                          if (value !== units) props.onUnitsChange(value);
                        }}
                        className={`press-soft min-h-8 rounded-full px-2.5 text-[12px] font-medium tabular-nums ${
                          active ? "bg-surface text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        <span aria-hidden="true" dir="ltr">
                          {value === "metric" ? "°C" : "°F"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <section aria-label={copy.current} data-current className="mt-4">
                <div className="flex items-center gap-4">
                  <WeatherGlyph
                    symbol={readout.symbol}
                    isDay={readout.isDay}
                    className="size-11 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0">
                    <p
                      data-current-temperature
                      dir="ltr"
                      className="text-[34px] font-medium leading-none tracking-[-0.02em] tabular-nums text-foreground"
                    >
                      {readout.temperatureWithUnit}
                    </p>
                    <p className="mt-1 truncate text-[13px] text-muted-foreground">
                      {readout.condition}
                    </p>
                  </div>
                </div>
                {readout.details.length > 0 ? (
                  <ul
                    data-current-details
                    className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground"
                  >
                    {readout.details.map((detail) => (
                      <li
                        key={detail.key}
                        className="after:ms-2 after:text-border-strong after:content-['·'] last:after:hidden"
                      >
                        {detail.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {readout.issuedLine ? (
                  <p data-provider-time className="mt-2 text-[11px] text-faint">
                    {readout.issuedLine}
                  </p>
                ) : null}
              </section>

              {readout.hours.length > 0 ? (
                <section aria-labelledby={hourlyHeadingId} data-hourly className="mt-5">
                  <h3
                    id={hourlyHeadingId}
                    className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint"
                  >
                    {copy.hourlyHeading}
                  </h3>
                  <ul className="no-scrollbar -mx-5 mt-2 flex gap-1 overflow-x-auto overscroll-x-contain px-5 pb-1">
                    {readout.hours.map((hour) => (
                      <li
                        key={hour.key}
                        data-hour-card
                        className="flex w-[58px] shrink-0 flex-col items-center gap-1 rounded-xl bg-card py-2"
                      >
                        <span dir="ltr" className="text-[11px] tabular-nums text-faint">
                          {hour.clock}
                        </span>
                        {hour.isDay === null ? null : (
                          <WeatherGlyph
                            symbol={hour.symbol}
                            isDay={hour.isDay}
                            className="size-[22px] text-muted-foreground"
                          />
                        )}
                        <span dir="ltr" className="text-[13px] tabular-nums text-foreground">
                          {hour.temperature}
                        </span>
                        {hour.precipitation ? (
                          <span dir="ltr" className="text-[10.5px] tabular-nums text-faint">
                            {hour.precipitation}
                          </span>
                        ) : null}
                        <span className="sr-only">{hour.condition}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {readout.days.length > 0 ? (
                <section aria-labelledby={dailyHeadingId} data-daily className="mt-5">
                  <h3
                    id={dailyHeadingId}
                    className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint"
                  >
                    {fill(copy.dailyHeading, { count: readout.days.length })}
                  </h3>
                  <ul className="mt-1">
                    {readout.days.map((day) => (
                      <li
                        key={day.key}
                        data-day-row
                        className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
                      >
                        <span className="w-[104px] shrink-0 truncate text-[12.5px] text-muted-foreground">
                          {day.label}
                        </span>
                        <WeatherGlyph
                          symbol={day.symbol}
                          isDay
                          className="size-5 shrink-0 text-muted-foreground"
                        />
                        {day.precipitation ? (
                          <span dir="ltr" className="text-[11px] tabular-nums text-faint">
                            {day.precipitation}
                          </span>
                        ) : null}
                        <span
                          dir="ltr"
                          className="ms-auto flex items-baseline gap-2 text-[13px] tabular-nums"
                        >
                          <span className="text-foreground">{day.max}</span>
                          <span className="text-faint">{day.min}</span>
                        </span>
                        <span className="sr-only">{day.condition}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={props.onChooseCity}
                  className="press-soft min-h-9 shrink-0 rounded-full px-3 text-[12px] text-muted-foreground underline-offset-4 hover:underline"
                >
                  {copy.changePlace}
                </button>
                <Attribution readout={readout} copy={copy} />
                <button
                  type="button"
                  data-sheet-refresh
                  onClick={props.onRefresh}
                  disabled={refreshing}
                  className="press-soft min-h-9 shrink-0 rounded-full px-3 text-[12px] text-muted-foreground disabled:opacity-50"
                >
                  {refreshing ? copy.updating : copy.refresh}
                </button>
              </footer>
            </>
          ) : (
            <div className="mt-3">
              <p className="text-[13px] leading-relaxed text-muted-foreground">{copy.noForecast}</p>
              <button
                type="button"
                onClick={props.onRefresh}
                className="press-soft mt-3 min-h-9 rounded-full border border-border px-3 text-[12px] text-muted-foreground"
              >
                {copy.retry}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Attribution({
  readout,
  copy,
}: {
  readout: { attribution: { text: string; url: string } | null };
  copy: (typeof COPY)[keyof typeof COPY];
}) {
  const attribution = readout.attribution;
  if (!attribution) return <span aria-hidden="true" />;
  if (!attribution.url) {
    return <span className="min-w-0 truncate text-[11px] text-faint">{attribution.text}</span>;
  }
  return (
    <a
      data-attribution
      href={attribution.url}
      target="_blank"
      rel="noopener noreferrer"
      className="press-soft min-w-0 truncate text-[11px] text-faint underline decoration-border-strong underline-offset-2"
    >
      {attribution.text}
    </a>
  );
}
