/**
 * Deterministic Sentence Shadow evaluation fixtures — no model calls, no cost.
 *
 * Each case is a source/translation pair plus the answer a critic following the prompt
 * contract should produce for that pair. The evaluator asserts the pipeline's guarantees:
 * a claimed loss is anchored to real text in BOTH languages, its kind/category survive,
 * restores are internally valid, and a "nothing lost" answer (including a pure style
 * difference, or a fabricated quote) never becomes a visible finding.
 *
 * The set covers the validation list from TD41: repeated expressions, diacritics/NFC,
 * German compounds, humour/sarcasm, religious and cultural expressions, implicit
 * refusal/reproach, ambiguity, politeness/respect, multiple paragraphs, a long
 * mixed-language text analysed as windows, no-loss cases, and adversarial restores that
 * must be rejected (dropped negation, invented number/date, dropped name or link).
 *
 * Run directly:   node tests/eval/shadow_eval.ts
 * Run inside CI:  npx vitest run src/lib/translation/shadow.eval.test.ts
 */
import { pathToFileURL } from "node:url";
import {
  parseShadow,
  planShadowWindows,
  readWindowShadowReply,
  wordDiff,
  type Loss,
  type ShadowCategory,
  type ShadowKind,
} from "../../src/lib/translation/shadow.ts";

export interface ShadowEvalCase {
  id: string;
  pair: "ar→de" | "de→ar";
  register: "daily" | "formal";
  feature:
    | "idiom"
    | "sarcasm"
    | "respect"
    | "implied"
    | "joke"
    | "ambiguity"
    | "plain"
    | "repetition"
    | "diacritics"
    | "compound"
    | "religion"
    | "refusal"
    | "politeness"
    | "paragraphs"
    | "multilingual"
    | "no-loss";
  source: string;
  translation: string;
  /** What the critic's JSON answer would be for this already-correct translation. */
  reply: unknown;
  expectation: "loss" | "none";
  /** Which Arabic variety the pair exercises, when the Arabic side is the source. */
  variety?: "msa" | "levantine";
  expectCategory?: ShadowCategory;
  expectKind?: ShadowKind;
  /**
   * Absolute source offset the finding must anchor at. Needed when the quoted words repeat
   * and only the correct occurrence proves the pairing (or, for `windowed` cases, that the
   * window offset was added back onto the whole text).
   */
  expectSourceStart?: number;
  /** Absolute target offset in the translation. */
  expectTargetStart?: number;
  /**
   * Evaluate the reply as one window of the whole source (the long-text path): the quote is
   * found in the window that owns it, and the finding must carry absolute offsets.
   */
  windowed?: boolean;
  /** Restore texts the validator must keep, in order; every other restore was dropped. */
  expectRestores?: string[];
}

const lossReply = (o: Record<string, unknown>) => ({
  losses: [
    {
      kind: "loss",
      severity: 2,
      confidence: 0.85,
      explanation: "قد يضيع هذا الفرق في الترجمة.",
      restores: [],
      ...o,
    },
  ],
});

const NONE = { losses: [] };

/**
 * A long mixed-language source for the windowed case: German body sentences with dates and
 * numbers, an Arabic report line, one unique marker sentence (a date, a time, a brand, a
 * city) and more German tail sentences. About 1,900 characters, so the planner splits it
 * into several sentence windows and the marker must keep absolute offsets after the merge.
 */
const longMixedMarker = "Wir treffen uns am 17.11.2026 um 9.30 Uhr bei Starbucks in Berlin.";
const longMixedSource = [
  ...Array.from(
    { length: 12 },
    (_value, index) =>
      `Am ${(index % 28) + 1}.11.2026 haben wir im Raum ${index + 1} über die Ergebnisse der Besprechung gesprochen, und alle waren einverstanden.`,
  ),
  "ثم قال المدير إن الخطة ستُراجع مرة أخرى قبل نهاية الشهر.",
  longMixedMarker,
  ...Array.from(
    { length: 6 },
    (_value, index) =>
      `Danach gingen alle nach Hause und schrieben Bericht Nummer ${index + 1} für die Akten.`,
  ),
].join(" ");
const longMixedTranslation = [
  ...Array.from(
    { length: 12 },
    (_value, index) =>
      `في ${(index % 28) + 1}.11.2026 تحدثنا في القاعة ${index + 1} عن نتائج الاجتماع ووافق الجميع.`,
  ),
  "ثم قال المدير إن الخطة ستُراجع مرة أخرى قبل نهاية الشهر.",
  "نلتقي في 17.11.2026 الساعة 9.30 عند Starbucks في برلين.",
  ...Array.from(
    { length: 6 },
    (_value, index) => `بعد ذلك ذهب الجميع إلى البيت وكتبوا تقريراً رقم ${index + 1} للأرشيف.`,
  ),
].join(" ");

export const SHADOW_EVAL_CASES: ShadowEvalCase[] = [
  {
    id: "ar-de-levantine-idiom-thanks",
    variety: "levantine",
    pair: "ar→de",
    register: "daily",
    feature: "idiom",
    source: "تسلم إيدك على الأكل",
    translation: "Danke für das Essen",
    reply: lossReply({
      category: "warmth",
      source_quote: "تسلم إيدك",
      target_quote: "Danke",
      explanation: "قد يبدو الشكر عادياً بدل دفء العبارة.",
    }),
    expectation: "loss",
    expectCategory: "warmth",
  },
  {
    id: "ar-de-levantine-implied-reproach",
    variety: "levantine",
    pair: "ar→de",
    register: "daily",
    feature: "implied",
    source: "براحتك، أنا مش زعلان أبداً",
    translation: "Wie du willst, ich bin überhaupt nicht sauer",
    reply: lossReply({
      category: "implied",
      source_quote: "براحتك",
      target_quote: "Wie du willst",
      explanation: "قد يضيع العتاب الذي تحمله العبارة.",
    }),
    expectation: "loss",
    expectCategory: "implied",
  },
  {
    id: "ar-de-msa-respect",
    variety: "msa",
    pair: "ar→de",
    register: "formal",
    feature: "respect",
    source: "حضرتك ممكن تساعدني بهالورقة؟",
    translation: "Kannst du mir mit diesem Blatt helfen?",
    reply: lossReply({
      category: "respect",
      source_quote: "حضرتك",
      target_quote: "du",
      explanation: "قد يضيع الاحترام الذي تحمله حضرتك.",
    }),
    expectation: "loss",
    expectCategory: "respect",
  },
  {
    id: "ar-de-levantine-sarcasm",
    pair: "ar→de",
    register: "daily",
    feature: "sarcasm",
    source: "شاطر! كسرت الكاسة التالتة اليوم",
    translation: "Gut gemacht! Du hast heute das dritte Glas zerbrochen.",
    reply: lossReply({
      category: "humor",
      source_quote: "شاطر",
      target_quote: "Gut gemacht",
      explanation: "قد تُقرأ الجملة مدحاً حقيقياً بدل السخرية.",
    }),
    expectation: "loss",
    expectCategory: "humor",
  },
  {
    id: "ar-de-msa-culture-hedging",
    pair: "ar→de",
    register: "daily",
    feature: "idiom",
    source: "إن شاء الله بخلص الشغل بكرا",
    translation: "Ich schaffe die Arbeit morgen",
    reply: lossReply({
      category: "culture",
      source_quote: "إن شاء الله",
      target_quote: "Ich schaffe",
      explanation: "قد تختفي نبرة التسليم والتحفّظ.",
    }),
    expectation: "loss",
    expectCategory: "culture",
  },
  {
    id: "ar-de-msa-grief-intensity",
    variety: "msa",
    pair: "ar→de",
    register: "daily",
    feature: "ambiguity",
    source: "يا حسرتاه على اللي فات",
    translation: "Schade um die alten Tage",
    reply: lossReply({
      category: "intensity",
      source_quote: "يا حسرتاه",
      target_quote: "Schade",
      explanation: "قد يخفّ الحزن العميق إلى أسف عادي.",
    }),
    expectation: "loss",
    expectCategory: "intensity",
  },
  {
    id: "ar-de-levantine-affection",
    pair: "ar→de",
    register: "daily",
    feature: "idiom",
    source: "على راسي، طلبك أمر",
    translation: "Auf meinem Kopf, dein Wunsch ist ein Befehl",
    reply: lossReply({
      category: "culture",
      source_quote: "على راسي",
      target_quote: "Auf meinem Kopf",
      explanation: "قد تُقرأ العبارة حرفياً بلا مودّتها.",
    }),
    expectation: "loss",
    expectCategory: "culture",
  },
  {
    id: "ar-de-msa-plain-nothing-lost",
    pair: "ar→de",
    register: "daily",
    feature: "plain",
    source: "القطار يغادر الساعة الثامنة صباحاً",
    translation: "Der Zug fährt um acht Uhr morgens ab",
    reply: NONE,
    expectation: "none",
  },
  {
    id: "ar-de-msa-plain-nothing-lost-2",
    pair: "ar→de",
    register: "daily",
    feature: "plain",
    source: "أنا أدرس اللغة الألمانية منذ سنتين",
    translation: "Ich lerne seit zwei Jahren Deutsch",
    reply: NONE,
    expectation: "none",
  },
  {
    id: "de-ar-formal-nothing-lost",
    pair: "de→ar",
    register: "formal",
    feature: "plain",
    source: "Bitte schicken Sie mir die Rechnung per E-Mail.",
    translation: "يرجى إرسال الفاتورة إليّ عبر البريد الإلكتروني.",
    reply: NONE,
    expectation: "none",
  },
  {
    id: "de-ar-idiom-nothing-lost",
    pair: "de→ar",
    register: "daily",
    feature: "idiom",
    source: "Ich drücke dir ganz fest die Daumen",
    translation: "أتمنى لك التوفيق من كل قلبي",
    // The idiom was rendered idiomatically: a good critic must not call that a loss.
    reply: NONE,
    expectation: "none",
  },
  {
    id: "de-ar-formal-respect-loss",
    pair: "de→ar",
    register: "formal",
    feature: "respect",
    source: "Sie haben das wirklich sehr gut gemacht, Frau Müller.",
    translation: "أحسنت يا مولر",
    reply: lossReply({
      category: "respect",
      severity: 3,
      source_quote: "Sie haben",
      target_quote: "أحسنت",
      explanation: "قد تختفي درجة الاحترام الرسمية.",
    }),
    expectation: "loss",
    expectCategory: "respect",
  },
  {
    id: "de-ar-sarcasm-loss",
    pair: "de→ar",
    register: "daily",
    feature: "sarcasm",
    source: "Super, jetzt regnet es auch noch. Genau mein Tag.",
    translation: "رائع، الآن تمطر أيضاً. يوماً جميلاً!",
    reply: lossReply({
      category: "humor",
      source_quote: "Super",
      target_quote: "رائع",
      explanation: "قد تُقرأ السخرية رضاً حقيقياً.",
    }),
    expectation: "loss",
    expectCategory: "humor",
  },
  {
    id: "de-ar-joke-proverb",
    pair: "de→ar",
    register: "daily",
    feature: "joke",
    source: "Morgenstund hat Gold im Mund",
    translation: "النوم مبكراً والاستيقاظ مبكراً يبنيان الصحة",
    reply: lossReply({
      category: "rhythm",
      source_quote: "Morgenstund",
      target_quote: "النوم مبكراً",
      explanation: "قد تضيع صيغة المثل وإيقاعها.",
    }),
    expectation: "loss",
    expectCategory: "rhythm",
  },
  {
    id: "de-ar-daily-nothing-lost",
    pair: "de→ar",
    register: "daily",
    feature: "plain",
    source: "Kannst du mir bitte das Salz geben?",
    translation: "هل يمكنك أن تعطيني الملح من فضلك؟",
    reply: NONE,
    expectation: "none",
  },
  {
    id: "de-ar-idiom-daily",
    pair: "de→ar",
    register: "daily",
    feature: "idiom",
    source: "Das ist nicht mein Bier, ehrlich gesagt",
    translation: "هذا ليس شأني، بصراحة",
    reply: NONE,
    expectation: "none",
  },
  {
    id: "de-ar-style-only-is-not-a-loss",
    pair: "de→ar",
    register: "daily",
    feature: "plain",
    source: "Das Wetter ist heute etwas kalt",
    translation: "الطقس اليوم بارد قليلاً",
    reply: {
      losses: [
        {
          kind: "style",
          category: "rhythm",
          severity: 1,
          confidence: 0.8,
          source_quote: "Das Wetter",
          target_quote: "الطقس",
          explanation: "أسلوب مختلف فقط.",
        },
      ],
    },
    expectation: "none",
  },
  {
    id: "fabricated-quote-is-dropped",
    pair: "ar→de",
    register: "daily",
    feature: "plain",
    source: "الطقس اليوم بارد قليلاً",
    translation: "Das Wetter ist heute etwas kalt",
    reply: lossReply({
      category: "intensity",
      source_quote: "موجود",
      target_quote: "gefunden",
      explanation: "ادعاء لا يقابله نص.",
    }),
    expectation: "none",
  },
  {
    id: "ambiguous-double-meaning",
    pair: "ar→de",
    register: "daily",
    feature: "ambiguity",
    source: "اللي بيته من قزاز ما بيرمي الناس بحجار",
    translation: "Wer im Glashaus sitzt, sollte nicht mit Steinen werfen",
    // The proverb maps to an existing German proverb: the image changed, meaning did not.
    reply: NONE,
    expectation: "none",
  },
  {
    id: "de-ar-sarcasm-loss-explicit",
    pair: "de→ar",
    register: "daily",
    feature: "sarcasm",
    source: "Na toll, der Zug fällt schon wieder aus.",
    translation: "عظيم، القطار معطل مرة أخرى.",
    reply: lossReply({
      category: "humor",
      source_quote: "Na toll",
      target_quote: "عظيم",
      explanation: "قد تُقرأ السخرية إعجاباً حقيقياً.",
    }),
    expectation: "loss",
    expectCategory: "humor",
  },
  {
    id: "ar-de-repeated-thanks",
    pair: "ar→de",
    register: "daily",
    feature: "repetition",
    source: "Danke für das Essen. Danke für alles, was du getan hast.",
    translation: "شكراً على الطعام. شكراً على كل ما فعلته.",
    // The same word twice: only the occurrence hint points the second finding at the
    // second sentence, on both sides.
    reply: lossReply({
      category: "warmth",
      source_quote: "Danke",
      target_quote: "شكراً",
      source_occurrence: 2,
      target_occurrence: 2,
      explanation: "قد يضيع دفء الشكر الثاني.",
    }),
    expectation: "loss",
    expectCategory: "warmth",
    expectSourceStart: "Danke für das Essen. ".length,
    expectTargetStart: "شكراً على الطعام. ".length,
  },
  {
    id: "ar-de-diacritics-vocalised-quote",
    pair: "ar→de",
    register: "daily",
    feature: "diacritics",
    source: "يَا حَسْرَتَاهُ عَلَى الَّذِي فَاتَ",
    // The critic quotes the bare letters while the source carries harakat.
    translation: "Schade um das, was vergangen ist",
    reply: lossReply({
      category: "intensity",
      source_quote: "يا حسرتاه",
      target_quote: "Schade",
      explanation: "قد يخفّ الحزن العميق إلى أسف عادي.",
    }),
    expectation: "loss",
    expectCategory: "intensity",
    expectSourceStart: 0,
  },
  {
    id: "de-ar-german-compound",
    pair: "de→ar",
    register: "formal",
    feature: "compound",
    source: "Die Krankenversicherungsbeiträge steigen nächstes Jahr stark.",
    translation: "ترتفع اشتراكات التأمين الصحي كثيراً العام المقبل.",
    reply: lossReply({
      category: "intensity",
      source_quote: "Krankenversicherungsbeiträge",
      target_quote: "اشتراكات",
      explanation: "قد تختفي دقة المركّب الألماني.",
    }),
    expectation: "loss",
    expectCategory: "intensity",
    expectSourceStart: 4,
  },
  {
    id: "ar-de-religion-nothing-lost",
    pair: "ar→de",
    register: "daily",
    feature: "religion",
    source: "الحمد لله وصلنا بسلام",
    translation: "Gott sei Dank sind wir sicher angekommen",
    // The religious reference and its gratitude were rendered, not flattened.
    reply: NONE,
    expectation: "none",
  },
  {
    id: "ar-de-implicit-refusal",
    pair: "ar→de",
    register: "daily",
    feature: "refusal",
    source: "خلينا نشوف، يمكن أقدر أجي بكرا",
    translation: "Wir schauen mal, vielleicht schaffe ich es morgen",
    reply: lossReply({
      category: "implied",
      source_quote: "خلينا نشوف",
      target_quote: "schauen mal",
      explanation: "قد يضيع التردد الذي يعني رفضاً لطيفاً.",
    }),
    expectation: "loss",
    expectCategory: "implied",
  },
  {
    id: "de-ar-politeness-nothing-lost",
    pair: "de→ar",
    register: "formal",
    feature: "politeness",
    source: "Bitte seien Sie so freundlich und senden Sie mir die Unterlagen",
    translation: "تكرموا بإرسال المستندات إليّ",
    reply: NONE,
    expectation: "none",
  },
  {
    id: "de-ar-two-paragraphs",
    pair: "de→ar",
    register: "daily",
    feature: "paragraphs",
    source:
      "Erster Absatz über die Arbeit und die Besprechung von gestern.\n\nZweiter Absatz über den Urlaub in Hamburg und die Rückkehr am Montag.",
    translation:
      "الفقرة الأولى عن العمل واجتماع أمس.\n\nالفقرة الثانية عن العطلة في هامبورغ والعودة يوم الاثنين.",
    reply: lossReply({
      category: "culture",
      source_quote: "Hamburg",
      target_quote: "هامبورغ",
      explanation: "قد يضيع اسم المكان.",
    }),
    expectation: "loss",
    expectCategory: "culture",
    expectSourceStart:
      "Erster Absatz über die Arbeit und die Besprechung von gestern.\n\nZweiter Absatz über den Urlaub in "
        .length,
  },
  {
    id: "de-ar-long-mixed-language-window",
    pair: "de→ar",
    register: "formal",
    feature: "multilingual",
    source: longMixedSource,
    translation: longMixedTranslation,
    windowed: true,
    reply: lossReply({
      category: "culture",
      source_quote: longMixedMarker,
      target_quote: "Starbucks",
      explanation: "قد يضيع اسم المكان في نص طويل.",
    }),
    expectation: "loss",
    expectCategory: "culture",
    expectSourceStart: longMixedSource.indexOf(longMixedMarker),
    expectTargetStart: longMixedTranslation.indexOf("Starbucks"),
  },
  {
    id: "de-ar-long-mixed-nothing-lost",
    pair: "de→ar",
    register: "formal",
    feature: "no-loss",
    source: "Wir treffen uns am 17.11.2026 um 9.30 Uhr bei Starbucks in Berlin",
    translation: "نلتقي في 17.11.2026 الساعة 9.30 عند Starbucks في برلين",
    // Dates, times, the brand and the city all survived: no finding may be invented.
    reply: NONE,
    expectation: "none",
  },
  {
    id: "ar-de-adversarial-restores",
    pair: "ar→de",
    register: "daily",
    feature: "implied",
    source: "أنا لا أستطيع الحضور اليوم",
    translation: "Ich kann heute nicht kommen",
    // One alternative drops the negation (rejected); one keeps it (kept).
    reply: lossReply({
      category: "implied",
      source_quote: "لا أستطيع",
      target_quote: "nicht",
      restores: [
        { text: "Ich kann heute kommen", note: "دون نفي" },
        { text: "Ich kann heute leider nicht kommen", note: "يحفظ النفي" },
      ],
      explanation: "قد يضيع اللطف في الاعتذار.",
    }),
    expectation: "loss",
    expectCategory: "implied",
    expectRestores: ["Ich kann heute leider nicht kommen"],
  },
];

export interface ShadowEvalFailure {
  id: string;
  detail: string;
}

export interface ShadowEvalSummary {
  total: number;
  passed: number;
  failed: ShadowEvalFailure[];
}

/** The window that owns an absolute source offset, or the first window. */
function windowOwning(testCase: ShadowEvalCase) {
  const windows = planShadowWindows(testCase.source);
  if (!windows.length) return null;
  const start = testCase.expectSourceStart;
  if (start === undefined) return windows[0]!;
  return windows.find((window) => window.start <= start && start < window.end) ?? null;
}

/** Deterministic checks; no network and no model call. */
export function runShadowEval(): ShadowEvalSummary {
  const failed: ShadowEvalFailure[] = [];
  for (const testCase of SHADOW_EVAL_CASES) {
    const fail = (detail: string) => failed.push({ id: testCase.id, detail });
    let parsed: { losses: Loss[] } | null;
    if (testCase.windowed) {
      // Long-text path: the reply is one window's answer; the window offset must be added
      // back so the finding still points at the same characters in the whole source.
      const windows = planShadowWindows(testCase.source);
      if (windows.length < 2) {
        fail("windowed case did not plan more than one window");
        continue;
      }
      const window = windowOwning(testCase);
      if (!window) {
        fail("no window owns the expected absolute source offset");
        continue;
      }
      const losses = readWindowShadowReply(
        JSON.stringify(testCase.reply),
        window,
        testCase.translation,
      );
      parsed = losses ? { losses } : null;
    } else {
      parsed = parseShadow(testCase.reply, testCase.source, testCase.translation);
    }
    if (!parsed) {
      fail("reply was rejected as unusable");
      continue;
    }
    const got = parsed.losses.length > 0 ? "loss" : "none";
    if (got !== testCase.expectation) {
      fail(`expected ${testCase.expectation}, got ${got}`);
      continue;
    }
    if (testCase.expectation === "none") {
      if (parsed.losses.length !== 0) fail("a non-loss answer produced findings");
      continue;
    }
    const loss = parsed.losses[0];
    if (!loss) {
      fail("expected a finding, got none");
      continue;
    }
    const distinct = new Set(parsed.losses.map((item) => item.id));
    if (distinct.size !== parsed.losses.length) fail("duplicate finding ids");
    if (loss.sourceQuote !== testCase.source.slice(loss.source.start, loss.source.end))
      fail("sourceQuote does not match its span");
    if (loss.targetQuote !== testCase.translation.slice(loss.target.start, loss.target.end))
      fail("targetQuote does not match its span");
    if (testCase.expectCategory && loss.category !== testCase.expectCategory)
      fail(`expected category ${testCase.expectCategory}, got ${loss.category}`);
    if (testCase.expectKind && loss.kind !== testCase.expectKind)
      fail(`expected kind ${testCase.expectKind}, got ${loss.kind}`);
    if (
      testCase.expectSourceStart !== undefined &&
      loss.source.start !== testCase.expectSourceStart
    )
      fail(`expected source start ${testCase.expectSourceStart}, got ${loss.source.start}`);
    if (
      testCase.expectTargetStart !== undefined &&
      loss.target.start !== testCase.expectTargetStart
    )
      fail(`expected target start ${testCase.expectTargetStart}, got ${loss.target.start}`);
    if (loss.severity < 1 || loss.severity > 3) fail("severity outside 1–3");
    if (!(loss.confidence >= 0 && loss.confidence <= 1)) fail("confidence outside 0–1");
    const keptRestores = loss.restores.map((restore) => restore.text);
    if (
      testCase.expectRestores &&
      JSON.stringify(keptRestores) !== JSON.stringify(testCase.expectRestores)
    )
      fail(
        `expected restores ${JSON.stringify(testCase.expectRestores)}, got ${JSON.stringify(keptRestores)}`,
      );
    for (const restore of loss.restores) {
      const diff = wordDiff(testCase.translation, restore.text);
      if (!diff.removed && !diff.added) fail("restore does not change the translation");
      if (restore.changed.start < 0 || restore.changed.end > restore.text.length)
        fail("restore changed span outside the alternative text");
    }
  }
  return {
    total: SHADOW_EVAL_CASES.length,
    passed: SHADOW_EVAL_CASES.length - failed.length,
    failed,
  };
}

/** Runs when executed with Node directly (type stripping), not when imported by vitest. */
const entry = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1];
const isDirectRun = typeof entry === "string" && import.meta.url === pathToFileURL(entry).href;
if (isDirectRun) {
  const summary = runShadowEval();
  for (const failure of summary.failed) console.log(`FAIL ${failure.id}: ${failure.detail}`);
  console.log(
    `RESULT ${summary.passed}/${summary.total} deterministic shadow cases pass` +
      (summary.failed.length ? ` · ${summary.failed.length} failed` : ""),
  );
  if (summary.failed.length)
    (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
}
