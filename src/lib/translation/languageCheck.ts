/**
 * Does the text actually look like the source language the user picked?
 * Pure and local: writing system first (unambiguous), then distinctive letters
 * and very common words for Latin-script languages, then the model's own
 * detection from a finished translation. Built to stay quiet when unsure —
 * a wrong warning is worse than none.
 */

type Script = "arabic" | "hebrew" | "cyrillic" | "kana" | "han" | "hangul" | "latin";

const SCRIPT_RE: [Script, RegExp][] = [
  ["arabic", /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u],
  ["hebrew", /[\u0590-\u05FF]/u],
  ["cyrillic", /[\u0400-\u04FF]/u],
  ["kana", /[\u3040-\u30FF]/u],
  ["han", /[\u4E00-\u9FFF]/u],
  ["hangul", /[\uAC00-\uD7AF]/u],
  ["latin", /[A-Za-z\u00C0-\u024F]/u],
];

/** Languages each writing system can be (only those the app offers). */
const FAMILY: Record<Script, string[]> = {
  arabic: ["ar", "fa", "ur"],
  hebrew: ["he"],
  cyrillic: ["ru"],
  kana: ["ja"],
  han: ["zh", "ja"],
  hangul: [],
  latin: ["de", "en", "fr", "es", "tr", "it", "nl", "pt"],
};

/** Dominant writing system, only when it clearly carries the text (≥ 70% of letters). */
export function dominantScript(text: string): { script: Script; letters: number } | null {
  const counts = new Map<Script, number>();
  let letters = 0;
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    const hit = SCRIPT_RE.find(([, re]) => re.test(ch));
    if (hit) counts.set(hit[0], (counts.get(hit[0]) ?? 0) + 1);
  }
  if (letters < 2) return null;
  // Japanese mixes kana with kanji: any kana makes it Japanese.
  if (
    (counts.get("kana") ?? 0) > 0 &&
    (counts.get("kana") ?? 0) + (counts.get("han") ?? 0) >= letters * 0.7
  )
    return { script: "kana", letters };
  let best: Script | null = null;
  let n = 0;
  for (const [s, c] of counts) if (c > n) [best, n] = [s, c];
  return best && n >= letters * 0.7 ? { script: best, letters } : null;
}

/** Arabic, Persian or Urdu from letters only these languages use. */
function arabicScriptLanguage(text: string): { code: string; strong: boolean } {
  const urdu = (text.match(/[ٹڈڑںےۓ]/gu) ?? []).length;
  const persian = (text.match(/[پچژگکی]/gu) ?? []).length;
  const arabic = (text.match(/[ةىيك]/gu) ?? []).length;
  if (urdu > 0 && urdu >= arabic) return { code: "ur", strong: true };
  if (persian > 0 && persian > arabic) return { code: "fa", strong: true };
  return { code: "ar", strong: arabic > 0 };
}

/** Very common short words; distinctive enough to separate the Latin-script languages. */
const COMMON: Record<string, string[]> = {
  de: [
    "ich",
    "nicht",
    "und",
    "ist",
    "das",
    "der",
    "die",
    "du",
    "wir",
    "bist",
    "mit",
    "auf",
    "ein",
    "eine",
    "zu",
    "es",
    "sie",
    "wie",
    "was",
    "wo",
    "geht",
    "habe",
    "heute",
    "morgen",
    "danke",
    "bitte",
    "auch",
    "noch",
    "aber",
    "dich",
    "mir",
    "mich",
  ],
  en: [
    "the",
    "and",
    "is",
    "you",
    "are",
    "i'm",
    "it's",
    "what",
    "where",
    "how",
    "this",
    "that",
    "with",
    "have",
    "not",
    "my",
    "your",
    "today",
    "tomorrow",
    "thanks",
    "please",
    "would",
    "can",
    "will",
    "do",
    "don't",
    "of",
  ],
  fr: [
    "je",
    "tu",
    "nous",
    "vous",
    "est",
    "les",
    "des",
    "une",
    "pas",
    "c'est",
    "très",
    "avec",
    "pour",
    "dans",
    "merci",
    "suis",
    "bonjour",
    "aujourd'hui",
    "oui",
    "mais",
    "qui",
    "que",
  ],
  es: [
    "el",
    "los",
    "las",
    "una",
    "es",
    "está",
    "estoy",
    "muy",
    "para",
    "con",
    "por",
    "que",
    "qué",
    "gracias",
    "hola",
    "hoy",
    "pero",
    "yo",
    "tú",
    "cómo",
    "dónde",
    "mañana",
  ],
  tr: [
    "ve",
    "bir",
    "bu",
    "ben",
    "sen",
    "çok",
    "değil",
    "mi",
    "ne",
    "nasıl",
    "nerede",
    "bugün",
    "yarın",
    "teşekkür",
    "var",
    "yok",
    "için",
    "ile",
    "merhaba",
  ],
  it: [
    "il",
    "che",
    "non",
    "sono",
    "è",
    "per",
    "una",
    "con",
    "molto",
    "grazie",
    "ciao",
    "oggi",
    "domani",
    "io",
    "come",
    "dove",
    "anche",
    "ma",
    "gli",
  ],
  nl: [
    "het",
    "een",
    "niet",
    "ik",
    "je",
    "jij",
    "wij",
    "zijn",
    "met",
    "voor",
    "dank",
    "vandaag",
    "morgen",
    "hoe",
    "waar",
    "maar",
    "ook",
    "dat",
    "van",
  ],
  pt: [
    "não",
    "que",
    "uma",
    "você",
    "estou",
    "muito",
    "obrigado",
    "obrigada",
    "hoje",
    "amanhã",
    "com",
    "para",
    "eu",
    "como",
    "onde",
    "mas",
    "também",
    "os",
    "é",
  ],
};
const MARKS: Record<string, RegExp> = {
  de: /[ßäöü]/u,
  tr: /[ğışİ]/u,
  es: /[ñ¿¡]/u,
  pt: /[ãõ]/u,
  fr: /[èêëœàâîç]/u,
};

/** Best Latin-script guess, only when the evidence clearly favours one language. */
export function guessLatin(
  text: string,
): { code: string; score: number; scores: Record<string, number> } | null {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const scores: Record<string, number> = {};
  for (const [code, list] of Object.entries(COMMON)) {
    const set = new Set(list);
    scores[code] = words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
    if (MARKS[code]?.test(text)) scores[code] += 1;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || top[1] < 2 || top[1] < (second?.[1] ?? 0) * 2) return null;
  return { code: top[0], score: top[1], scores };
}

export interface SourceMismatch {
  /** The language the text appears to be in. */
  suggest: string;
  /** Writing-system proof: the picked language cannot be right. */
  strong: boolean;
}

const lang2 = (c?: string) => (c ?? "").toLowerCase().slice(0, 2);

/**
 * Null when the text fits the picked source (or we can't tell).
 * `modelDetected` is the source language the model reported for a finished translation.
 */
export function checkSource(
  text: string,
  source: string,
  modelDetected?: string,
): SourceMismatch | null {
  if (!source || source === "auto") return null;
  const dom = dominantScript(text);
  if (!dom) return null;
  const family = FAMILY[dom.script];
  const detected = lang2(modelDetected);

  if (!family.includes(source)) {
    // Wrong writing system — certain. Name the most specific language we can.
    let suggest = family.includes(detected) ? detected : (family[0] ?? "");
    if (dom.script === "arabic" && !family.includes(detected))
      suggest = arabicScriptLanguage(text).code;
    // Latin text: name the language only with evidence; otherwise offer automatic detection.
    if (dom.script === "latin" && !family.includes(detected))
      suggest = guessLatin(text)?.code ?? "auto";
    return suggest ? { suggest, strong: true } : null;
  }

  // Same writing system: the model's own detection on a finished sentence is the best evidence.
  if (detected && detected !== source && family.includes(detected))
    return { suggest: detected, strong: false };
  if (detected === source) return null;

  if (dom.script === "arabic") {
    const a = arabicScriptLanguage(text);
    return a.strong && a.code !== source ? { suggest: a.code, strong: false } : null;
  }
  if (dom.script === "latin") {
    const g = guessLatin(text);
    // Need clear evidence for the other language and none for the picked one.
    if (g && g.code !== source && (g.scores[source] ?? 0) === 0 && g.score >= 2)
      return { suggest: g.code, strong: false };
  }
  return null;
}
