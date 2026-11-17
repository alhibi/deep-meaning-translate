/**
 * Deterministic Sentence Shadow evaluation fixtures — no model calls, no cost.
 *
 * Each case is a source/translation pair plus the answer a critic following the prompt
 * contract should produce for that pair. The evaluator asserts the pipeline's guarantees:
 * a claimed loss is anchored to real text in BOTH languages, its kind/category survive,
 * restores are internally valid, and a "nothing lost" answer (including a pure style
 * difference, or a fabricated quote) never becomes a visible finding.
 *
 * Run directly:   node tests/eval/shadow_eval.ts
 * Run inside CI:  npx vitest run src/lib/translation/shadow.eval.test.ts
 */
import { pathToFileURL } from "node:url";
import {
  parseShadow,
  wordDiff,
  type ShadowCategory,
  type ShadowKind,
} from "../../src/lib/translation/shadow.ts";

export interface ShadowEvalCase {
  id: string;
  pair: "ar→de" | "de→ar";
  register: "daily" | "formal";
  feature: "idiom" | "sarcasm" | "respect" | "implied" | "joke" | "ambiguity" | "plain";
  source: string;
  translation: string;
  /** What the critic's JSON answer would be for this already-correct translation. */
  reply: unknown;
  expectation: "loss" | "none";
  /** Which Arabic variety the pair exercises, when the Arabic side is the source. */
  variety?: "msa" | "levantine";
  expectCategory?: ShadowCategory;
  expectKind?: ShadowKind;
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

/** Deterministic checks; no network and no model call. */
export function runShadowEval(): ShadowEvalSummary {
  const failed: ShadowEvalFailure[] = [];
  for (const testCase of SHADOW_EVAL_CASES) {
    const parsed = parseShadow(testCase.reply, testCase.source, testCase.translation);
    const fail = (detail: string) => failed.push({ id: testCase.id, detail });
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
    if (loss.severity < 1 || loss.severity > 3) fail("severity outside 1–3");
    if (!(loss.confidence >= 0 && loss.confidence <= 1)) fail("confidence outside 0–1");
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
