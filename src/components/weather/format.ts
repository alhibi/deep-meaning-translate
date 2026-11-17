import type { Locale } from "@/lib/i18n";
import type { WeatherUnits } from "@/lib/weather/types";

/**
 * Formatting for the weather surfaces. Every number and date is produced by Intl with the
 * place's time zone, and Latin digits are pinned (`-u-nu-latn`) exactly like the statistics
 * surface: columns of temperatures must align across the three interface languages, and a
 * weather readout is a column of numbers.
 *
 * Nothing here reads the clock: age is supplied by the weather hook's freshness value, so a
 * render is pure and a stale snapshot can never be painted as "just updated".
 */

const LOCALE_TAG: Record<Locale, string> = {
  ar: "ar-u-nu-latn",
  de: "de-u-nu-latn",
  en: "en-u-nu-latn",
};

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();
const validZones = new Map<string, boolean>();

function numberFormat(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const cached = numberFormats.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(LOCALE_TAG[locale], options);
  numberFormats.set(key, created);
  return created;
}

function relativeFormat(locale: Locale): Intl.RelativeTimeFormat {
  const cached = relativeFormats.get(locale);
  if (cached) return cached;
  const created = new Intl.RelativeTimeFormat(LOCALE_TAG[locale], {
    numeric: "auto",
    style: "short",
  });
  relativeFormats.set(locale, created);
  return created;
}

/** A bad IANA zone must degrade to "no clock label", never to the machine's zone. */
export function isValidTimeZone(timeZone: string): boolean {
  const cached = validZones.get(timeZone);
  if (cached !== undefined) return cached;
  let ok = timeZone.length > 0;
  if (ok) {
    try {
      new Intl.DateTimeFormat("en", { timeZone });
    } catch {
      ok = false;
    }
  }
  validZones.set(timeZone, ok);
  return ok;
}

function dateFormat(
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
  timeZone: string,
): Intl.DateTimeFormat | null {
  if (!isValidTimeZone(timeZone)) return null;
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  const cached = dateFormats.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(LOCALE_TAG[locale], { ...options, timeZone });
  dateFormats.set(key, created);
  return created;
}

/** Parses an ISO string; returns null instead of "Invalid Date" reaching a formatter. */
export function parseIso(value: string): Date | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Rounds for display and turns -0 into 0, so `-0.4°` is not painted as "-0°". */
export function roundForDisplay(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function convertTemperature(value: number, from: WeatherUnits, to: WeatherUnits): number {
  if (!Number.isFinite(value) || from === to) return value;
  return from === "metric" ? (value * 9) / 5 + 32 : ((value - 32) * 5) / 9;
}

/**
 * Wind speed unit convention of the shared contract: metric snapshots carry km/h, imperial
 * snapshots carry mph. The adapter normalizes to that before it hands us a snapshot.
 */
export function convertWindSpeed(value: number, from: WeatherUnits, to: WeatherUnits): number {
  if (!Number.isFinite(value) || from === to) return value;
  return from === "metric" ? value * 0.621371 : value / 0.621371;
}

export function temperatureNumber(
  value: number,
  from: WeatherUnits,
  to: WeatherUnits,
  locale: Locale,
): string {
  if (!Number.isFinite(value)) return "—";
  return formatNumber(locale, roundForDisplay(convertTemperature(value, from, to)), 0);
}

/** Visible temperature without the letter: "12°", "-4°"; "—" when the value is unusable. */
export function temperatureText(
  value: number,
  from: WeatherUnits,
  to: WeatherUnits,
  locale: Locale,
): string {
  const number = temperatureNumber(value, from, to, locale);
  return number === "—" ? number : `${number}°`;
}

/** Temperature with its unit for the expanded surface and accessible names: "12°C" / "12 °C". */
export function temperatureWithUnit(
  value: number,
  from: WeatherUnits,
  to: WeatherUnits,
  locale: Locale,
): string {
  if (!Number.isFinite(value)) return "—";
  const shown = roundForDisplay(convertTemperature(value, from, to));
  try {
    return numberFormat(locale, {
      style: "unit",
      unit: to === "metric" ? "celsius" : "fahrenheit",
      maximumFractionDigits: 0,
    }).format(shown);
  } catch {
    return `${formatNumber(locale, shown, 0)}°`;
  }
}

export function formatNumber(locale: Locale, value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return numberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

/** Precipitation probabilities arrive as 0–100; the formatter takes a 0–1 fraction. */
export function percentText(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return "—";
  const clamped = Math.min(100, Math.max(0, value));
  return numberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(clamped / 100);
}

/** "now", "5 min. ago", "3 hr. ago", "2 days ago" — localized by Intl. */
export function relativeAge(ageMs: number, locale: Locale): string {
  const age = Number.isFinite(ageMs) ? Math.max(0, ageMs) : 0;
  const fmt = relativeFormat(locale);
  if (age < 60_000) return fmt.format(0, "second");
  if (age < 3_600_000) return fmt.format(-Math.floor(age / 60_000), "minute");
  if (age < 86_400_000) return fmt.format(-Math.floor(age / 3_600_000), "hour");
  return fmt.format(-Math.floor(age / 86_400_000), "day");
}

/** Clock time ("14:05", "2:05 PM") used for sunrise/sunset and the provider's issue time. */
export function formatClockTime(iso: string, locale: Locale, timeZone: string): string {
  const date = parseIso(iso);
  if (!date) return "";
  const format = dateFormat(locale, { hour: "numeric", minute: "2-digit" }, timeZone);
  if (!format) return "";
  try {
    return format.format(date);
  } catch {
    return "";
  }
}

/**
 * Compact 24h clock for forecast rails/cards ("13:00"). Unlike the prose clock
 * (`formatClockTime`, which follows the locale's AM/PM convention), a column of hourly
 * labels must be narrow and unambiguous in every language.
 */
export function formatHourClock(iso: string, locale: Locale, timeZone: string): string {
  const date = parseIso(iso);
  if (!date) return "";
  const format = dateFormat(
    locale,
    { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    timeZone,
  );
  if (!format) return "";
  try {
    return format.format(date);
  } catch {
    return "";
  }
}

/** Sunrise/sunset may arrive as ISO or as a plain "07:42"; an unknown shape renders nothing. */
export function formatSunTime(value: string, locale: Locale, timeZone: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (parseIso(trimmed)) return formatClockTime(trimmed, locale, timeZone);
  return /^\d{1,2}:\d{2}$/.test(trimmed) ? trimmed : "";
}

function utcNoon(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (Number.isNaN(date.getTime())) return null;
  // Reject calendar overflow ("2026-13-40" would otherwise silently become Feb 9).
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Day label for the 5–7 day list. The date is a local calendar date in the place's zone, so it
 * is anchored and formatted in UTC: converting it again could move it across the date line.
 */
export function formatDayLabel(dateKey: string, locale: Locale): string {
  const date = utcNoon(dateKey);
  if (!date) return dateKey;
  const key = `${locale}|day-label`;
  const cached = dateFormats.get(key);
  const format =
    cached ??
    new Intl.DateTimeFormat(LOCALE_TAG[locale], {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  if (!cached) dateFormats.set(key, format);
  try {
    return format.format(date);
  } catch {
    return dateKey;
  }
}
