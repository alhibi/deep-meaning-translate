import type { CultureCategory, CultureContinent, CultureLocale } from "@/lib/culture/types";

/**
 * Feature copy for the discovery section.
 *
 * The section owns its words locally (the same precedent as DataControls/ProviderKey):
 * `i18n.ts` is the shell's dictionary and is not touched by a feature that may ship
 * independently. Every locale carries the same keys, so a missing translation is a
 * type error rather than an English sentence in an Arabic page.
 */
export interface CultureCopy {
  /** Small editorial label above the introduction. */
  sectionLabel: string;
  /** The one quiet sentence that introduces the section. */
  introLine: string;
  featuredLabel: string;
  /** Accessible name for the feed region. */
  feedLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  filtersLabel: string;
  filterCategory: string;
  filterContinent: string;
  filterCountry: string;
  allCategories: string;
  allContinents: string;
  allCountries: string;
  clearFilters: string;
  allItems: string;
  savedView: string;
  savedOnDevice: string;
  savedEmpty: string;
  savedUncached: string;
  empty: string;
  loading: string;
  loadingMore: string;
  more: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  offlineTitle: string;
  offlineBody: string;
  saveLabel: string;
  unsaveLabel: string;
  detailClose: string;
  summaryLabel: string;
  provenanceInstitution: string;
  provenanceMachine: string;
  provenanceEditorial: string;
  whyDistinctive: string;
  placeLabel: string;
  sourceLabel: string;
  licenseLabel: string;
  attributionLabel: string;
  imageCreditLabel: string;
  rightsLabel: string;
  relatedLabel: string;
  periodLabel: string;
  subjectLabel: string;
  communityLabel: string;
  tagsLabel: string;
  detailLoading: string;
  detailError: string;
  originalLanguageLabel: string;
  modifiedLabel: string;
  opensInNewTab: string;
  categories: Record<CultureCategory, string>;
  continents: Record<CultureContinent, string>;
}

const en: CultureCopy = {
  sectionLabel: "Culture in context",
  introLine:
    "Discoveries from cultures around the world — each one sourced, credited and told in its own language.",
  featuredLabel: "Featured",
  feedLabel: "Discoveries",
  searchLabel: "Search discoveries",
  searchPlaceholder: "Search a place, a craft, a word…",
  filtersLabel: "Filters",
  filterCategory: "Category",
  filterContinent: "Continent",
  filterCountry: "Country",
  allCategories: "All categories",
  allContinents: "All continents",
  allCountries: "All countries",
  clearFilters: "Clear filters",
  allItems: "Discoveries",
  savedView: "Saved",
  savedOnDevice: "Saved on this device",
  savedEmpty:
    "Nothing saved yet. Use the bookmark on any discovery to keep it here — saved items stay on this device and open without a connection.",
  savedUncached:
    "Saved items are kept on this device, but their records are not available here yet.",
  empty: "Nothing matches this view yet. Clear a filter or try another word.",
  loading: "Gathering discoveries…",
  loadingMore: "Loading more…",
  more: "More discoveries",
  errorTitle: "The discoveries didn't load just now.",
  errorBody: "Nothing was lost. Try again in a moment.",
  retry: "Try again",
  offlineTitle: "You're offline.",
  offlineBody: "Saved discoveries stay available. New ones appear when you're back online.",
  saveLabel: "Save discovery",
  unsaveLabel: "Remove from saved",
  detailClose: "Close",
  summaryLabel: "Summary",
  provenanceInstitution: "Institutional description",
  provenanceMachine: "AI-assisted editorial",
  provenanceEditorial: "Editorially reviewed",
  whyDistinctive: "Why it is distinctive",
  placeLabel: "Place",
  sourceLabel: "Source",
  licenseLabel: "Licence",
  attributionLabel: "Attribution",
  imageCreditLabel: "Image",
  rightsLabel: "Rights",
  relatedLabel: "Related",
  periodLabel: "Period",
  subjectLabel: "Subject",
  communityLabel: "Community",
  tagsLabel: "Tags",
  detailLoading: "Reading the record…",
  detailError: "This record didn't load.",
  originalLanguageLabel: "In the original",
  modifiedLabel: "Source last updated",
  opensInNewTab: "Opens in a new tab",
  categories: {
    traditions: "Traditions",
    architecture: "Architecture",
    "indigenous-knowledge": "Indigenous knowledge",
    crafts: "Crafts",
    textiles: "Textiles",
    "food-culture": "Food culture",
    ingredients: "Ingredients",
    music: "Music",
    dance: "Dance",
    festivals: "Festivals",
    storytelling: "Storytelling",
    language: "Language",
    untranslatable: "Untranslatable",
    games: "Games",
    tools: "Tools",
    astronomy: "Astronomy",
    agriculture: "Agriculture",
    trade: "Trade",
    landscapes: "Landscapes",
    "medicine-knowledge": "Traditional medicine",
    "ritual-objects": "Ritual objects",
    "endangered-crafts": "Endangered crafts",
    design: "Design",
    "everyday-life": "Everyday life",
    objects: "Objects",
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

const ar: CultureCopy = {
  sectionLabel: "الثقافة في سياقها",
  introLine: "اكتشافات من ثقافات العالم: كل واحدة بمصدرها ونسبتها، ومرويّة بلغتها.",
  featuredLabel: "مختارة",
  feedLabel: "الاكتشافات",
  searchLabel: "ابحث في الاكتشافات",
  searchPlaceholder: "ابحث عن مكان أو حرفة أو كلمة…",
  filtersLabel: "تصفية",
  filterCategory: "الفئة",
  filterContinent: "القارة",
  filterCountry: "البلد",
  allCategories: "كل الفئات",
  allContinents: "كل القارات",
  allCountries: "كل البلدان",
  clearFilters: "مسح التصفية",
  allItems: "الاكتشافات",
  savedView: "المحفوظات",
  savedOnDevice: "محفوظة على هذا الجهاز",
  savedEmpty:
    "لا محفوظات بعد. استخدم علامة الحفظ على أي اكتشاف للاحتفاظ به هنا — تبقى المحفوظات على هذا الجهاز وتُفتح دون اتصال.",
  savedUncached: "المحفوظات محفوظة على هذا الجهاز، لكن سجلاتها غير متاحة هنا بعد.",
  empty: "لا شيء يطابق هذا العرض الآن. امسح تصفية أو جرّب كلمة أخرى.",
  loading: "تُجمع الاكتشافات…",
  loadingMore: "يُحمَّل المزيد…",
  more: "المزيد من الاكتشافات",
  errorTitle: "لم تُحمَّل الاكتشافات الآن.",
  errorBody: "لم يضِع شيء. أعد المحاولة بعد لحظة.",
  retry: "أعد المحاولة",
  offlineTitle: "أنت غير متصل.",
  offlineBody: "تبقى الاكتشافات المحفوظة متاحة، وتعود الجديدة عند عودة الاتصال.",
  saveLabel: "احفظ الاكتشاف",
  unsaveLabel: "أزل من المحفوظات",
  detailClose: "إغلاق",
  summaryLabel: "الملخص",
  provenanceInstitution: "وصف المؤسسة",
  provenanceMachine: "تحرير بمساعدة الذكاء الاصطناعي",
  provenanceEditorial: "تحرير مُراجَع",
  whyDistinctive: "لماذا هي مميّزة",
  placeLabel: "المكان",
  sourceLabel: "المصدر",
  licenseLabel: "الترخيص",
  attributionLabel: "الإسناد",
  imageCreditLabel: "الصورة",
  rightsLabel: "الحقوق",
  relatedLabel: "ذات صلة",
  periodLabel: "الحقبة",
  subjectLabel: "الموضوع",
  communityLabel: "المجتمع",
  tagsLabel: "الوسوم",
  detailLoading: "يُقرأ السجل…",
  detailError: "لم يُحمَّل هذا السجل.",
  originalLanguageLabel: "بالأصل",
  modifiedLabel: "آخر تحديث للمصدر",
  opensInNewTab: "يُفتح في تبويب جديد",
  categories: {
    traditions: "تقاليد",
    architecture: "عمارة",
    "indigenous-knowledge": "معرفة السكان الأصليين",
    crafts: "حِرف",
    textiles: "منسوجات",
    "food-culture": "ثقافة الطعام",
    ingredients: "مكوّنات",
    music: "موسيقى",
    dance: "رقص",
    festivals: "مهرجانات",
    storytelling: "حكي",
    language: "لغة",
    untranslatable: "ما لا يُترجم",
    games: "ألعاب",
    tools: "أدوات",
    astronomy: "فلك",
    agriculture: "زراعة",
    trade: "تجارة",
    landscapes: "مشاهد طبيعية",
    "medicine-knowledge": "طب تقليدي",
    "ritual-objects": "أدوات طقسية",
    "endangered-crafts": "حِرف مهدَّدة",
    design: "تصميم",
    "everyday-life": "حياة يومية",
    objects: "مقتنيات",
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

const de: CultureCopy = {
  sectionLabel: "Kultur im Kontext",
  introLine:
    "Entdeckungen aus Kulturen der Welt — jede mit Quelle, Namensnennung und in ihrer eigenen Sprache.",
  featuredLabel: "Hervorgehoben",
  feedLabel: "Entdeckungen",
  searchLabel: "Entdeckungen durchsuchen",
  searchPlaceholder: "Ort, Handwerk oder Wort suchen…",
  filtersLabel: "Filtern",
  filterCategory: "Kategorie",
  filterContinent: "Kontinent",
  filterCountry: "Land",
  allCategories: "Alle Kategorien",
  allContinents: "Alle Kontinente",
  allCountries: "Alle Länder",
  clearFilters: "Filter löschen",
  allItems: "Entdeckungen",
  savedView: "Gespeichert",
  savedOnDevice: "Auf diesem Gerät gespeichert",
  savedEmpty:
    "Noch nichts gespeichert. Mit dem Lesezeichen bleibt jede Entdeckung hier — gespeicherte Einträge bleiben auf diesem Gerät und öffnen sich ohne Verbindung.",
  savedUncached:
    "Gespeicherte Einträge liegen auf diesem Gerät, ihre Datensätze sind hier aber noch nicht verfügbar.",
  empty:
    "Nichts passt gerade zu dieser Ansicht. Entferne einen Filter oder versuche ein anderes Wort.",
  loading: "Entdeckungen werden gesammelt…",
  loadingMore: "Weitere werden geladen…",
  more: "Mehr Entdeckungen",
  errorTitle: "Die Entdeckungen wurden gerade nicht geladen.",
  errorBody: "Nichts ist verloren. Versuch es gleich noch einmal.",
  retry: "Erneut versuchen",
  offlineTitle: "Du bist offline.",
  offlineBody:
    "Gespeicherte Entdeckungen bleiben verfügbar. Neue erscheinen wieder, sobald du online bist.",
  saveLabel: "Entdeckung merken",
  unsaveLabel: "Aus Gespeichertem entfernen",
  detailClose: "Schließen",
  summaryLabel: "Zusammenfassung",
  provenanceInstitution: "Beschreibung der Institution",
  provenanceMachine: "KI-gestützte Redaktion",
  provenanceEditorial: "Redaktionell geprüft",
  whyDistinctive: "Was sie besonders macht",
  placeLabel: "Ort",
  sourceLabel: "Quelle",
  licenseLabel: "Lizenz",
  attributionLabel: "Namensnennung",
  imageCreditLabel: "Bild",
  rightsLabel: "Rechte",
  relatedLabel: "Verwandt",
  periodLabel: "Zeitraum",
  subjectLabel: "Motiv",
  communityLabel: "Gemeinschaft",
  tagsLabel: "Schlagworte",
  detailLoading: "Eintrag wird gelesen…",
  detailError: "Dieser Eintrag wurde nicht geladen.",
  originalLanguageLabel: "Im Original",
  modifiedLabel: "Quelle zuletzt aktualisiert",
  opensInNewTab: "Wird in einem neuen Tab geöffnet",
  categories: {
    traditions: "Traditionen",
    architecture: "Architektur",
    "indigenous-knowledge": "Indigenes Wissen",
    crafts: "Handwerk",
    textiles: "Textilien",
    "food-culture": "Esskultur",
    ingredients: "Zutaten",
    music: "Musik",
    dance: "Tanz",
    festivals: "Feste",
    storytelling: "Erzählkultur",
    language: "Sprache",
    untranslatable: "Unübersetzbar",
    games: "Spiele",
    tools: "Werkzeuge",
    astronomy: "Astronomie",
    agriculture: "Landwirtschaft",
    trade: "Handel",
    landscapes: "Landschaften",
    "medicine-knowledge": "Traditionelle Medizin",
    "ritual-objects": "Ritualgegenstände",
    "endangered-crafts": "Bedrohtes Handwerk",
    design: "Design",
    "everyday-life": "Alltag",
    objects: "Objekte",
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

export const COPY: Record<CultureLocale, CultureCopy> = { ar, de, en };

export function cultureCopy(locale: CultureLocale): CultureCopy {
  return COPY[locale];
}
