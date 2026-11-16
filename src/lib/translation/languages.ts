export interface Language {
  code: string;
  /** English name — also the stable label used when Intl.DisplayNames is unavailable. */
  name: string;
  native: string;
  rtl?: boolean;
  /** Extra search terms: endonyms, common German/Arabic names and colloquial alternates. */
  aliases?: string[];
  /** Shown in the picker's short "Most used" section before the full alphabetical list. */
  popular?: boolean;
}

/**
 * The translator's language table. Every code is a two-letter ISO 639-1 code because the
 * server input schema, the session validators and the archive all store two-letter codes.
 * Native names are what a speaker expects to read; `name` and Intl.DisplayNames cover the
 * interface language. Order is deliberate: the designed pair first, then the most used
 * languages, then the rest alphabetically — the picker re-groups, it never guesses.
 */
const TABLE: Omit<Language, "popular">[] = [
  {
    code: "auto",
    name: "Detect language",
    native: "Detect",
    aliases: ["auto", "detect", "كشف", "erkennen", "تلقائي", "automatisch"],
  },
  {
    code: "ar",
    name: "Arabic",
    native: "العربية",
    rtl: true,
    aliases: ["arabic", "arabisch", "عربي", "عربية", "فصحى", "msa"],
  },
  {
    code: "de",
    name: "German",
    native: "Deutsch",
    aliases: ["deutsch", "german", "ألماني", "المانية", "الألمانية", "nemetski"],
  },
  {
    code: "en",
    name: "English",
    native: "English",
    aliases: ["englisch", "انجليزي", "إنجليزي", "الإنجليزية", "انكليزي"],
  },
  {
    code: "fr",
    name: "French",
    native: "Français",
    aliases: ["französisch", "francais", "فرنسي", "الفرنسية", "francophone"],
  },
  {
    code: "es",
    name: "Spanish",
    native: "Español",
    aliases: ["spanisch", "castellano", "castilian", "اسباني", "الإسبانية", "إسباني"],
  },
  {
    code: "it",
    name: "Italian",
    native: "Italiano",
    aliases: ["italienisch", "ايطالي", "الإيطالية", "إيطالي"],
  },
  {
    code: "tr",
    name: "Turkish",
    native: "Türkçe",
    aliases: ["türkisch", "turkce", "تركي", "التركية"],
  },
  {
    code: "ru",
    name: "Russian",
    native: "Русский",
    aliases: ["russisch", "روسي", "الروسية"],
  },
  {
    code: "zh",
    name: "Chinese",
    native: "中文",
    aliases: ["chinesisch", "mandarin", "cantonese", "صيني", "الصينية", "ماندرين"],
  },
  {
    code: "hi",
    name: "Hindi",
    native: "हिन्दी",
    aliases: ["hindi", "هندي", "الهندية"],
  },
  {
    code: "fa",
    name: "Persian",
    native: "فارسی",
    rtl: true,
    aliases: ["farsi", "persisch", "persian", "فارسي", "الفارسية"],
  },
  {
    code: "ur",
    name: "Urdu",
    native: "اردو",
    rtl: true,
    aliases: ["urdu", "أردو", "الأردية"],
  },
  {
    code: "pt",
    name: "Portuguese",
    native: "Português",
    aliases: ["portugiesisch", "portugues", "برتغالي", "البرتغالية", "brazilian"],
  },
  {
    code: "nl",
    name: "Dutch",
    native: "Nederlands",
    aliases: ["niederländisch", "holländisch", "hollandsk", "هولندي", "الهولندية"],
  },
  {
    code: "pl",
    name: "Polish",
    native: "Polski",
    aliases: ["polnisch", "polski", "بولندي", "البولندية"],
  },
  {
    code: "uk",
    name: "Ukrainian",
    native: "Українська",
    aliases: ["ukrainisch", "أوكراني", "الأوكرانية"],
  },
  {
    code: "ja",
    name: "Japanese",
    native: "日本語",
    aliases: ["japanisch", "ياباني", "اليابانية"],
  },
  {
    code: "ko",
    name: "Korean",
    native: "한국어",
    aliases: ["koreanisch", "كوري", "الكورية"],
  },
  {
    code: "id",
    name: "Indonesian",
    native: "Bahasa Indonesia",
    aliases: ["indonesisch", "إندونيسي", "الإندونيسية"],
  },
  {
    code: "vi",
    name: "Vietnamese",
    native: "Tiếng Việt",
    aliases: ["vietnamesisch", "فيتنامي", "الفيتنامية"],
  },
  {
    code: "sv",
    name: "Swedish",
    native: "Svenska",
    aliases: ["schwedisch", "سويدي", "السويدية"],
  },
  {
    code: "da",
    name: "Danish",
    native: "Dansk",
    aliases: ["dänisch", "دانماركي", "الدنماركية"],
  },
  {
    code: "no",
    name: "Norwegian",
    native: "Norsk",
    aliases: ["norwegisch", "bokmål", "bokmal", "نرويجي", "النرويجية"],
  },
  {
    code: "fi",
    name: "Finnish",
    native: "Suomi",
    aliases: ["finnisch", "فنلندي", "الفنلندية"],
  },
  {
    code: "cs",
    name: "Czech",
    native: "Čeština",
    aliases: ["tschechisch", "cestina", "تشيكي", "التشيكية"],
  },
  {
    code: "sk",
    name: "Slovak",
    native: "Slovenčina",
    aliases: ["slowakisch", "slovencina", "سلوفاكي", "السلوفاكية"],
  },
  {
    code: "hu",
    name: "Hungarian",
    native: "Magyar",
    aliases: ["ungarisch", "هنغاري", "المجرية"],
  },
  {
    code: "ro",
    name: "Romanian",
    native: "Română",
    aliases: ["rumänisch", "romana", "روماني", "الرومانية"],
  },
  {
    code: "bg",
    name: "Bulgarian",
    native: "Български",
    aliases: ["bulgarisch", "بلغاري", "البلغارية"],
  },
  {
    code: "el",
    name: "Greek",
    native: "Ελληνικά",
    aliases: ["griechisch", "يوناني", "اليونانية"],
  },
  {
    code: "he",
    name: "Hebrew",
    native: "עברית",
    rtl: true,
    aliases: ["hebräisch", "عبري", "العبرية"],
  },
  {
    code: "hr",
    name: "Croatian",
    native: "Hrvatski",
    aliases: ["kroatisch", "كرواتي", "الكرواتية"],
  },
  {
    code: "sr",
    name: "Serbian",
    native: "Српски",
    aliases: ["serbisch", "srpski", "صربي", "الصربية"],
  },
  {
    code: "bs",
    name: "Bosnian",
    native: "Bosanski",
    aliases: ["bosnisch", "بوسني", "البوسنية"],
  },
  {
    code: "sl",
    name: "Slovenian",
    native: "Slovenščina",
    aliases: ["slowenisch", "slovene", "سلوفيني", "السلوفينية"],
  },
  {
    code: "sq",
    name: "Albanian",
    native: "Shqip",
    aliases: ["albanisch", "ألباني", "الألبانية"],
  },
  {
    code: "mk",
    name: "Macedonian",
    native: "Македонски",
    aliases: ["mazedonisch", "مقدوني", "المقدونية"],
  },
  {
    code: "lt",
    name: "Lithuanian",
    native: "Lietuvių",
    aliases: ["litauisch", "ليتواني", "الليتوانية"],
  },
  {
    code: "lv",
    name: "Latvian",
    native: "Latviešu",
    aliases: ["lettisch", "لاتفي", "اللاتفية"],
  },
  {
    code: "et",
    name: "Estonian",
    native: "Eesti",
    aliases: ["estnisch", "إستوني", "الإستونية"],
  },
  {
    code: "is",
    name: "Icelandic",
    native: "Íslenska",
    aliases: ["isländisch", "آيسلندي", "الآيسلندية"],
  },
  {
    code: "ga",
    name: "Irish",
    native: "Gaeilge",
    aliases: ["irisch", "أيرلندي", "الأيرلندية"],
  },
  {
    code: "cy",
    name: "Welsh",
    native: "Cymraeg",
    aliases: ["walisisch", "ويلزي", "الويلزية"],
  },
  {
    code: "ca",
    name: "Catalan",
    native: "Català",
    aliases: ["katalanisch", "catalan", "كتالوني", "الكتالونية"],
  },
  {
    code: "gl",
    name: "Galician",
    native: "Galego",
    aliases: ["galicisch", "غاليكي", "الجاليكية"],
  },
  {
    code: "eu",
    name: "Basque",
    native: "Euskara",
    aliases: ["baskisch", "باسكي", "الباسكية"],
  },
  {
    code: "mt",
    name: "Maltese",
    native: "Malti",
    aliases: ["maltesisch", "مالطي", "المالطية"],
  },
  {
    code: "lb",
    name: "Luxembourgish",
    native: "Lëtzebuergesch",
    aliases: ["luxemburgisch", "لوكسمبورغي", "اللوكسمبورغية"],
  },
  {
    code: "af",
    name: "Afrikaans",
    native: "Afrikaans",
    aliases: ["afrikaans", "أفريكاني", "الأفريكانية"],
  },
  {
    code: "sw",
    name: "Swahili",
    native: "Kiswahili",
    aliases: ["suaheli", "swahili", "سواحيلي", "السواحيلية"],
  },
  {
    code: "am",
    name: "Amharic",
    native: "አማርኛ",
    aliases: ["amharisch", "أمهرية", "الأمهرية"],
  },
  {
    code: "so",
    name: "Somali",
    native: "Soomaali",
    aliases: ["somalisch", "صومالي", "الصومالية"],
  },
  {
    code: "ha",
    name: "Hausa",
    native: "Hausa",
    aliases: ["hausa", "هوسا", "الهوسا"],
  },
  {
    code: "yo",
    name: "Yoruba",
    native: "Yorùbá",
    aliases: ["yoruba", "يوروبا", "اليوروبا"],
  },
  {
    code: "ig",
    name: "Igbo",
    native: "Igbo",
    aliases: ["igbo", "إيغبو", "الإيغبو"],
  },
  {
    code: "zu",
    name: "Zulu",
    native: "isiZulu",
    aliases: ["zulu", "زولو", "الزولو"],
  },
  {
    code: "hy",
    name: "Armenian",
    native: "Հայերեն",
    aliases: ["armenisch", "أرميني", "الأرمينية"],
  },
  {
    code: "ka",
    name: "Georgian",
    native: "ქართული",
    aliases: ["georgisch", "جورجي", "الجورجية"],
  },
  {
    code: "az",
    name: "Azerbaijani",
    native: "Azərbaycanca",
    aliases: ["aserbaidschanisch", "اذربيجاني", "الأذربيجانية"],
  },
  {
    code: "kk",
    name: "Kazakh",
    native: "Қазақша",
    aliases: ["kasachisch", "كازاخي", "الكازاخية"],
  },
  {
    code: "uz",
    name: "Uzbek",
    native: "Oʻzbekcha",
    aliases: ["usbekisch", "أوزبكي", "الأوزبكية"],
  },
  {
    code: "mn",
    name: "Mongolian",
    native: "Монгол",
    aliases: ["mongolisch", "منغولي", "المنغولية"],
  },
  {
    code: "ne",
    name: "Nepali",
    native: "नेपाली",
    aliases: ["nepali", "نيبالي", "النيبالية"],
  },
  {
    code: "bn",
    name: "Bengali",
    native: "বাংলা",
    aliases: ["bengalisch", "بنغالي", "البنغالية"],
  },
  {
    code: "si",
    name: "Sinhala",
    native: "සිංහල",
    aliases: ["singhalesisch", "سنهالي", "السنهالية"],
  },
  {
    code: "th",
    name: "Thai",
    native: "ไทย",
    aliases: ["thailändisch", "تايلاندي", "التايلاندية"],
  },
  {
    code: "km",
    name: "Khmer",
    native: "ខ្មែរ",
    aliases: ["kambodschanisch", "خميري", "الخميرية"],
  },
  {
    code: "lo",
    name: "Lao",
    native: "ລາວ",
    aliases: ["laotisch", "لاوي", "اللاوية"],
  },
  {
    code: "my",
    name: "Burmese",
    native: "မြန်မာ",
    aliases: ["birmanisch", "بورمي", "البورمية"],
  },
  {
    code: "ms",
    name: "Malay",
    native: "Bahasa Melayu",
    aliases: ["malaiisch", "ماليزي", "الملايوية"],
  },
  {
    code: "tl",
    name: "Tagalog",
    native: "Tagalog",
    aliases: ["filipino", "tagalog", "فلبيني", "الفلبينية"],
  },
  {
    code: "jv",
    name: "Javanese",
    native: "Basa Jawa",
    aliases: ["javanisch", "جاوي", "الجاوية"],
  },
  {
    code: "ps",
    name: "Pashto",
    native: "پښتو",
    rtl: true,
    aliases: ["paschtu", "pashto", "بشتو", "البشتوية"],
  },
  {
    code: "ku",
    name: "Kurdish",
    native: "Kurdî",
    aliases: ["kurdisch", "kurmanji", "كردي", "الكردية"],
  },
  {
    code: "sd",
    name: "Sindhi",
    native: "سنڌي",
    rtl: true,
    aliases: ["sindhi", "سندي", "السندية"],
  },
  {
    code: "ug",
    name: "Uyghur",
    native: "ئۇيغۇرچە",
    rtl: true,
    aliases: ["uigurisch", "uyghur", "أويغوري", "الأويغورية"],
  },
  {
    code: "yi",
    name: "Yiddish",
    native: "ייִדיש",
    rtl: true,
    aliases: ["jiddisch", "yiddish", "يديشي", "اليديشية"],
  },
];

/** Languages offered in the picker's short section; the full list still contains everyone. */
const POPULAR = new Set([
  "ar",
  "de",
  "en",
  "fr",
  "es",
  "it",
  "tr",
  "ru",
  "zh",
  "hi",
  "fa",
  "ur",
  "pt",
  "pl",
  "uk",
  "id",
]);

export const LANGUAGES: Language[] = TABLE.map((l) => ({
  ...l,
  ...(POPULAR.has(l.code) ? { popular: true } : {}),
}));

export const TARGET_LANGUAGES = LANGUAGES.filter((l) => l.code !== "auto");

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));
const RTL = new Set(LANGUAGES.filter((l) => l.rtl).map((l) => l.code));

/** Accepts a bare code or a tagged one ("ar-SA") from speech detection or old storage. */
const base = (code: string) => (code || "").toLowerCase().split("-")[0] ?? "";

export function languageByCode(code: string): Language | undefined {
  return BY_CODE.get(base(code));
}

export function isRtl(code: string): boolean {
  return RTL.has(base(code));
}

/** Native name for a code; an unknown stored code is shown as itself rather than hidden. */
export function languageLabel(code: string): string {
  return languageByCode(code)?.native ?? code;
}

/**
 * A sensible other side for the pair, strongest first. The designed pair leads; English
 * is the useful third option. The picker offers these before the full list, and the
 * translator never changes the pair on its own — a suggestion is a tap away, not a rule.
 */
export function partnerCandidates(source: string): string[] {
  if (source === "ar") return ["de", "en"];
  if (source === "de") return ["ar", "en"];
  if (source === "en") return ["ar", "de"];
  return ["ar", "de"];
}

/**
 * One search normalization shared by the picker and its tests: case, diacritics,
 * Arabic hamza/alef forms, teh marbuta, tatweel and final-form differences all collapse,
 * so "الالمانية", "الألمانية" and "deutsch" find the same row.
 */
export function normalizeLanguageQuery(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}
