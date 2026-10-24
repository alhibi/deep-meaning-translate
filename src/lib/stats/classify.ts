import type { Domain, Intent, Kind, Register } from "./taxonomy";

/**
 * Local, free, on-device classification. Used for old history rows and whenever the
 * model did not return tags. Results are always marked "estimated" in the UI.
 *
 * Word rule (declared, identical for every language): a word is a run of letters,
 * combining marks or digits; an apostrophe or hyphen between two such runs keeps it
 * one word ("geht's", "E-Mail"). Punctuation, emoji and spaces are never words.
 * Arabic attached clitics (و، ال، ـها) stay part of their word, as written.
 */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

export function sentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?؟…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => countWords(s) > 0).length;
}

export function localKind(text: string): Kind {
  const words = countWords(text);
  if (words <= 1) return "word";
  if (sentenceCount(text) > 1) return "text";
  if (words <= 4 && !/[.!?؟…]\s*$/.test(text.trim())) return "phrase";
  return "sentence";
}

/** Folds Arabic spelling variants and German umlauts so keyword matching is forgiving. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // harakat + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss");
}

function tokens(text: string): string[] {
  const out: string[] = [];
  for (const w of fold(text).match(WORD) ?? []) {
    out.push(w);
    // Arabic: also try without the common attached prefixes (و، ف، ب، ل، ال).
    if (/^[\u0600-\u06FF]/.test(w)) {
      const bare = w.replace(/^(و|ف)?(ب|ل|ك)?(ال)?/, "");
      if (bare && bare !== w && bare.length >= 2) out.push(bare);
    }
  }
  return out;
}

/**
 * Stems: ≥4 letters match as a prefix ("termin" → "Termine", "Terminvereinbarung"),
 * shorter ones only as whole words, so "bus" never matches "business".
 */
const DOMAIN_WORDS: Record<Exclude<Domain, "none">, string[]> = {
  work: [
    "arbeit",
    "job",
    "chef",
    "kolleg",
    "buro",
    "meeting",
    "projekt",
    "kunde",
    "gehalt",
    "bewerb",
    "firma",
    "schicht",
    "urlaubsantrag",
    "kundig",
    "vertrag",
    "praktik",
    "work",
    "boss",
    "office",
    "colleague",
    "salary",
    "client",
    "deadline",
    "عمل",
    "شغل",
    "دوام",
    "مدير",
    "زميل",
    "راتب",
    "معاش",
    "مكتب",
    "اجتماع",
    "مشروع",
    "شركه",
    "وظيف",
    "مقابله",
    "عقد",
    "زبون",
  ],
  study: [
    "schule",
    "uni",
    "studium",
    "studier",
    "kurs",
    "prufung",
    "lehrer",
    "hausaufgab",
    "lernen",
    "deutschkurs",
    "sprachkurs",
    "klasse",
    "vorlesung",
    "school",
    "exam",
    "teacher",
    "homework",
    "study",
    "lesson",
    "مدرسه",
    "جامعه",
    "دراسه",
    "درس",
    "امتحان",
    "استاذ",
    "معلم",
    "كورس",
    "واجب",
    "صف",
    "محاضره",
    "تعلم",
  ],
  social: [
    "freund",
    "familie",
    "mutter",
    "vater",
    "bruder",
    "schwester",
    "kind",
    "nachbar",
    "party",
    "treffen",
    "besuch",
    "hochzeit",
    "friend",
    "family",
    "mother",
    "father",
    "brother",
    "sister",
    "neighbor",
    "صديق",
    "صاحب",
    "رفيق",
    "عيله",
    "عائله",
    "اهل",
    "ام",
    "ابو",
    "اخ",
    "اخت",
    "جار",
    "عرس",
    "زياره",
    "حبيب",
  ],
  feelings: [
    "liebe",
    "lieb",
    "traurig",
    "glucklich",
    "angst",
    "vermiss",
    "freue",
    "wutend",
    "mude",
    "einsam",
    "gefuhl",
    "sorry",
    "love",
    "sad",
    "happy",
    "miss",
    "afraid",
    "angry",
    "lonely",
    "tired",
    "حب",
    "بحبك",
    "احبك",
    "حزين",
    "زعلان",
    "مبسوط",
    "سعيد",
    "خايف",
    "خوف",
    "مشتاق",
    "اشتقت",
    "تعبان",
    "قلق",
    "وحيد",
    "فرحان",
  ],
  travel: [
    "zug",
    "bahn",
    "flug",
    "flughafen",
    "reise",
    "hotel",
    "ticket",
    "fahrkarte",
    "bahnhof",
    "urlaub",
    "koffer",
    "taxi",
    "travel",
    "flight",
    "airport",
    "train",
    "trip",
    "luggage",
    "سفر",
    "مطار",
    "طياره",
    "قطار",
    "تذكره",
    "فندق",
    "رحله",
    "شنطه",
    "تاكسي",
    "محطه",
    "باص",
  ],
  shopping: [
    "kaufen",
    "preis",
    "geld",
    "euro",
    "rechnung",
    "bezahl",
    "laden",
    "supermarkt",
    "rabatt",
    "konto",
    "bank",
    "kasse",
    "teuer",
    "billig",
    "money",
    "price",
    "buy",
    "shop",
    "pay",
    "bill",
    "cheap",
    "expensive",
    "سعر",
    "فلوس",
    "مصاري",
    "مال",
    "يورو",
    "فاتوره",
    "دفع",
    "اشتري",
    "شراء",
    "سوق",
    "محل",
    "بنك",
    "حساب",
    "غالي",
    "رخيص",
    "خصم",
  ],
  food: [
    "essen",
    "trinken",
    "restaurant",
    "kaffee",
    "brot",
    "fruhstuck",
    "abendessen",
    "mittagessen",
    "hunger",
    "lecker",
    "kochen",
    "bestell",
    "speisekarte",
    "food",
    "eat",
    "drink",
    "coffee",
    "breakfast",
    "dinner",
    "lunch",
    "hungry",
    "delicious",
    "اكل",
    "طعام",
    "مطعم",
    "قهوه",
    "خبز",
    "فطور",
    "غدا",
    "عشا",
    "جوعان",
    "طبخ",
    "زاكي",
    "لذيذ",
    "شاي",
    "مي",
  ],
  services: [
    "termin",
    "amt",
    "behorde",
    "antrag",
    "formular",
    "anmeld",
    "auslanderbehorde",
    "jobcenter",
    "aufenthalt",
    "visum",
    "pass",
    "ausweis",
    "versicherung",
    "vermieter",
    "wohnung",
    "miete",
    "post",
    "brief",
    "unterlag",
    "appointment",
    "office",
    "form",
    "visa",
    "passport",
    "rent",
    "موعد",
    "دائره",
    "بلديه",
    "طلب",
    "استماره",
    "اقامه",
    "فيزا",
    "جواز",
    "هويه",
    "تامين",
    "ايجار",
    "شقه",
    "سكن",
    "بيت",
    "معامله",
    "اوراق",
    "رساله",
  ],
  tech: [
    "handy",
    "internet",
    "wlan",
    "computer",
    "laptop",
    "app",
    "email",
    "e-mail",
    "passwort",
    "update",
    "software",
    "online",
    "akku",
    "phone",
    "wifi",
    "password",
    "website",
    "موبايل",
    "جوال",
    "تلفون",
    "انترنت",
    "كمبيوتر",
    "لابتوب",
    "تطبيق",
    "ايميل",
    "كلمه السر",
    "شاحن",
    "برنامج",
  ],
  health: [
    "arzt",
    "krank",
    "kopfschmerz",
    "schmerz",
    "apotheke",
    "medikament",
    "krankenhaus",
    "fieber",
    "gesund",
    "zahnarzt",
    "rezept",
    "notaufnahme",
    "doctor",
    "sick",
    "pain",
    "pharmacy",
    "hospital",
    "fever",
    "medicine",
    "health",
    "دكتور",
    "طبيب",
    "مريض",
    "مرض",
    "وجع",
    "الم",
    "صيدليه",
    "دوا",
    "دواء",
    "مستشفى",
    "حراره",
    "صحه",
    "سخونه",
  ],
  culture: [
    "weihnacht",
    "ramadan",
    "eid",
    "fest",
    "feiertag",
    "tradition",
    "kultur",
    "musik",
    "film",
    "religion",
    "ostern",
    "silvester",
    "christmas",
    "culture",
    "holiday",
    "music",
    "رمضان",
    "عيد",
    "مبارك",
    "تقاليد",
    "ثقافه",
    "عادات",
    "موسيقى",
    "فيلم",
    "دين",
    "صلاه",
  ],
  daily: [
    "heute",
    "morgen",
    "gestern",
    "zuhause",
    "wetter",
    "einkauf",
    "aufstehen",
    "schlafen",
    "zeit",
    "uhr",
    "wochenende",
    "today",
    "tomorrow",
    "weather",
    "home",
    "sleep",
    "weekend",
    "اليوم",
    "بكرا",
    "بكره",
    "امبارح",
    "مبارح",
    "الطقس",
    "طقس",
    "البيت",
    "نوم",
    "وقت",
    "الساعه",
    "ويكند",
  ],
};

const INTENT_RULES: [Exclude<Intent, "none">, RegExp][] = [
  // Order matters: the first match wins, from the most specific function to the broadest.
  [
    "thank",
    /\b(danke|dankesch|vielen dank|thank|thx|merci)|شكر|يعطيك العافيه|تسلم|ممنون|مشكور|الله يخليك/u,
  ],
  [
    "apologize",
    /\b(entschuldig|verzeih|tut mir leid|sorry|apolog)|اسف|اعتذر|سامحني|عذرا|معلش|المعذره/u,
  ],
  [
    "greet",
    /\b(hallo|hi|hey|guten (morgen|tag|abend)|servus|moin|tschuss|bis bald|hello|good (morning|evening)|bye|freut mich)|مرحبا|اهلا|السلام عليكم|صباح الخير|مساء الخير|هلا|مع السلامه|تشرفنا|كيفك|شلونك|ازيك/u,
  ],
  [
    "complain",
    /\b(beschwer|leider|unzufrieden|kaputt|funktioniert nicht|immer noch nicht|reicht|complain|broken|not working|unacceptable)|مش شغال|ما بيشتغل|خربان|مشكله|زهقت|مو معقول|غير مقبول|شكوى/u,
  ],
  ["humor", /(haha|hihi|lol|xd|😂|🤣|😆|ههه|خخخ|نكته|بمزح)/u],
  [
    "praise",
    /\b(toll|super|klasse|wunderbar|schon|gut gemacht|bravo|perfekt|great|amazing|awesome|beautiful|well done)|رائع|حلو|جميل|ممتاز|برافو|يسلمو|عظيم|تحفه|ماشاء الله/u,
  ],
  [
    "agree",
    /^\s*(ja|nein|okay|ok|klar|einverstanden|genau|stimmt|auf keinen fall|yes|no|sure|agreed)\b|موافق|تمام|ماشي|اكيد|طيب|لا شكرا|مستحيل|ابدا|^\s*(نعم|لا|اه|ايوه)\s*$/u,
  ],
  [
    "request",
    /\b(bitte|konnten sie|konntest du|kannst du|konnen sie|wurden sie|ich mochte|ich hatte gern|ich brauche|please|could you|can you|would you|i need|i'd like)|من فضلك|لو سمحت|ممكن|بدي|ابغى|عايز|اريد|محتاج|ساعدني|رجاء/u,
  ],
  [
    "ask",
    /[?؟]\s*$|^\s*(wie|was|wo|wann|warum|wieso|wer|welche|woher|wohin|how|what|where|when|why|who|which|do you|are you|is it)\b|^\s*(كيف|شو|ايش|وين|ليش|متى|مين|هل|قديش|كم|لماذا|ماذا|اين)/u,
  ],
  [
    "feel",
    /\b(ich fuhle|ich bin (traurig|glucklich|mude|mude|froh)|ich vermisse|ich liebe|i feel|i miss|i love|i'm (sad|happy|tired))|انا (حزين|مبسوط|تعبان|زعلان|فرحان)|اشتقت|بحبك|احبك|حاسس|اشعر/u,
  ],
  [
    "describe",
    /\b(ist|sind|war|waren|hat|haben|gibt es|is|are|was|were|has|have)\b|كان|كانت|يوجد|في عندي|عندي|صار/u,
  ],
];

function scoreDomains(text: string): Domain {
  const toks = tokens(text);
  const joined = ` ${toks.join(" ")} `;
  let best: Domain = "none";
  let bestScore = 0;
  for (const [domain, words] of Object.entries(DOMAIN_WORDS) as [
    Exclude<Domain, "none">,
    string[],
  ][]) {
    let score = 0;
    for (const w of words) {
      if (w.includes(" ")) {
        if (joined.includes(` ${w} `)) score += 2;
        continue;
      }
      const hit = w.length >= 4 ? toks.some((t) => t.startsWith(w)) : toks.includes(w);
      if (hit) score += 1;
    }
    // "daily" is the weakest signal: it only wins when nothing more specific matched.
    if (domain === "daily") score -= 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = domain;
    }
  }
  return bestScore > 0 ? best : "none";
}

export function localDomain(...texts: string[]): Domain {
  return scoreDomains(texts.filter(Boolean).join(" \n "));
}

export function localIntent(...texts: string[]): Intent {
  // Each text is checked on its own so anchors (^, $) keep their meaning.
  for (const [intent, re] of INTENT_RULES)
    if (texts.some((t) => t && re.test(fold(t).trim()))) return intent;
  return "none";
}

/**
 * Register layer, from the strongest evidence available:
 * idiomatic/colloquial kinds → the model's measured formality → the style the user asked for.
 */
export function deriveRegister(opts: {
  kind: Kind;
  formality?: string | undefined;
  style?: string | undefined;
}): Register {
  if (opts.kind === "idiom" || opts.kind === "proverb") return "idiomatic";
  if (opts.kind === "slang") return "colloquial";
  if (opts.formality === "formal") return "formal";
  if (opts.formality === "casual") return "casual";
  if (opts.formality === "neutral") return "natural";
  if (opts.style === "formal") return "formal";
  if (opts.style === "casual") return "casual";
  return "natural";
}
