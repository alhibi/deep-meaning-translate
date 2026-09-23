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
  placeholder: "Write something…",
  inputLabel: "Text to translate",
  clearText: "Clear text",
  pasteCopied: "Paste & translate",
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
  copyShort: "Copy",
  listen: "Listen",
  stop: "Stop",
  share: "Share",
  retry: "Retry",
  offline: "Offline",
  tryAgain: "Try again",
  idle: "Your translation will appear here",
  uiLanguage: "Interface language",
  langSearch: "Search languages",
  langRecent: "Recent",
  langAll: "All languages",
  langNone: "No matching language",
  from: "From",
  to: "To",
  paste: "Paste",
  live: "Live",
  err_auth: "Translation isn't connected yet.",
  err_quota: "The translation account is out of credit.",
  err_rate: "A lot of requests at once. Give it a moment.",
  err_network: "The connection dropped before the translation finished.",
  err_timeout: "That took too long. Your text is still here.",
  err_offline: "You're offline. Your text is safe — translation resumes when you're back.",
  err_provider: "Something interrupted the translation.",
  err_input: "That text couldn't be translated as written.",
  save: "Save",
  unsave: "Saved",
  savedTitle: "Saved",
  savedEmpty: "Save a translation with the bookmark and it lands here — your own phrasebook, kept only on this device.",
  review: "Review",
  reveal: "Tap to see the translation",
  again: "Again",
  knewIt: "I knew it",
  reviewDone: "All reviewed for now.",
  reviewAgain: "Review again",
  remove: "Remove",
  phraseOfDay: "Phrase of the day",
  dialect: "Arabic dialect",
  d_auto: "Arabic",
  d_msa: "Standard (Fusha)",
  d_levant: "Levantine",
  d_egypt: "Egyptian",
  d_gulf: "Gulf",
  d_iraq: "Iraqi",
  d_maghreb: "Maghrebi",
  sit_official: "Sounds official — make it formal?",
  sit_work: "Sounds like work — make it formal?",
  sit_chat: "Sounds personal — make it casual?",
  sit_apply: "Switch",
  sit_dismiss: "Dismiss",
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
  placeholder: "اكتب شيئاً…",
  inputLabel: "النص المراد ترجمته",
  clearText: "مسح النص",
  pasteCopied: "لصق وترجمة",
  install: "تثبيت",
  sourceLang: "لغة المصدر",
  targetLang: "اللغة الهدف",
  swap: "تبديل اللغتين",
  detect: "كشف اللغة",
  auto: "تلقائي",
  style: "أسلوب الترجمة",
  natural: "طبيعي",
  formal: "رسمي",
  casual: "عفوي",
  ready: "الترجمة جاهزة",
  hideAlt: "إخفاء المعنى الآخر",
  showAlt: "قد تعني أيضاً…",
  copy: "نسخ الترجمة",
  copied: "تم النسخ",
  copyShort: "نسخ",
  listen: "استماع",
  stop: "إيقاف",
  share: "مشاركة",
  retry: "إعادة",
  offline: "دون اتصال",
  tryAgain: "حاول مجدداً",
  idle: "ستظهر ترجمتك هنا",
  uiLanguage: "لغة الواجهة",
  langSearch: "ابحث عن لغة",
  langRecent: "الأخيرة",
  langAll: "كل اللغات",
  langNone: "لا توجد لغة مطابقة",
  from: "من",
  to: "إلى",
  paste: "لصق",
  live: "مباشر",
  err_auth: "خدمة الترجمة غير متصلة بعد.",
  err_quota: "نفد رصيد حساب الترجمة.",
  err_rate: "طلبات كثيرة في وقت واحد. لحظة من فضلك.",
  err_network: "انقطع الاتصال قبل اكتمال الترجمة.",
  err_timeout: "استغرق الأمر وقتاً طويلاً. نصّك ما زال هنا.",
  err_offline: "أنت دون اتصال. نصّك محفوظ، وستُستأنف الترجمة عند عودة الاتصال.",
  err_provider: "حدث ما قطع الترجمة.",
  err_input: "تعذّرت ترجمة هذا النص كما كُتب.",
  save: "حفظ",
  unsave: "محفوظة",
  savedTitle: "المحفوظة",
  savedEmpty: "احفظ أي ترجمة بعلامة الحفظ لتظهر هنا — دفتر عباراتك الخاص، يبقى على هذا الجهاز فقط.",
  review: "مراجعة",
  reveal: "اضغط لترى الترجمة",
  again: "مرة أخرى",
  knewIt: "عرفتها",
  reviewDone: "راجعت كل شيء الآن.",
  reviewAgain: "راجع من جديد",
  remove: "حذف",
  phraseOfDay: "عبارة اليوم",
  dialect: "اللهجة العربية",
  d_auto: "العربية",
  d_msa: "الفصحى",
  d_levant: "الشامية",
  d_egypt: "المصرية",
  d_gulf: "الخليجية",
  d_iraq: "العراقية",
  d_maghreb: "المغاربية",
  sit_official: "يبدو نصاً رسمياً — أجعلها رسمية؟",
  sit_work: "يبدو نص عمل — أجعلها رسمية؟",
  sit_chat: "يبدو نصاً شخصياً — أجعلها ودّية؟",
  sit_apply: "غيّر",
  sit_dismiss: "تجاهل",
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
  placeholder: "Schreib etwas …",
  inputLabel: "Zu übersetzender Text",
  clearText: "Text löschen",
  pasteCopied: "Einfügen",
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
  copyShort: "Kopieren",
  listen: "Anhören",
  stop: "Stopp",
  share: "Teilen",
  retry: "Erneut",
  offline: "Offline",
  tryAgain: "Erneut versuchen",
  idle: "Hier erscheint deine Übersetzung",
  uiLanguage: "Sprache der Oberfläche",
  langSearch: "Sprache suchen",
  langRecent: "Zuletzt",
  langAll: "Alle Sprachen",
  langNone: "Keine passende Sprache",
  from: "Von",
  to: "Nach",
  paste: "Einfügen",
  live: "Live",
  err_auth: "Die Übersetzung ist noch nicht verbunden.",
  err_quota: "Das Übersetzungskonto hat kein Guthaben mehr.",
  err_rate: "Gerade viele Anfragen auf einmal. Einen Moment bitte.",
  err_network: "Die Verbindung brach ab, bevor die Übersetzung fertig war.",
  err_timeout: "Das hat zu lange gedauert. Dein Text ist noch da.",
  err_offline: "Du bist offline. Dein Text ist sicher – die Übersetzung geht weiter, sobald du wieder online bist.",
  err_provider: "Etwas hat die Übersetzung unterbrochen.",
  err_input: "Dieser Text ließ sich so nicht übersetzen.",
  save: "Merken",
  unsave: "Gemerkt",
  savedTitle: "Gemerkt",
  savedEmpty: "Merke dir eine Übersetzung mit dem Lesezeichen – dein eigenes Phrasenbuch, nur auf diesem Gerät.",
  review: "Üben",
  reveal: "Tippen, um die Übersetzung zu sehen",
  again: "Nochmal",
  knewIt: "Wusste ich",
  reviewDone: "Für jetzt alles geübt.",
  reviewAgain: "Nochmal üben",
  remove: "Entfernen",
  phraseOfDay: "Satz des Tages",
  dialect: "Arabischer Dialekt",
  d_auto: "Arabisch",
  d_msa: "Hocharabisch",
  d_levant: "Levantinisch",
  d_egypt: "Ägyptisch",
  d_gulf: "Golf-Arabisch",
  d_iraq: "Irakisch",
  d_maghreb: "Maghrebinisch",
  sit_official: "Klingt offiziell – förmlich übersetzen?",
  sit_work: "Klingt nach Arbeit – förmlich übersetzen?",
  sit_chat: "Klingt persönlich – locker übersetzen?",
  sit_apply: "Wechseln",
  sit_dismiss: "Schließen",
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
