import { useSyncExternalStore } from "react";

export type Locale = "ar" | "en" | "de";
export const LOCALES: Locale[] = ["ar", "en", "de"];
export const LOCALE_SHORT: Record<Locale, string> = { ar: "ع", en: "EN", de: "DE" };
export const LOCALE_NAME: Record<Locale, string> = { ar: "العربية", en: "English", de: "Deutsch" };

const en = {
  recent: "Recent translations",
  recentShort: "Recent",
  closeRecent: "Close recent translations",
  close: "Close",
  clear: "Clear",
  empty: "Nothing here yet.",
  privacy:
    "Recent translations, your draft and language choice are kept only on this device. Text is sent for translation and not stored on our side.",
  forgetAll: "Delete everything on this device",
  placeholder: "Write or paste anything",
  inputLabel: "Text to translate",
  clearText: "Clear text",
  pasteCopied: "Translate copied text",
  install: "Install",
  sourceLang: "Source language",
  targetLang: "Target language",
  swap: "Swap languages",
  detect: "Detect",
  auto: "Auto",
  style: "Translation style",
  natural: "Natural",
  formal: "Formal",
  casual: "Casual",
  ready: "Translation ready",
  hideAlt: "Hide other reading",
  showAlt: "This could also mean…",
  copy: "Copy translation",
  copied: "Copied",
  listen: "Listen",
  stop: "Stop",
  share: "Share",
  retry: "Retry",
  offline: "Offline",
  tryAgain: "Try again",
  idle: "Translation appears here.",
  uiLanguage: "Interface language",
  err_auth: "Translation isn't connected yet.",
  err_quota: "The translation account is out of credit.",
  err_rate: "A lot of requests at once. Give it a moment.",
  err_network: "The connection dropped before the translation finished.",
  err_timeout: "That took too long. Your text is still here.",
  err_offline: "You're offline. Your text is safe — translation resumes when you're back.",
  err_provider: "Something interrupted the translation.",
  err_input: "That text couldn't be translated as written.",
};
export type Key = keyof typeof en;

const ar: Record<Key, string> = {
  recent: "الترجمات الأخيرة",
  recentShort: "الأخيرة",
  closeRecent: "إغلاق الترجمات الأخيرة",
  close: "إغلاق",
  clear: "مسح",
  empty: "لا شيء هنا بعد.",
  privacy:
    "تُحفظ الترجمات الأخيرة ومسوّدتك واختيار اللغة على هذا الجهاز فقط. يُرسل النص للترجمة ولا نحتفظ به.",
  forgetAll: "حذف كل شيء من هذا الجهاز",
  placeholder: "اكتب أو الصق أي نص",
  inputLabel: "النص المراد ترجمته",
  clearText: "مسح النص",
  pasteCopied: "ترجمة النص المنسوخ",
  install: "تثبيت",
  sourceLang: "لغة المصدر",
  targetLang: "اللغة الهدف",
  swap: "تبديل اللغتين",
  detect: "تلقائي",
  auto: "كشف تلقائي",
  style: "أسلوب الترجمة",
  natural: "طبيعي",
  formal: "رسمي",
  casual: "عفوي",
  ready: "الترجمة جاهزة",
  hideAlt: "إخفاء المعنى الآخر",
  showAlt: "قد تعني أيضاً…",
  copy: "نسخ الترجمة",
  copied: "تم النسخ",
  listen: "استماع",
  stop: "إيقاف",
  share: "مشاركة",
  retry: "إعادة",
  offline: "دون اتصال",
  tryAgain: "حاول مجدداً",
  idle: "ستظهر الترجمة هنا.",
  uiLanguage: "لغة الواجهة",
  err_auth: "خدمة الترجمة غير متصلة بعد.",
  err_quota: "نفد رصيد حساب الترجمة.",
  err_rate: "طلبات كثيرة في وقت واحد. لحظة من فضلك.",
  err_network: "انقطع الاتصال قبل اكتمال الترجمة.",
  err_timeout: "استغرق الأمر وقتاً طويلاً. نصّك ما زال هنا.",
  err_offline: "أنت دون اتصال. نصّك محفوظ، وستُستأنف الترجمة عند عودة الاتصال.",
  err_provider: "حدث ما قطع الترجمة.",
  err_input: "تعذّرت ترجمة هذا النص كما كُتب.",
};

const de: Record<Key, string> = {
  recent: "Letzte Übersetzungen",
  recentShort: "Zuletzt",
  closeRecent: "Letzte Übersetzungen schließen",
  close: "Schließen",
  clear: "Leeren",
  empty: "Noch nichts hier.",
  privacy:
    "Letzte Übersetzungen, dein Entwurf und deine Sprachwahl bleiben nur auf diesem Gerät. Text wird zur Übersetzung gesendet und bei uns nicht gespeichert.",
  forgetAll: "Alles auf diesem Gerät löschen",
  placeholder: "Schreib oder füge etwas ein",
  inputLabel: "Zu übersetzender Text",
  clearText: "Text löschen",
  pasteCopied: "Kopierten Text übersetzen",
  install: "Installieren",
  sourceLang: "Ausgangssprache",
  targetLang: "Zielsprache",
  swap: "Sprachen tauschen",
  detect: "Erkennen",
  auto: "Automatisch",
  style: "Übersetzungsstil",
  natural: "Natürlich",
  formal: "Förmlich",
  casual: "Locker",
  ready: "Übersetzung fertig",
  hideAlt: "Andere Lesart ausblenden",
  showAlt: "Könnte auch bedeuten …",
  copy: "Übersetzung kopieren",
  copied: "Kopiert",
  listen: "Anhören",
  stop: "Stopp",
  share: "Teilen",
  retry: "Erneut",
  offline: "Offline",
  tryAgain: "Erneut versuchen",
  idle: "Die Übersetzung erscheint hier.",
  uiLanguage: "Sprache der Oberfläche",
  err_auth: "Die Übersetzung ist noch nicht verbunden.",
  err_quota: "Das Übersetzungskonto hat kein Guthaben mehr.",
  err_rate: "Gerade viele Anfragen auf einmal. Einen Moment bitte.",
  err_network: "Die Verbindung brach ab, bevor die Übersetzung fertig war.",
  err_timeout: "Das hat zu lange gedauert. Dein Text ist noch da.",
  err_offline: "Du bist offline. Dein Text ist sicher – die Übersetzung geht weiter, sobald du wieder online bist.",
  err_provider: "Etwas hat die Übersetzung unterbrochen.",
  err_input: "Dieser Text ließ sich so nicht übersetzen.",
};

const DICT: Record<Locale, Record<Key, string>> = { en, ar, de };
const STORAGE = "lingua.ui-locale";

let current: Locale = "en";
const listeners = new Set<() => void>();

function apply(l: Locale) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.lang = l;
  html.dir = l === "ar" ? "rtl" : "ltr";
}

function detectInitial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE) as Locale | null;
    if (saved && LOCALES.includes(saved)) return saved;
  } catch {}
  const nav = (navigator.languages ?? [navigator.language]).map((x) => x.slice(0, 2).toLowerCase());
  return (nav.find((x) => LOCALES.includes(x as Locale)) as Locale) ?? "en";
}

let started = false;
export function initLocale() {
  if (started || typeof window === "undefined") return;
  started = true;
  setLocale(detectInitial(), false);
}

export function setLocale(l: Locale, save = true) {
  current = l;
  apply(l);
  if (save) {
    try {
      localStorage.setItem(STORAGE, l);
    } catch {}
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, () => current, () => "en" as Locale);
  const dict = DICT[locale];
  return { locale, t: (k: Key) => dict[k], rtl: locale === "ar" };
}
