/**
 * Versioned Arabic ⇄ German evaluation corpus — v1, frozen 2026-11-17.
 *
 * These are hand-authored source sentences plus invariants that can be checked
 * deterministically (numbers, names, negation, punctuation, terminology, paragraph count).
 * The expected invariants are authored BEFORE any model output; nothing here was copied
 * from a model reply. A fluent translation can still fail meaning, intent, register or
 * naturalness — that is why every row carries a NOT_VERIFIED human-review slot.
 */
import type { CorpusVersion } from "./types";

export const CORPUS_V1: CorpusVersion = {
  version: "1.0.0",
  createdAt: "2026-11-17",
  verifiedAgainst: {
    model: "deepseek-flash",
    docsAccessedAt: "2026-11-17",
    urls: [
      "https://api-docs.deepseek.com/quick_start/pricing.md",
      "https://api-docs.deepseek.com/guides/thinking_mode.md",
      "https://api-docs.deepseek.com/api/create-chat-completion.md",
      "https://api-docs.deepseek.com/guides/json_mode.md",
      "https://api-docs.deepseek.com/quick_start/rate_limit.md",
    ],
  },
  cases: [
    {
      id: "ar-de-chat-greeting",
      direction: "ar→de",
      category: "everyday-chat",
      context: "chat",
      style: "casual",
      source: "شو أخبارك اليوم؟",
      invariants: {
        questionMark: true,
        registerMarkers: {
          id: "casual-de",
          any: ["du", "dich", "dir", "mal", "echt"],
          note: "casual German address",
        },
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Levantine greeting read as a question, casual not stiff",
      },
    },
    {
      id: "ar-de-chat-market",
      direction: "ar→de",
      category: "everyday-chat",
      context: "chat",
      style: "casual",
      source: "بدي أروح عالسوق بعد الضهر، بتيجي معي؟",
      invariants: {
        questionMark: true,
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Invitation stays an invitation; الضهر rendered as afternoon/lunchtime correctly",
      },
    },
    {
      id: "ar-de-work-deadline",
      direction: "ar→de",
      category: "workplace",
      context: "work",
      style: "natural",
      source: "المدير طلب مني أخلص التقرير قبل يوم الخميس 20/11.",
      invariants: {
        numbers: ["20", "11"],
        requiredTerms: [
          {
            id: "report",
            any: ["Bericht", "Report"],
            note: "التقرير = report",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Workplace request: deadline kept, no invented politeness change",
      },
    },
    {
      id: "ar-de-work-formal-offer",
      direction: "ar→de",
      category: "workplace",
      context: "work",
      style: "formal",
      source: "نرجو منكم إرسال العرض المالي قبل نهاية الشهر.",
      invariants: {
        requiredTerms: [
          {
            id: "offer",
            any: ["Angebot", "Kostenvoranschlag"],
            note: "العرض المالي = commercial offer",
          },
        ],
        forbiddenTerms: [
          {
            id: "informal-address",
            any: ["du", "dich", "dir"],
            note: "formal business letter uses Sie",
          },
        ],
        registerMarkers: {
          id: "formal-de",
          any: ["Sie", "Ihnen", "bitte", "freundlich"],
          note: "formal German address",
        },
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Business request stays formal (Sie), not casual",
      },
    },
    {
      id: "ar-de-official-application",
      direction: "ar→de",
      category: "official",
      context: "official",
      style: "formal",
      source: "أرجو التكرم بالموافقة على طلبي المقدم بتاريخ 3/10/2026.",
      invariants: {
        numbers: ["3-10-2026"],
        requiredTerms: [
          {
            id: "application",
            any: ["Antrag", "Gesuch"],
            note: "طلب = application",
          },
        ],
        forbiddenTerms: [
          {
            id: "informal-address",
            any: ["du", "dich", "dir"],
            note: "official letter uses Sie",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Official courtesy carried without inflating the request",
      },
    },
    {
      id: "ar-de-official-authority",
      direction: "ar→de",
      category: "official",
      context: "official",
      style: "formal",
      source: "بموجب هذا الكتاب نبلغكم بأن المعاملة قد أُحيلت إلى الدائرة المختصة.",
      invariants: {
        requiredTerms: [
          {
            id: "authority",
            any: ["Behörde", "Stelle", "Amt"],
            note: "الدائرة المختصة = competent authority",
          },
          {
            id: "case",
            any: ["Vorgang", "Verfahren", "Angelegenheit"],
            note: "المعاملة = case/file",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus:
          "Administrative register: حُوِّلت إلى الدائرة المختصة not mistranslated as a physical transfer",
      },
    },
    {
      id: "ar-de-formal-respect",
      direction: "ar→de",
      category: "formal",
      context: "general",
      style: "formal",
      source: "حضرتك ممكن تساعدني بهالورقة؟",
      invariants: {
        questionMark: true,
        registerMarkers: {
          id: "formal-de",
          any: ["Sie", "Ihnen", "bitte"],
          note: "حضرتك demands Sie, not du",
        },
        forbiddenTerms: [
          {
            id: "informal-address",
            any: ["du", "dich", "dir"],
            note: "حضرتك is formal address",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "حضرتك mapped to a formal German address, request not turned into an order",
      },
    },
    {
      id: "ar-de-casual-thanks",
      direction: "ar→de",
      category: "casual",
      context: "chat",
      style: "casual",
      source: "تسلم إيدك عالمساعدة، ما قصرت.",
      invariants: {
        requiredTerms: [
          {
            id: "thanks",
            any: ["Dank", "danke"],
            note: "warm thanks must remain thanks",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Warmth of تسلم إيدك kept without literal hand translation",
      },
    },
    {
      id: "ar-de-idiom-glass-house",
      direction: "ar→de",
      category: "idioms-culture",
      context: "general",
      style: "natural",
      source: "اللي بيته من قزاز ما بيرمي الناس بحجار.",
      invariants: {},
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Proverb rendered as a German proverb or natural image, not word-for-word",
      },
    },
    {
      id: "ar-de-culture-inshallah",
      direction: "ar→de",
      category: "idioms-culture",
      context: "chat",
      style: "natural",
      source: "إن شاء الله بخلص الشغل بكرا.",
      invariants: {},
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "إن شاء الله hedging not flattened into certainty, not over-translated as theology",
      },
    },
    {
      id: "ar-de-sarcasm-third-glass",
      direction: "ar→de",
      category: "sarcasm-implied",
      context: "chat",
      style: "casual",
      source: "شاطر! كسرت الكاسة التالتة اليوم.",
      invariants: {
        expectSarcasm: true,
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Sarcasm audible in German: شاطر is ironic praise, not a compliment",
      },
    },
    {
      id: "ar-de-negation-party",
      direction: "ar→de",
      category: "negation-ambiguity",
      context: "chat",
      style: "casual",
      source: "ما رح آجي عالحفلة لأني مش مبسوط.",
      invariants: {
        negation: "keep",
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Two negations survive; the reason clause not inverted",
      },
    },
    {
      id: "ar-de-ambiguity-bank",
      direction: "ar→de",
      category: "negation-ambiguity",
      context: "general",
      style: "natural",
      source: "رحت عالبنك.",
      invariants: {
        expectAmbiguous: true,
        requiredTerms: [
          {
            id: "bank",
            any: ["Bank"],
            note: "البنك = bank",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "The single-word ambiguity (bank as institution) is not invented into two readings",
      },
    },
    {
      id: "ar-de-technical-database",
      direction: "ar→de",
      category: "technical",
      context: "work",
      style: "natural",
      source: "حدث خطأ في قاعدة البيانات أثناء ترحيل البيانات إلى الخادم.",
      invariants: {
        requiredTerms: [
          {
            id: "database",
            any: ["Datenbank"],
            note: "قاعدة البيانات = database",
          },
          {
            id: "server",
            any: ["Server"],
            note: "الخادم = server",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Technical terms stay precise (database, migration, server)",
      },
    },
    {
      id: "ar-de-facts-shipment",
      direction: "ar→de",
      category: "facts-numbers",
      context: "official",
      style: "formal",
      source: "وصلت الشحنة يوم 12/03/2026 ووزنها 47.5 كيلوغرام وتكلفتها 1,250 يورو.",
      invariants: {
        numbers: ["12-3-2026", "47.5", "1250"],
        requiredTerms: [
          {
            id: "shipment",
            any: ["Sendung", "Lieferung", "Ware"],
            note: "الشحنة = shipment",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Date, weight and price survive; unit not silently converted",
      },
    },
    {
      id: "ar-de-long-paragraph",
      direction: "ar→de",
      category: "long-paragraph",
      context: "official",
      style: "formal",
      source:
        "أعلنت شركة النور للتقنية في بيان لها أن مشروع التحول الرقمي الذي بدأ في شهر آذار من عام 2026 قد وصل إلى مرحلته الثالثة، بعد أن أنجز الفريق الفني ترحيل أكثر من 150 نظاماً داخلياً إلى المنصة السحابية الجديدة. وأوضح المدير التنفيذي، السيد خالد الحلبي، أن المشروع يهدف إلى تسريع الخدمات وتقليل الأخطاء اليدوية، مشيراً إلى أن الموظفين تلقوا تدريباً على الأدوات الجديدة على مدى ثلاثة أشهر.\n\nوقالت الشركة إن التكلفة الإجمالية للمشروع بلغت نحو 3 ملايين يورو، وإنها تتوقع توفير 20 بالمئة من وقت المعالجة اليومي. كما أشار البيان إلى أن الدعم الفني سيبقى متاحاً على مدار الساعة خلال الفترة الانتقالية، وأن أي عطل في النظام يجب الإبلاغ عنه فوراً إلى فريق العمليات.\n\nوفي ختام البيان، دعت الشركة عملاءها إلى تحديث بياناتهم عبر الموقع الرسمي قبل نهاية الشهر، مؤكدة أن الخدمة ستبقى متاحة دون انقطاع، وأن الفريق سينشر تقريراً مفصلاً عن النتائج في بداية العام المقبل.",
      invariants: {
        numbers: ["2026", "150", "3", "20"],
        paragraphs: 3,
        requiredTerms: [
          {
            id: "project",
            any: ["Projekt"],
            note: "المشروع = project",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Three paragraphs stay three; numbers and the named executive survive",
      },
    },
    {
      id: "ar-de-chat-link-emoji",
      direction: "ar→de",
      category: "everyday-chat",
      context: "chat",
      style: "casual",
      source: "شفت الفيديو؟ https://example.com/video 😂",
      invariants: {
        questionMark: true,
        urls: ["https://example.com/video"],
        emojis: ["😂"],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "URL and emoji untouched; the question stays a question",
      },
    },
    {
      id: "ar-de-work-pdf",
      direction: "ar→de",
      category: "workplace",
      context: "work",
      style: "formal",
      source: "ممكن ترسللي الملف بصيغة PDF قبل الساعة 5 العصر؟",
      invariants: {
        questionMark: true,
        numbers: ["5"],
        requiredTerms: [
          {
            id: "pdf",
            any: ["PDF"],
            note: "file format must not be translated",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Polite request preserved; PDF and time not changed",
      },
    },
    {
      id: "ar-de-official-closing",
      direction: "ar→de",
      category: "official",
      context: "official",
      style: "formal",
      source: "وتفضلوا بقبول فائق الاحترام.",
      invariants: {},
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Formal closing rendered as a German letter closing, not a literal wish",
      },
    },
    {
      id: "ar-de-news-numbers",
      direction: "ar→de",
      category: "facts-numbers",
      context: "general",
      style: "natural",
      source: "أعلنت الوزارة أن عدد المسجلين بلغ 12,500 شخصاً.",
      invariants: {
        numbers: ["12500"],
        requiredTerms: [
          {
            id: "ministry",
            any: ["Ministerium"],
            note: "الوزارة = ministry",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Large number not rounded or reformatted into a wrong value",
      },
    },
    {
      id: "ar-de-levantine-evening",
      direction: "ar→de",
      category: "levantine",
      context: "chat",
      style: "casual",
      source: "هلق أنا رايح عالشغل، بحكي معك بعدين.",
      invariants: {
        registerMarkers: {
          id: "casual-de",
          any: ["du", "dich", "dir", "mal", "später"],
          note: "casual spoken register",
        },
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Levantine هلق/بحكي read in context, not as MSA",
      },
    },
    {
      id: "ar-de-implied-reproach",
      direction: "ar→de",
      category: "sarcasm-implied",
      context: "chat",
      style: "casual",
      source: "براحتك، أنا مش زعلان أبداً.",
      invariants: {
        negation: "keep",
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Implied reproach kept; not flattened into a neutral statement",
      },
    },
    {
      id: "de-ar-chat-evening",
      direction: "de→ar",
      category: "everyday-chat",
      context: "chat",
      style: "casual",
      dialect: "levant",
      source: "Hey, hast du heute Abend Zeit?",
      invariants: {
        questionMark: true,
        dialectMarkers: {
          id: "levantine",
          any: ["شو", "بدي", "هلق", "كتير", "تسلم", "بحكي", "منيح", "رح"],
          note: "casual Arabic should sound spoken Levantine, not MSA",
        },
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Casual question rendered in spoken Levantine, not stiff MSA",
      },
    },
    {
      id: "de-ar-chat-late",
      direction: "de→ar",
      category: "everyday-chat",
      context: "chat",
      style: "casual",
      dialect: "levant",
      source: "Ich hab den Bus verpasst, komme später.",
      invariants: {},
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Missed bus and late arrival kept; no invented excuse",
      },
    },
    {
      id: "de-ar-work-documents",
      direction: "de→ar",
      category: "workplace",
      context: "work",
      style: "formal",
      dialect: "msa",
      source: "Können Sie mir bitte die Unterlagen bis Freitag schicken?",
      invariants: {
        questionMark: true,
        requiredTerms: [
          {
            id: "documents",
            any: ["المستندات", "الوثائق", "الأوراق"],
            note: "Unterlagen = documents",
          },
        ],
        forbiddenTerms: [
          {
            id: "no-levantine",
            any: ["شو", "بدي", "هلق", "منيح", "بحكي"],
            note: "formal MSA must not use Levantine fillers",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Sie-request becomes courteous MSA, not a command",
      },
    },
    {
      id: "de-ar-work-appointment",
      direction: "de→ar",
      category: "workplace",
      context: "work",
      style: "formal",
      dialect: "msa",
      source: "Bitte bestätigen Sie den Termin am 14.11.2026 um 10:30 Uhr.",
      invariants: {
        numbers: ["14-11-2026", "10:30"],
        requiredTerms: [
          {
            id: "appointment",
            any: ["الموعد"],
            note: "Termin = appointment",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Date and time preserved exactly; confirmation request stays polite",
      },
    },
    {
      id: "de-ar-official-letter",
      direction: "de→ar",
      category: "official",
      context: "official",
      style: "formal",
      dialect: "msa",
      source: "Sehr geehrte Frau Müller, vielen Dank für Ihren Antrag vom 02.09.2026.",
      invariants: {
        numbers: ["2-9-2026"],
        requiredTerms: [
          {
            id: "name",
            any: ["مولر", "موللر", "ميلر", "مولّر"],
            note: "Müller transliteration",
          },
          {
            id: "application",
            any: ["طلبك", "طلبكم", "الطلب"],
            note: "Antrag = application",
          },
        ],
        registerMarkers: {
          id: "formal-ar",
          any: ["حضرتك", "يرجى", "أرجو", "تفضلوا", "تقدير", "امتنان"],
          note: "official courtesy",
        },
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Letter opening keeps official courtesy; name transliterated consistently",
      },
    },
    {
      id: "de-ar-official-permit",
      direction: "de→ar",
      category: "official",
      context: "official",
      style: "formal",
      dialect: "msa",
      source: "Hiermit beantrage ich die Verlängerung meiner Aufenthaltsgenehmigung.",
      invariants: {
        requiredTerms: [
          {
            id: "residence",
            any: ["الإقامة", "الاقامة"],
            note: "Aufenthaltsgenehmigung = residence permit",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Administrative term for residence permit correct, request formal",
      },
    },
    {
      id: "de-ar-formal-grateful",
      direction: "de→ar",
      category: "formal",
      context: "official",
      style: "formal",
      dialect: "msa",
      source:
        "Ich wäre Ihnen sehr dankbar, wenn Sie mir die Informationen zukommen lassen könnten.",
      invariants: {
        requiredTerms: [
          {
            id: "information",
            any: ["المعلومات"],
            note: "Informationen = information",
          },
        ],
        registerMarkers: {
          id: "formal-ar",
          any: ["حضرتك", "يرجى", "أرجو", "يمكنكم", "بإمكانكم", "تفضلوا", "أكون ممتنًا", "امتنان"],
          note: "polite request",
        },
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Conditional courtesy carried into refined فصحى, not word-for-word",
      },
    },
    {
      id: "de-ar-casual-outside",
      direction: "de→ar",
      category: "casual",
      context: "chat",
      style: "casual",
      dialect: "levant",
      source: "Komm, lass uns kurz rausgehen, ist echt schön draußen.",
      invariants: {
        dialectMarkers: {
          id: "levantine",
          any: ["شو", "بدي", "هلق", "كتير", "تسلم", "بحكي", "منيح", "رح", "يلا"],
          note: "spoken invitation",
        },
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Invitation sounds like friends talking, not an MSA announcement",
      },
    },
    {
      id: "de-ar-idiom-thumbs",
      direction: "de→ar",
      category: "idioms-culture",
      context: "chat",
      style: "natural",
      dialect: "auto",
      source: "Ich drücke dir ganz fest die Daumen.",
      invariants: {},
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "German idiom replaced by a natural Arabic wish, not a literal thumb-pressing",
      },
    },
    {
      id: "de-ar-idiom-beer",
      direction: "de→ar",
      category: "idioms-culture",
      context: "chat",
      style: "natural",
      dialect: "auto",
      source: "Das ist nicht mein Bier.",
      invariants: {
        negation: "keep",
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Idiom means 'not my concern'; negation must survive",
      },
    },
    {
      id: "de-ar-sarcasm-rain",
      direction: "de→ar",
      category: "sarcasm-implied",
      context: "chat",
      style: "casual",
      dialect: "levant",
      source: "Super, jetzt regnet es auch noch. Genau mein Tag.",
      invariants: {
        expectSarcasm: true,
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Sarcasm survives: 'Super' and 'Genau mein Tag' are ironic",
      },
    },
    {
      id: "de-ar-negation-sister",
      direction: "de→ar",
      category: "negation-ambiguity",
      context: "chat",
      style: "natural",
      dialect: "auto",
      source: "Ich habe niemandem davon erzählt, nicht einmal meiner Schwester.",
      invariants: {
        negation: "keep",
        requiredTerms: [
          {
            id: "sister",
            any: ["أختي"],
            note: "Schwester = sister",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Double negation (niemandem / nicht einmal) preserved without inverting meaning",
      },
    },
    {
      id: "de-ar-ambiguity-bank",
      direction: "de→ar",
      category: "negation-ambiguity",
      context: "general",
      style: "natural",
      dialect: "auto",
      source: "Die Bank war heute geschlossen.",
      invariants: {
        expectAmbiguous: true,
        requiredTerms: [
          {
            id: "bank",
            any: ["المصرف", "البنك"],
            note: "Bank = bank",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Ambiguity of Bank not invented into an extra reading",
      },
    },
    {
      id: "de-ar-technical-migration",
      direction: "de→ar",
      category: "technical",
      context: "work",
      style: "formal",
      dialect: "msa",
      source: "Der Datenbankfehler tritt beim Migrieren der Datensätze auf.",
      invariants: {
        requiredTerms: [
          {
            id: "database",
            any: ["قاعدة البيانات"],
            note: "Datenbank = database",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Database/migration/records remain precise technical terms",
      },
    },
    {
      id: "de-ar-invoice",
      direction: "de→ar",
      category: "facts-numbers",
      context: "official",
      style: "formal",
      dialect: "msa",
      source:
        "Die Rechnung über 1.250,50 Euro wurde am 30.06.2026 bezahlt, Lieferant: Müller GmbH.",
      invariants: {
        numbers: ["1250.5", "30-6-2026"],
        requiredTerms: [
          {
            id: "invoice",
            any: ["الفاتورة"],
            note: "Rechnung = invoice",
          },
          {
            id: "euro",
            any: ["يورو"],
            note: "currency kept",
          },
          {
            id: "supplier",
            any: ["مولر", "موللر", "ميلر"],
            note: "Müller transliteration",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Invoice amount, date and supplier kept exactly; currency not converted",
      },
    },
    {
      id: "de-ar-units-package",
      direction: "de→ar",
      category: "facts-numbers",
      context: "general",
      style: "natural",
      dialect: "auto",
      source: "Das Paket wiegt 2,5 kg und ist 30 cm lang.",
      invariants: {
        numbers: ["2.5", "30"],
        requiredTerms: [
          {
            id: "kg",
            any: ["كغ", "كجم", "كيلوغرام", "كيلوغراماً", "كيلو"],
            note: "kg unit kept",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Weight and length units kept; decimal 2,5 not mistaken for 25 or 2-5",
      },
    },
    {
      id: "de-ar-long-paragraph",
      direction: "de→ar",
      category: "long-paragraph",
      context: "official",
      style: "formal",
      dialect: "msa",
      source:
        "Die Stadtverwaltung hat am 14. Oktober 2025 den neuen Nahverkehrsplan vorgestellt. Danach sollen bis Ende 2027 insgesamt 48 Buslinien auf elektrische Fahrzeuge umgestellt und die Takte auf den Hauptachsen auf zehn Minuten verkürzt werden. Der Plan sieht außerdem neue Radwege entlang der Hauptstraße vor, die mit dem bestehenden Netz verbunden werden.\n\nWie die Verkehrsdezernentin Frau Schneider erklärte, rechnet die Stadt mit Kosten von rund 3 Millionen Euro für die ersten beiden Bauabschnitte. Ein Förderantrag beim Land sei bereits eingereicht worden. Die Verwaltung will die Bürgerinnen und Bürger in zwei Informationsveranstaltungen im Januar beteiligen und Anregungen bis zum 15. Februar 2027 entgegennehmen.\n\nKritik kam von den Anwohnern der östlichen Stadtteile, die eine bessere Anbindung an den Hauptbahnhof fordern. Die Stadtverwaltung kündigte an, die Hinweise zu prüfen und den Plan im Frühjahr 2027 erneut vorzulegen.",
      invariants: {
        numbers: ["14-10-2025", "2027", "48", "3", "15-2-2027"],
        paragraphs: 3,
        requiredTerms: [
          {
            id: "administration",
            any: ["البلدية", "الإدارة", "إدارة المدينة"],
            note: "Stadtverwaltung = city administration",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Three paragraphs stay three; dates, counts and the criticized details survive",
      },
    },
    {
      id: "de-ar-chat-link-emoji",
      direction: "de→ar",
      category: "everyday-chat",
      context: "chat",
      style: "casual",
      dialect: "levant",
      source: "Schau mal: https://example.com/de 😊",
      invariants: {
        urls: ["https://example.com/de"],
        emojis: ["😊"],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "URL and emoji untouched; 'Schau mal' stays a casual nudge",
      },
    },
    {
      id: "de-ar-work-printer",
      direction: "de→ar",
      category: "workplace",
      context: "work",
      style: "casual",
      dialect: "levant",
      source: "Kannst du mir mal kurz helfen? Der Drucker spinnt wieder.",
      invariants: {
        questionMark: true,
        requiredTerms: [
          {
            id: "printer",
            any: ["الطابعة"],
            note: "Drucker = printer",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Colleague chat: du-request informal, 'spinnt' rendered as malfunction not madness",
      },
    },
    {
      id: "de-ar-formal-thanks",
      direction: "de→ar",
      category: "formal",
      context: "official",
      style: "formal",
      dialect: "msa",
      source: "Vielen Dank für Ihre schnelle Rückmeldung.",
      invariants: {
        requiredTerms: [
          {
            id: "reply",
            any: ["الرد", "ردكم", "إجابتكم"],
            note: "Rückmeldung = reply",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Formal thanks, no casual 'تسلم'",
      },
    },
    {
      id: "de-ar-formal-notice",
      direction: "de→ar",
      category: "formal",
      context: "official",
      style: "formal",
      dialect: "msa",
      source: "Bitte beachten Sie die beigefügten Hinweise.",
      invariants: {
        requiredTerms: [
          {
            id: "notes",
            any: ["الملاحظات", "الإرشادات", "التنبيهات", "الملاحظات المرفقة"],
            note: "Hinweise = notes",
          },
        ],
      },
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Instruction stays formal and refers to attached notes",
      },
    },
    {
      id: "de-ar-implied-yours",
      direction: "de→ar",
      category: "sarcasm-implied",
      context: "chat",
      style: "casual",
      dialect: "levant",
      source: "Na ja, wie du meinst.",
      invariants: {},
      humanReview: {
        status: "NOT_VERIFIED",
        reviewer: null,
        reviewedAt: null,
        focus: "Resigned 'as you wish' tone kept, not turned into agreement",
      },
    },
  ],
};
