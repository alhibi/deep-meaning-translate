export interface Language {
  code: string;
  name: string;
  native: string;
  rtl?: boolean;
  aliases?: string[];
}

export const LANGUAGES: Language[] = [
  {
    code: "auto",
    name: "Detect language",
    native: "Detect",
    aliases: ["auto", "detect", "كشف", "erkennen", "تلقائي"],
  },
  {
    code: "ar",
    name: "Arabic",
    native: "العربية",
    rtl: true,
    aliases: ["arabi", "arabisch", "عربي", "عربية"],
  },
  {
    code: "de",
    name: "German",
    native: "Deutsch",
    aliases: ["deutsch", "german", "ألماني", "المانية", "الألمانية"],
  },
  {
    code: "en",
    name: "English",
    native: "English",
    aliases: ["englisch", "انجليزي", "إنجليزي", "الإنجليزية"],
  },
  { code: "fr", name: "French", native: "Français", aliases: ["französisch", "فرنسي", "الفرنسية"] },
  {
    code: "es",
    name: "Spanish",
    native: "Español",
    aliases: ["spanisch", "castellano", "اسباني", "الإسبانية"],
  },
  {
    code: "tr",
    name: "Turkish",
    native: "Türkçe",
    aliases: ["türkisch", "turkce", "تركي", "التركية"],
  },
  {
    code: "it",
    name: "Italian",
    native: "Italiano",
    aliases: ["italienisch", "ايطالي", "الإيطالية"],
  },
  {
    code: "nl",
    name: "Dutch",
    native: "Nederlands",
    aliases: ["niederländisch", "holländisch", "hollandsk", "هولندي"],
  },
  { code: "pt", name: "Portuguese", native: "Português", aliases: ["portugiesisch", "برتغالي"] },
  { code: "ru", name: "Russian", native: "Русский", aliases: ["russisch", "روسي"] },
  {
    code: "fa",
    name: "Persian",
    native: "فارسی",
    rtl: true,
    aliases: ["farsi", "persisch", "فارسي", "الفارسية"],
  },
  {
    code: "he",
    name: "Hebrew",
    native: "עברית",
    rtl: true,
    aliases: ["hebräisch", "عبري", "العبرية"],
  },
  { code: "ur", name: "Urdu", native: "اردو", rtl: true, aliases: ["urdu", "أردو"] },
  {
    code: "zh",
    name: "Chinese",
    native: "中文",
    aliases: ["chinesisch", "mandarin", "صيني", "الصينية"],
  },
  { code: "ja", name: "Japanese", native: "日本語", aliases: ["japanisch", "ياباني", "اليابانية"] },
];

export const TARGET_LANGUAGES = LANGUAGES.filter((l) => l.code !== "auto");

export function languageByCode(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function isRtl(code: string): boolean {
  return Boolean(languageByCode(code)?.rtl);
}

export function languageLabel(code: string): string {
  const l = languageByCode(code);
  return l ? l.native : code;
}
