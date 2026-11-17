import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Search, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { WeatherPlace } from "@/lib/weather/types";
import type { WeatherLocation } from "@/lib/weather/useWeatherLocation";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { COPY } from "./copy";

/**
 * Manual place selection: the alternative that always works when a device fix is refused,
 * unavailable or not wanted.
 *
 * Everything here is explicit: the person types or taps, we show a short list of exact
 * matches from our own server route, and a place is only stored after a choice. No
 * permission prompt is shown from this surface, and no coordinate is requested. Both
 * geocoding attributions (Open-Meteo/GeoNames for search, OpenStreetMap for reverse names)
 * are visible where their data appears.
 */
export interface PickerCopy {
  title: string;
  placeholder: string;
  hint: string;
  searching: string;
  noResults: string;
  failed: string;
  remove: string;
  geocodingCredit: string;
  mapCredit: string;
}

const PICKER_COPY: Record<Locale, PickerCopy> = {
  en: {
    title: "City or place",
    placeholder: "Search a city",
    hint: "Only an approximate area is used for the forecast.",
    searching: "Searching…",
    noResults: "No matching place.",
    failed: "Place search is unavailable right now.",
    remove: "Remove this place",
    geocodingCredit: "Search data by Open-Meteo.com",
    mapCredit: "Place names © OpenStreetMap contributors",
  },
  de: {
    title: "Stadt oder Ort",
    placeholder: "Stadt suchen",
    hint: "Für die Vorhersage wird nur eine ungefähre Gegend verwendet.",
    searching: "Suche…",
    noResults: "Kein passender Ort.",
    failed: "Die Ortssuche ist gerade nicht verfügbar.",
    remove: "Diesen Ort entfernen",
    geocodingCredit: "Suchdaten von Open-Meteo.com",
    mapCredit: "Ortsnamen © OpenStreetMap-Mitwirkende",
  },
  ar: {
    title: "مدينة أو مكان",
    placeholder: "ابحث عن مدينة",
    hint: "تُستخدم منطقة تقريبية فقط للتوقعات.",
    searching: "أبحث…",
    noResults: "لا يوجد مكان مطابق.",
    failed: "البحث عن الأماكن غير متاح الآن.",
    remove: "إزالة هذا المكان",
    geocodingCredit: "بيانات البحث من Open-Meteo.com",
    mapCredit: "أسماء الأماكن © مساهمو OpenStreetMap",
  },
};

const DEBOUNCE_MS = 320;
const MIN_QUERY = 2;

export function WeatherCityPicker({
  open,
  locale,
  location,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  location: WeatherLocation;
  onClose: () => void;
}) {
  const copy = PICKER_COPY[locale];
  const strip = COPY[locale];
  const rtl = locale === "ar";
  const dialogRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeatherPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pendingChoice, setPendingChoice] = useState(false);

  useFocusTrap(open, dialogRef);

  // The surface is mounted per open, so the query state starts empty; a previous search
  // can never answer for a new one.
  useEffect(() => {
    if (!open) return undefined;
    const value = query.trim();
    if (value.length < MIN_QUERY) return undefined;
    const id = setTimeout(() => {
      const token = ++sequence.current;
      setSearching(true);
      setFailed(false);
      void location.searchCity(value).then((outcome) => {
        if (token !== sequence.current) return;
        setSearching(false);
        if (outcome.ok) {
          setResults(outcome.places.slice(0, 8));
        } else {
          setResults([]);
          setFailed(true);
        }
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [open, query, location]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const choose = async (place: WeatherPlace) => {
    if (pendingChoice) return;
    setPendingChoice(true);
    await location.chooseCity(place);
    onClose();
  };

  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      dir={rtl ? "rtl" : "ltr"}
      className="fixed inset-0 z-50 flex flex-col justify-end outline-none"
    >
      <div onClick={onClose} className="animate-sheet-scrim absolute inset-0 bg-background/70" />
      <div className="animate-sheet-in relative z-10 mx-auto flex max-h-[78dvh] w-full max-w-xl flex-col rounded-t-[26px] border-t border-border bg-surface pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-[16px] font-semibold text-foreground">{copy.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={strip.close}
            className="press-soft grid size-9 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="size-[18px]" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2 px-5 pb-1">
          <label className="relative flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-card px-3.5">
            <Search className="size-4 shrink-0 text-faint" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">{copy.placeholder}</span>
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => {
                const next = event.target.value;
                setQuery(next);
                // A shorter query means the previous matches no longer answer for it.
                if (next.trim().length < MIN_QUERY) {
                  sequence.current += 1;
                  setResults([]);
                  setFailed(false);
                  setSearching(false);
                }
              }}
              placeholder={copy.placeholder}
              maxLength={80}
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-faint"
            />
          </label>
          {location.canEnable ? (
            <button
              type="button"
              onClick={() => {
                void location.enableLocation().then(onClose);
              }}
              className="press-soft grid size-11 shrink-0 place-items-center rounded-2xl bg-card text-signal-text"
              aria-label={strip.enableLocation}
              title={strip.enableLocation}
            >
              <MapPin className="size-[18px]" strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}
        </div>
        <p className="shrink-0 px-5 pt-1.5 text-[11.5px] leading-snug text-faint">{copy.hint}</p>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2">
          {searching ? (
            <p className="px-3 py-2 text-[13px] text-muted-foreground" role="status">
              {copy.searching}
            </p>
          ) : failed ? (
            <p className="px-3 py-2 text-[13px] text-muted-foreground" role="status">
              {copy.failed}
            </p>
          ) : query.trim().length >= MIN_QUERY && results.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-muted-foreground" role="status">
              {copy.noResults}
            </p>
          ) : null}
          <ul className="m-0 list-none p-0">
            {results.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  disabled={pendingChoice}
                  onClick={() => void choose(place)}
                  className="press-soft flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-start hover:bg-card disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] text-foreground">
                      {place.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-faint">
                      {[place.admin, place.countryCode].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="shrink-0 space-y-1.5 border-t border-border/60 px-5 pt-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {location.place ? (
              <button
                type="button"
                onClick={() => {
                  void location.clearPlace().then(onClose);
                }}
                className="press-soft text-[12.5px] text-muted-foreground underline-offset-4 hover:underline"
              >
                {copy.remove}
              </button>
            ) : null}
            {location.status === "granted" ? (
              <button
                type="button"
                onClick={() => {
                  void location.revokeLocation().then(onClose);
                }}
                className="press-soft text-[12.5px] text-muted-foreground underline-offset-4 hover:underline"
              >
                {strip.stopLocation}
              </button>
            ) : null}
          </div>
          <p className="text-[10.5px] leading-relaxed text-faint">
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:underline"
            >
              {copy.geocodingCredit}
            </a>
            <span aria-hidden> · </span>
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:underline"
            >
              {copy.mapCredit}
            </a>
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
