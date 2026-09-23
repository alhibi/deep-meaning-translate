export interface Language {
  code: string;
  name: string;
  native: string;
  rtl?: boolean;
}

export const LANGUAGES: Language[] = [
  { code: "auto", name: "Detect language", native: "Detect" },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "en", name: "English", native: "English" },
  { code: "fr", name: "French", native: "Français" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "fa", name: "Persian", native: "فارسی", rtl: true },
  { code: "he", name: "Hebrew", native: "עברית", rtl: true },
  { code: "ur", name: "Urdu", native: "اردو", rtl: true },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ja", name: "Japanese", native: "日本語" },
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
