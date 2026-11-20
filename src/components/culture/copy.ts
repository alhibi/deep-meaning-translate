import type {
  CultureCategory,
  CultureContentType,
  CultureContinent,
  CultureLocale,
} from "@/lib/culture/types";

/** The period a piece describes; kept here so the copy module has no cycles. */
export type CulturePeriod = "contemporary" | "historical" | "both";

/**
 * The section owns its words.
 *
 * This is a local COPY object, not a key in the shell dictionary: the culture library is
 * an editorial surface whose voice changes with the library itself, and i18n.ts belongs
 * to the translator. Every locale carries every key, so a missing translation is a type
 * error rather than an English sentence on an Arabic page.
 */
export interface CultureCopy {
  sectionLabel: string;
  intro: string;
  standfirst: string;
  featuredLabel: string;
  feedLabel: string;
  savedView: string;
  allView: string;
  savedOnDevice: string;
  savedEmpty: string;
  searchLabel: string;
  searchPlaceholder: string;
  searching: string;
  filtersLabel: string;
  filterCategory: string;
  filterContinent: string;
  filterCountry: string;
  filterLanguage: string;
  filterType: string;
  allCategories: string;
  allContinents: string;
  allCountries: string;
  allLanguages: string;
  allTypes: string;
  clearFilters: string;
  anotherDiscovery: string;
  more: string;
  endOfFeed: string;
  loading: string;
  loadingMore: string;
  empty: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  offlineTitle: string;
  offlineBody: string;
  catalogTitle: string;
  catalogBody: string;
  read: string;
  readAria: string;
  save: string;
  saved: string;
  saveAria: string;
  savedAria: string;
  close: string;
  back: string;
  readingTime: string;
  expressionLabel: string;
  transliterationLabel: string;
  glossLabel: string;
  usageLabel: string;
  exampleLabel: string;
  misunderstandingLabel: string;
  comparisonLabel: string;
  contextLabel: string;
  sourcesLabel: string;
  sourcesNote: string;
  relatedLabel: string;
  opensInNewTab: string;
  cautionContrast: string;
  articleMissingTitle: string;
  articleMissingBody: string;
  articleErrorTitle: string;
  articleErrorBody: string;
  periodContemporary: string;
  periodHistorical: string;
  periodBoth: string;
  countryList: string;
  languageList: string;
  types: Record<CultureContentType, string>;
  categories: Record<CultureCategory, string>;
  continents: Record<CultureContinent, string>;
}
const en: CultureCopy = {
  sectionLabel: "Culture, written",
  intro:
    "A library of written discoveries: how people speak, eat, gather, argue and belong. Sourced, context first — no pictures standing in for thought.",
  standfirst: "Read slowly. Three minutes is enough to see a familiar thing differently.",
  featuredLabel: "Today's reading",
  feedLabel: "The library",
  savedView: "Kept",
  allView: "All",
  savedOnDevice: "Kept on this device",
  savedEmpty:
    "Nothing kept yet. Save a piece and it waits for you here — kept pieces stay on this device and open without a connection.",
  searchLabel: "Search the library",
  searchPlaceholder: "A word, a place, a habit…",
  searching: "Searching…",
  filtersLabel: "Narrow the library",
  filterCategory: "Subject",
  filterContinent: "Continent",
  filterCountry: "Country",
  filterLanguage: "Language",
  filterType: "Form",
  allCategories: "All subjects",
  allContinents: "All continents",
  allCountries: "All countries",
  allLanguages: "All languages",
  allTypes: "All forms",
  clearFilters: "Clear filters",
  anotherDiscovery: "Another discovery",
  more: "More to read",
  endOfFeed: "You have reached the end of this edition.",
  loading: "Opening the library…",
  loadingMore: "Bringing the next pages…",
  empty: "Nothing matches this view yet. Try another word, or clear a filter.",
  errorTitle: "The library did not open just now.",
  errorBody: "Nothing is lost. Try again in a moment.",
  retry: "Try again",
  offlineTitle: "You are offline.",
  offlineBody: "Kept pieces stay readable. New pages come back with the connection.",
  catalogTitle: "This library is not available yet.",
  catalogBody: "The catalogue is still being prepared. The rest of the page is unchanged.",
  read: "Read",
  readAria: "Read {title}",
  save: "Save",
  saved: "Saved",
  saveAria: "Save {title}",
  savedAria: "Remove {title} from saved",
  close: "Close",
  back: "Back",
  readingTime: "{minutes} min read",
  expressionLabel: "In the original",
  transliterationLabel: "Said",
  glossLabel: "Meaning",
  usageLabel: "When it is said",
  exampleLabel: "In use",
  misunderstandingLabel: "A common misreading",
  comparisonLabel: "Set side by side",
  contextLabel: "Context",
  sourcesLabel: "Sources",
  sourcesNote: "Read the original sources where the piece draws on them.",
  relatedLabel: "Read next",
  opensInNewTab: "Opens in a new tab",
  cautionContrast:
    "A comparison, not a ranking. Each is a whole way of doing this — neither is the default.",
  articleMissingTitle: "This piece is not in the library.",
  articleMissingBody: "It may have moved. Go back and choose another discovery.",
  articleErrorTitle: "This piece did not load.",
  articleErrorBody: "Nothing was lost. Try opening it again.",
  periodContemporary: "Contemporary",
  periodHistorical: "Historical",
  periodBoth: "Past and present",
  countryList: "Countries",
  languageList: "Languages",
  types: {
    feature: "Feature",
    note: "Note",
    language: "Language",
    scene: "Scene",
    contrast: "Contrast",
    detail: "Detail",
  },
  categories: {
    "everyday-life": "Everyday life",
    "social-behaviour": "Social behaviour",
    languages: "Languages",
    communication: "Communication",
    traditions: "Traditions",
    "family-and-friendship": "Family and friendship",
    "food-and-hospitality": "Food and hospitality",
    "work-and-education": "Work and education",
    "cities-and-community": "Cities and community",
    "music-and-dance": "Music and dance",
    "games-and-leisure": "Games and leisure",
    storytelling: "Storytelling",
    "clothing-and-design": "Clothing and design",
    "nature-and-seasons": "Nature and seasons",
    "beliefs-and-folklore": "Beliefs and folklore",
    "migration-and-identity": "Migration and identity",
    "regional-humour": "Regional humour",
    "cultural-change": "Cultural change",
  },
  continents: {
    africa: "Africa",
    asia: "Asia",
    europe: "Europe",
    "north-america": "North America",
    "south-america": "South America",
    oceania: "Oceania",
  },
};
const de: CultureCopy = {
  sectionLabel: "Kultur, geschrieben",
  intro:
    "Eine Bibliothek geschriebener Entdeckungen: wie Menschen sprechen, essen, zusammenkommen, streiten und dazugehören. Mit Quellen, Kontext zuerst — ohne Bilder, die das Denken ersetzen.",
  standfirst: "Langsam lesen. Drei Minuten reichen, um ein vertrautes Ding anders zu sehen.",
  featuredLabel: "Heute zu lesen",
  feedLabel: "Die Bibliothek",
  savedView: "Gemerkt",
  allView: "Alle",
  savedOnDevice: "Auf diesem Gerät gemerkt",
  savedEmpty:
    "Noch nichts gemerkt. Merk dir einen Beitrag, dann wartet er hier auf dich — Gemerktes bleibt auf diesem Gerät und öffnet sich ohne Verbindung.",
  searchLabel: "Die Bibliothek durchsuchen",
  searchPlaceholder: "Ein Wort, ein Ort, eine Gewohnheit…",
  searching: "Wird gesucht…",
  filtersLabel: "Die Bibliothek eingrenzen",
  filterCategory: "Thema",
  filterContinent: "Kontinent",
  filterCountry: "Land",
  filterLanguage: "Sprache",
  filterType: "Form",
  allCategories: "Alle Themen",
  allContinents: "Alle Kontinente",
  allCountries: "Alle Länder",
  allLanguages: "Alle Sprachen",
  allTypes: "Alle Formen",
  clearFilters: "Filter zurücksetzen",
  anotherDiscovery: "Eine andere Entdeckung",
  more: "Weiterlesen",
  endOfFeed: "Mehr gibt es in dieser Ausgabe nicht.",
  loading: "Die Bibliothek öffnet sich…",
  loadingMore: "Die nächsten Seiten kommen…",
  empty: "Hier passt noch nichts. Versuch ein anderes Wort oder nimm einen Filter zurück.",
  errorTitle: "Die Bibliothek ließ sich gerade nicht öffnen.",
  errorBody: "Nichts ist verloren. Versuch es gleich noch einmal.",
  retry: "Erneut versuchen",
  offlineTitle: "Du bist offline.",
  offlineBody: "Gemerktes bleibt lesbar. Neue Seiten kommen mit der Verbindung zurück.",
  catalogTitle: "Diese Bibliothek ist noch nicht verfügbar.",
  catalogBody: "Der Katalog wird noch vorbereitet. Der Rest der Seite bleibt unverändert.",
  read: "Lesen",
  readAria: "{title} lesen",
  save: "Merken",
  saved: "Gemerkt",
  saveAria: "{title} merken",
  savedAria: "{title} aus den gemerkten entfernen",
  close: "Schließen",
  back: "Zurück",
  readingTime: "{minutes} Min. Lesezeit",
  expressionLabel: "Im Original",
  transliterationLabel: "Aussprache",
  glossLabel: "Bedeutung",
  usageLabel: "Wann man es sagt",
  exampleLabel: "Im Gebrauch",
  misunderstandingLabel: "Ein häufiges Missverständnis",
  comparisonLabel: "Nebeneinander",
  contextLabel: "Kontext",
  sourcesLabel: "Quellen",
  sourcesNote: "Die Originalquellen lesen, auf die sich der Beitrag stützt.",
  relatedLabel: "Weiterlesen",
  opensInNewTab: "Öffnet in einem neuen Tab",
  cautionContrast:
    "Ein Vergleich, keine Rangliste. Beides sind vollständige Arten, das zu tun — keine ist der Maßstab.",
  articleMissingTitle: "Dieser Beitrag ist nicht in der Bibliothek.",
  articleMissingBody:
    "Vielleicht wurde er verschoben. Geh zurück und wähle eine andere Entdeckung.",
  articleErrorTitle: "Dieser Beitrag wurde nicht geladen.",
  articleErrorBody: "Nichts ist verloren. Öffne ihn noch einmal.",
  periodContemporary: "Gegenwart",
  periodHistorical: "Geschichte",
  periodBoth: "Vergangenheit und Gegenwart",
  countryList: "Länder",
  languageList: "Sprachen",
  types: {
    feature: "Beitrag",
    note: "Notiz",
    language: "Sprache",
    scene: "Szene",
    contrast: "Gegenüberstellung",
    detail: "Detail",
  },
  categories: {
    "everyday-life": "Alltag",
    "social-behaviour": "Soziales Verhalten",
    languages: "Sprachen",
    communication: "Kommunikation",
    traditions: "Traditionen",
    "family-and-friendship": "Familie und Freundschaft",
    "food-and-hospitality": "Essen und Gastlichkeit",
    "work-and-education": "Arbeit und Bildung",
    "cities-and-community": "Stadt und Gemeinschaft",
    "music-and-dance": "Musik und Tanz",
    "games-and-leisure": "Spiele und Freizeit",
    storytelling: "Erzählen",
    "clothing-and-design": "Kleidung und Gestaltung",
    "nature-and-seasons": "Natur und Jahreszeiten",
    "beliefs-and-folklore": "Glauben und Erzählgut",
    "migration-and-identity": "Migration und Identität",
    "regional-humour": "Regionaler Humor",
    "cultural-change": "Kultureller Wandel",
  },
  continents: {
    africa: "Afrika",
    asia: "Asien",
    europe: "Europa",
    "north-america": "Nordamerika",
    "south-america": "Südamerika",
    oceania: "Ozeanien",
  },
};
const ar: CultureCopy = {
  sectionLabel: "الثقافة، مكتوبة",
  intro:
    "مكتبة اكتشافات مكتوبة: كيف يتكلّم الناس ويأكلون ويجتمعون ويتجادلون وينتمون. بمصادر، والسياق أولاً — بلا صور تُغني عن التفكير.",
  standfirst: "اقرأ على مهل. ثلاث دقائق تكفي لترى شيئاً مألوفاً على نحو آخر.",
  featuredLabel: "قراءة اليوم",
  feedLabel: "المكتبة",
  savedView: "المحفوظ",
  allView: "الكل",
  savedOnDevice: "محفوظ على هذا الجهاز",
  savedEmpty: "لا محفوظات بعد. احفظ نصاً فينتظرك هنا — المحفوظ يبقى على هذا الجهاز ويُفتح دون اتصال.",
  searchLabel: "ابحث في المكتبة",
  searchPlaceholder: "كلمة، مكان، عادة…",
  searching: "يبحث…",
  filtersLabel: "ضيِّق المكتبة",
  filterCategory: "الموضوع",
  filterContinent: "القارة",
  filterCountry: "البلد",
  filterLanguage: "اللغة",
  filterType: "الشكل",
  allCategories: "كل الموضوعات",
  allContinents: "كل القارات",
  allCountries: "كل البلدان",
  allLanguages: "كل اللغات",
  allTypes: "كل الأشكال",
  clearFilters: "امسح التصفية",
  anotherDiscovery: "اكتشاف آخر",
  more: "المزيد للقراءة",
  endOfFeed: "هذا كل ما في هذه الطبعة.",
  loading: "المكتبة تُفتح…",
  loadingMore: "الصفحات التالية في الطريق…",
  empty: "لا شيء يطابق هذا العرض بعد. جرّب كلمة أخرى أو أزل تصفية.",
  errorTitle: "لم تُفتح المكتبة الآن.",
  errorBody: "لم يضع شيء. أعد المحاولة بعد لحظة.",
  retry: "أعد المحاولة",
  offlineTitle: "أنت دون اتصال.",
  offlineBody: "المحفوظ يبقى مقروءاً، وتعود الصفحات الجديدة مع الاتصال.",
  catalogTitle: "هذه المكتبة غير متاحة بعد.",
  catalogBody: "لا يزال الفهرس قيد الإعداد. بقية الصفحة كما هي.",
  read: "اقرأ",
  readAria: "اقرأ {title}",
  save: "احفظ",
  saved: "محفوظ",
  saveAria: "احفظ {title}",
  savedAria: "أزل {title} من المحفوظات",
  close: "إغلاق",
  back: "رجوع",
  readingTime: "{minutes} دقائق قراءة",
  expressionLabel: "بالأصل",
  transliterationLabel: "كما تُقال",
  glossLabel: "المعنى",
  usageLabel: "متى تُقال",
  exampleLabel: "في الاستعمال",
  misunderstandingLabel: "فهم خاطئ شائع",
  comparisonLabel: "جنباً إلى جنب",
  contextLabel: "السياق",
  sourcesLabel: "المصادر",
  sourcesNote: "اقرأ المصادر الأصلية التي يستند إليها النص.",
  relatedLabel: "اقرأ أيضاً",
  opensInNewTab: "يُفتح في تبويب جديد",
  cautionContrast: "مقارنة، لا مفاضلة. كلٌّ منهما طريقة كاملة في فعل هذا — ولا واحدة هي الأصل.",
  articleMissingTitle: "هذا النص ليس في المكتبة.",
  articleMissingBody: "ربما انتقل. عُد واختر اكتشافاً آخر.",
  articleErrorTitle: "لم يُحمَّل هذا النص.",
  articleErrorBody: "لم يضع شيء. افتحه مرة أخرى.",
  periodContemporary: "معاصر",
  periodHistorical: "تاريخي",
  periodBoth: "ماضٍ وحاضر",
  countryList: "البلدان",
  languageList: "اللغات",
  types: {
    feature: "مقال موسّع",
    note: "ملاحظة",
    language: "لغة",
    scene: "مشهد",
    contrast: "مقابلة",
    detail: "تفصيل",
  },
  categories: {
    "everyday-life": "الحياة اليومية",
    "social-behaviour": "السلوك الاجتماعي",
    languages: "اللغات",
    communication: "التواصل",
    traditions: "التقاليد",
    "family-and-friendship": "العائلة والصداقة",
    "food-and-hospitality": "الطعام والضيافة",
    "work-and-education": "العمل والتعليم",
    "cities-and-community": "المدن والمجتمع",
    "music-and-dance": "الموسيقى والرقص",
    "games-and-leisure": "الألعاب والفراغ",
    storytelling: "الحكي",
    "clothing-and-design": "اللباس والتصميم",
    "nature-and-seasons": "الطبيعة والفصول",
    "beliefs-and-folklore": "المعتقدات والحكايات",
    "migration-and-identity": "الهجرة والهوية",
    "regional-humour": "الفكاهة المحلية",
    "cultural-change": "التغيّر الثقافي",
  },
  continents: {
    africa: "أفريقيا",
    asia: "آسيا",
    europe: "أوروبا",
    "north-america": "أمريكا الشمالية",
    "south-america": "أمريكا الجنوبية",
    oceania: "أوقيانوسيا",
  },
};
export const COPY: Record<CultureLocale, CultureCopy> = { en, de, ar };

/** Replaces {name} placeholders; a missing value becomes an empty string, never "undefined". */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? "" : String(value);
  });
}
