import type { WeatherSymbol } from "@/lib/weather/types";
import type { Locale } from "@/lib/i18n";

/**
 * Feature copy for the weather surfaces.
 *
 * It deliberately lives here instead of `src/lib/i18n.ts`: the weather module is composed
 * into the translator route by the integration owner, and its wording changes with the
 * provider/attribution contract, not with the translator's dictionary. Precedent:
 * DataControls / ProviderKey keep their own COPY object for the same reason.
 */
export interface WeatherCopy {
  title: string;
  openForecast: string;
  openForecastAria: string;
  close: string;
  /** Status lines under the place name. {age} is an Intl relative-time string. */
  updated: string;
  saved: string;
  outdated: string;
  offlineSaved: string;
  locationOffSaved: string;
  updateFailedSaved: string;
  /** Age-free variants: the clock is unavailable (server render) or freshness was not supplied. */
  savedNoAge: string;
  outdatedNoAge: string;
  offlineSavedNoAge: string;
  locationOffSavedNoAge: string;
  updateFailedSavedNoAge: string;
  checking: string;
  loading: string;
  locating: string;
  permissionLine: string;
  deniedLine: string;
  revokedLine: string;
  unsupportedLine: string;
  insecureLine: string;
  timeoutLine: string;
  positionLine: string;
  geocodeLine: string;
  errorLine: string;
  yourLocation: string;
  enableLocation: string;
  chooseCity: string;
  changePlace: string;
  stopLocation: string;
  retry: string;
  refresh: string;
  updating: string;
  staleNote: string;
  expiredNote: string;
  staleNoteNoAge: string;
  offlineNote: string;
  locationOffNote: string;
  updateFailedNote: string;
  noForecast: string;
  current: string;
  hourlyHeading: string;
  dailyHeading: string;
  units: string;
  celsius: string;
  fahrenheit: string;
  feelsLike: string;
  humidity: string;
  wind: string;
  chanceOfPrecipitation: string;
  sunrise: string;
  sunset: string;
  issued: string;
  weatherData: string;
  windUnit: { metric: string; imperial: string };
  conditions: Record<WeatherSymbol, string>;
}

export const COPY: Record<Locale, WeatherCopy> = {
  en: {
    title: "Weather",
    openForecast: "Open the forecast",
    openForecastAria:
      "Weather in {place}: {temperature}, {condition}. {status}. Open the forecast.",
    close: "Close",
    updated: "Updated {age}",
    saved: "Saved {age}",
    outdated: "Outdated · {age}",
    offlineSaved: "Offline · saved {age}",
    locationOffSaved: "Location off · saved {age}",
    updateFailedSaved: "Update failed · saved {age}",
    savedNoAge: "Saved on this device",
    outdatedNoAge: "Outdated · saved on this device",
    offlineSavedNoAge: "Offline · saved on this device",
    locationOffSavedNoAge: "Location off · saved on this device",
    updateFailedSavedNoAge: "Update failed · saved on this device",
    checking: "Checking the forecast…",
    loading: "Forecast loading",
    locating: "Finding your location…",
    permissionLine: "See the weather where you are.",
    deniedLine: "Location is off, so the weather can't load.",
    revokedLine: "Location was turned off, so the weather can't load.",
    unsupportedLine: "This browser can't share a location.",
    insecureLine: "Location needs a secure connection.",
    timeoutLine: "Finding your location took too long. Try again or choose a city.",
    positionLine: "Your location isn't available right now. Try again or choose a city.",
    geocodeLine: "We couldn't find that place. Choose another city.",
    errorLine: "Weather isn't available right now.",
    yourLocation: "Your location",
    enableLocation: "Use my location",
    chooseCity: "Choose a city",
    changePlace: "Change place",
    stopLocation: "Stop using my location",
    retry: "Try again",
    refresh: "Update",
    updating: "Updating…",
    staleNote: "This forecast was saved {age} and may be out of date.",
    expiredNote: "This forecast was saved {age} and may have changed.",
    staleNoteNoAge: "This saved forecast may be out of date.",
    offlineNote: "You're offline. Showing the last saved forecast.",
    locationOffNote: "Location is off. Showing the last forecast saved on this device.",
    updateFailedNote: "The update failed. Showing the last saved forecast.",
    noForecast: "No forecast is available yet.",
    current: "Now",
    hourlyHeading: "Next 24 hours",
    dailyHeading: "Next {count} days",
    units: "Units",
    celsius: "Celsius",
    fahrenheit: "Fahrenheit",
    feelsLike: "Feels like {value}",
    humidity: "Humidity {value}",
    wind: "Wind {value}",
    chanceOfPrecipitation: "Chance of precipitation {value}",
    sunrise: "Sunrise {time}",
    sunset: "Sunset {time}",
    issued: "Provider updated {time}",
    weatherData: "Weather data",
    windUnit: { metric: "km/h", imperial: "mph" },
    conditions: {
      clear: "Clear",
      "partly-cloudy": "Partly cloudy",
      cloudy: "Cloudy",
      fog: "Fog",
      drizzle: "Drizzle",
      rain: "Rain",
      "heavy-rain": "Heavy rain",
      sleet: "Sleet",
      snow: "Snow",
      thunder: "Thunderstorm",
      unknown: "Not available",
    },
  },
  de: {
    title: "Wetter",
    openForecast: "Vorhersage öffnen",
    openForecastAria: "Wetter in {place}: {temperature}, {condition}. {status}. Vorhersage öffnen.",
    close: "Schließen",
    updated: "Aktualisiert {age}",
    saved: "Gespeichert {age}",
    outdated: "Veraltet · {age}",
    offlineSaved: "Offline · gespeichert {age}",
    locationOffSaved: "Standort aus · gespeichert {age}",
    updateFailedSaved: "Update fehlgeschlagen · gespeichert {age}",
    savedNoAge: "Auf diesem Gerät gespeichert",
    outdatedNoAge: "Veraltet · auf diesem Gerät gespeichert",
    offlineSavedNoAge: "Offline · auf diesem Gerät gespeichert",
    locationOffSavedNoAge: "Standort aus · auf diesem Gerät gespeichert",
    updateFailedSavedNoAge: "Update fehlgeschlagen · auf diesem Gerät gespeichert",
    checking: "Vorhersage wird geprüft…",
    loading: "Vorhersage lädt",
    locating: "Standort wird ermittelt…",
    permissionLine: "Sieh das Wetter an deinem Ort.",
    deniedLine: "Der Standort ist aus, deshalb lädt das Wetter nicht.",
    revokedLine: "Der Standort wurde ausgeschaltet, deshalb lädt das Wetter nicht.",
    unsupportedLine: "Dieser Browser kann keinen Standort teilen.",
    insecureLine: "Der Standort braucht eine sichere Verbindung.",
    timeoutLine:
      "Die Standortsuche hat zu lange gedauert. Versuch es erneut oder wähle eine Stadt.",
    positionLine:
      "Dein Standort ist gerade nicht verfügbar. Versuch es erneut oder wähle eine Stadt.",
    geocodeLine: "Dieser Ort wurde nicht gefunden. Wähle eine andere Stadt.",
    errorLine: "Das Wetter ist gerade nicht verfügbar.",
    yourLocation: "Dein Standort",
    enableLocation: "Standort verwenden",
    chooseCity: "Stadt wählen",
    changePlace: "Ort ändern",
    stopLocation: "Standort nicht mehr verwenden",
    retry: "Erneut versuchen",
    refresh: "Aktualisieren",
    updating: "Wird aktualisiert…",
    staleNote: "Diese Vorhersage wurde {age} gespeichert und ist vielleicht nicht mehr aktuell.",
    expiredNote: "Diese Vorhersage wurde {age} gespeichert und kann sich geändert haben.",
    staleNoteNoAge: "Diese gespeicherte Vorhersage ist vielleicht nicht mehr aktuell.",
    offlineNote: "Du bist offline. Die zuletzt gespeicherte Vorhersage wird gezeigt.",
    locationOffNote:
      "Der Standort ist aus. Die zuletzt auf diesem Gerät gespeicherte Vorhersage wird gezeigt.",
    updateFailedNote:
      "Das Update ist fehlgeschlagen. Die zuletzt gespeicherte Vorhersage wird gezeigt.",
    noForecast: "Noch keine Vorhersage verfügbar.",
    current: "Jetzt",
    hourlyHeading: "Nächste 24 Stunden",
    dailyHeading: "Nächste {count} Tage",
    units: "Einheiten",
    celsius: "Celsius",
    fahrenheit: "Fahrenheit",
    feelsLike: "Gefühlt {value}",
    humidity: "Luftfeuchte {value}",
    wind: "Wind {value}",
    chanceOfPrecipitation: "Niederschlagswahrscheinlichkeit {value}",
    sunrise: "Sonnenaufgang {time}",
    sunset: "Sonnenuntergang {time}",
    issued: "Anbieter aktualisiert {time}",
    weatherData: "Wetterdaten",
    windUnit: { metric: "km/h", imperial: "mph" },
    conditions: {
      clear: "Klar",
      "partly-cloudy": "Teils bewölkt",
      cloudy: "Bewölkt",
      fog: "Nebel",
      drizzle: "Nieselregen",
      rain: "Regen",
      "heavy-rain": "Starkregen",
      sleet: "Schneeregen",
      snow: "Schnee",
      thunder: "Gewitter",
      unknown: "Nicht verfügbar",
    },
  },
  ar: {
    title: "الطقس",
    openForecast: "افتح التوقعات",
    openForecastAria: "الطقس في {place}: {temperature}، {condition}. {status}. افتح التوقعات.",
    close: "إغلاق",
    updated: "حُدّث {age}",
    saved: "محفوظ {age}",
    outdated: "قديم · {age}",
    offlineSaved: "دون اتصال · محفوظ {age}",
    locationOffSaved: "الموقع متوقف · محفوظ {age}",
    updateFailedSaved: "فشل التحديث · محفوظ {age}",
    savedNoAge: "محفوظ على هذا الجهاز",
    outdatedNoAge: "قديم · محفوظ على هذا الجهاز",
    offlineSavedNoAge: "دون اتصال · محفوظ على هذا الجهاز",
    locationOffSavedNoAge: "الموقع متوقف · محفوظ على هذا الجهاز",
    updateFailedSavedNoAge: "فشل التحديث · محفوظ على هذا الجهاز",
    checking: "جارٍ التحقق من التوقعات…",
    loading: "التوقعات قيد التحميل",
    locating: "جارٍ تحديد موقعك…",
    permissionLine: "اعرف الطقس في مكانك.",
    deniedLine: "الموقع متوقف، لذا لا يمكن تحميل الطقس.",
    revokedLine: "أُوقف الموقع، لذا لا يمكن تحميل الطقس.",
    unsupportedLine: "هذا المتصفح لا يمكنه مشاركة الموقع.",
    insecureLine: "الموقع يحتاج إلى اتصال آمن.",
    timeoutLine: "استغرق تحديد موقعك وقتاً طويلاً. أعد المحاولة أو اختر مدينة.",
    positionLine: "موقعك غير متاح الآن. أعد المحاولة أو اختر مدينة.",
    geocodeLine: "لم نعثر على هذا المكان. اختر مدينة أخرى.",
    errorLine: "الطقس غير متاح الآن.",
    yourLocation: "موقعك",
    enableLocation: "استخدم موقعي",
    chooseCity: "اختر مدينة",
    changePlace: "تغيير المكان",
    stopLocation: "إيقاف استخدام موقعي",
    retry: "أعد المحاولة",
    refresh: "تحديث",
    updating: "جارٍ التحديث…",
    staleNote: "حُفظت هذه التوقعات {age} وقد تكون قديمة.",
    expiredNote: "حُفظت هذه التوقعات {age} وقد تكون تغيّرت.",
    staleNoteNoAge: "هذه التوقعات المحفوظة قد تكون قديمة.",
    offlineNote: "أنت دون اتصال. تُعرض آخر توقعات محفوظة.",
    locationOffNote: "الموقع متوقف. تُعرض آخر توقعات محفوظة على هذا الجهاز.",
    updateFailedNote: "فشل التحديث. تُعرض آخر توقعات محفوظة.",
    noForecast: "لا توجد توقعات متاحة بعد.",
    current: "الآن",
    hourlyHeading: "الساعات الـ24 القادمة",
    dailyHeading: "الأيام الـ{count} القادمة",
    units: "الوحدات",
    celsius: "مئوية",
    fahrenheit: "فهرنهايت",
    feelsLike: "الإحساس {value}",
    humidity: "الرطوبة {value}",
    wind: "الرياح {value}",
    chanceOfPrecipitation: "احتمال الهطول {value}",
    sunrise: "الشروق {time}",
    sunset: "الغروب {time}",
    issued: "آخر تحديث من المزوّد {time}",
    weatherData: "بيانات الطقس",
    windUnit: { metric: "كم/س", imperial: "ميل/س" },
    conditions: {
      clear: "صافٍ",
      "partly-cloudy": "غائم جزئياً",
      cloudy: "غائم",
      fog: "ضباب",
      drizzle: "رذاذ",
      rain: "مطر",
      "heavy-rain": "مطر غزير",
      sleet: "مطر ثلجي",
      snow: "ثلج",
      thunder: "عاصفة رعدية",
      unknown: "غير متاح",
    },
  },
};

/** Replaces `{name}` placeholders. Missing values become an empty string, never "undefined". */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? "" : String(value);
  });
}
