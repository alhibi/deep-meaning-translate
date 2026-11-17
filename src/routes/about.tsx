import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { initLocale, useI18n, type Locale } from "@/lib/i18n";
import { DataControls } from "@/components/DataControls";
import { ProviderKey } from "@/components/ProviderKey";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";

/**
 * One public page for who today is, how it translates, and what happens to your text.
 *
 * It replaces the two separate footer entries (privacy, pair guide) with one readable
 * sequence; the old paths stay alive as permanent redirects to their sections, so an
 * external link and a search result still land on the right content. Every claim below
 * was checked against the code (docs/security/privacy-and-threat-model.md); the
 * "last reviewed" line changes only when the content below it was actually re-reviewed.
 */
export const Route = createFileRoute("/about")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "About today — meaning-first Arabic–German translation" },
      {
        name: "description",
        content:
          "What today is, how a meaning-first translation is made, which registers and Arabic dialects exist, what stays on your device, what is sent to translation, voice and dictation services, and where the data controls are.",
      },
      { property: "og:title", content: "About today — meaning-first Arabic–German translation" },
      {
        property: "og:description",
        content:
          "Meaning before words: how today translates, what never leaves your device, and the controls that keep it yours.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://fluently.today/about" },
      { property: "og:locale", content: "en" },
      { property: "og:locale:alternate", content: "ar" },
      { property: "og:locale:alternate", content: "de" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "index, follow, max-image-preview:large" },
    ],
    links: [{ rel: "canonical", href: "https://fluently.today/about" }],
  }),
  component: AboutPage,
});

type Section = { id: string; title: string; paras: string[] };

type Copy = {
  title: string;
  lead: string;
  updated: string;
  contents: string;
  start: string;
  controlsLead: string;
  sections: Section[];
};

const copy: Record<Locale, Copy> = {
  ar: {
    title: "عن today",
    lead: "today مترجم بين العربية والألمانية يبدأ من المعنى: ما تقصده، وكيف تبدو نبرتك، وما ينبغي أن يسمعه الطرف الآخر — لا من الكلمات واحدة واحدة. شاشة واحدة هادئة، بلا حساب، وكل ما تكتبه يبقى لك.",
    updated: "آخر مراجعة: 17 نوفمبر 2026",
    contents: "في هذه الصفحة",
    start: "افتح المترجم",
    controlsLead:
      "تغطي الأدوات التالية التصدير والاستيراد وحالة التخزين، وفي التطبيق المثبّت مفتاحك الخاص وتشخيص آخر طلب. التشخيص يحمل بيانات وصفية فقط: لا جملة ولا مفتاح ولا ترويسة. ومن نافذة الطقس يمكنك تغيير المكان أو إزالته، ومن «المحفوظ» حذف الاكتشافات المحفوظة، و«امسح كل شيء» يزيل كليهما مع بقية المخازن.",
    sections: [
      {
        id: "meaning",
        title: "المعنى قبل الكلمات",
        paras: [
          "قد تكون الجملة سليمة كلمةً كلمة وتبقى خاطئة. «Ich habe Tomaten auf den Augen» ليست عن البندورة، و«إن شاء الله» ليست موافقة محايدة. صُمّم today لينقل القصد والنبرة والثقل الثقافي، ويكتب ما يقوله إنسان ابن اللغة فعلاً في ذلك الموقف.",
          "المترجم مضبوط على العربية ⇄ الألمانية. أما بقية الأزواج فتستخدم النموذج نفسه والتعليمات نفسها، لكن أمثلة المراجعة وإرشاد اللهجات أقوى في هذا الزوج.",
          "ليس قاموساً ولا دورة لغة ولا محادثة. إنه يترجم: لا يشرح نصّك لك، ولا يلطّف ما قلته، ولا يجيب سؤالاً طلبتَ ترجمته.",
        ],
      },
      {
        id: "translation",
        title: "كيف تُصنع الترجمة",
        paras: [
          "تُرسل كل جملة إلى نموذج لغوي مع تعليمات عن المعنى والأسلوب واللهجة وتنسيق النص. ووراء النتيجة فحصان: تحقّق آلي يقارن الأرقام والتواريخ والأسماء والروابط والرموز التعبيرية وعلامات الترقيم بين الأصل والترجمة، وقراءة ثانية هادئة قد تصحّح خطأً حقيقياً قبل أن تستقر النتيجة. أثناء الكتابة تظهر ترجمة مؤقتة كلمةً كلمة، وعندما تتوقف تستقر الجملة نتيجةً مدقّقة.",
          "الأسلوب هو صوت النتيجة، ويغيّر الصياغة لا التسمية: الطبيعي يحاكي أسلوب الأصل، والرسمي مؤدّب وموجّه للمكاتبات مع «Sie» الألمانية وفصحى مصقولة، والعفوي كما يتراسل الناس بينهم مع «du» واللهجة. اختر بحسب المتلقي، لا بحسب اللغة.",
          "للترجمة إلى العربية يمكنك اختيار الفصحى أو الشامية أو المصرية أو الخليجية أو العراقية أو المغاربية. يُوجَّه النموذج لقراءة التعابير والأخطاء الإملائية المحتملة من السياق، لكن العبارة القصيرة قد تبقى ملتبسة، وإضافة سياق تساعد. والغموض الحقيقي يبقى غموضاً: إذا كان للنص قراءتان فعليتان يعرض today البديل بدل أن يختار واحدة بصمت.",
          "إلى جانب الترجمة مساعدان لا بديلان عنها. المعجم يقرأ كلمة أو مصطلحاً قصيراً في الاتجاه واللهجة المختارين، ويعرض معاني وصيغاً وأمثلة يولّدها النموذج، لا من قاموس موثّق، فقد تكون ناقصة أو خاطئة. وخريطة الظل تقارن ترجمة مستقرة بأصلها وتشير إلى ما قد يكون ضاع من دفء أو تأكيد أو احترام أو سخرية أو غموض أو إشارة ثقافية أو إيقاع أو معنى ضمني؛ إنها تقدير لا حكم، وستقول في كثير من الأحيان إن شيئاً لم يضع.",
          "الترجمة مولّدة. الأسماء والمصطلحات التقنية والمستندات القانونية والطبية والمعتمدة تستحق مراجعة بشرية.",
        ],
      },
      {
        id: "privacy",
        title: "ما يبقى على جهازك",
        paras: [
          "مسوّدتك الحالية، وأرشيف ترجماتك (حتى 2000 مدخل)، ودفتر عباراتك، وذاكرة ترجمة قصيرة على الجهاز (ثلاثون يوماً) تجيب جملة ترجمتَها سابقاً — كلها محفوظة على هذا الجهاز فقط. وكذلك اللغتان والأسلوب والثيم وإعدادات الصوت والواجهة، والإحصاءات المحسوبة من أرشيفك على الجهاز.",
          "في تطبيق Android يكون هذا تخزيناً خاصاً بالتطبيق، وفي المتصفح هو التخزين المحلي لهذا الموقع. لا يُرفع شيء من هذه المخازن.",
          "يمكنك تصدير ملف نسخة احتياطية، محمياً بكلمة مرور إن أردت (تشفير AES-GCM عبر WebCrypto بمفتاح مشتق بـPBKDF2). يبقى الملف في يدك ولا يرفعه التطبيق، وقبل الاستيراد يبيّن لك ما يحتويه قبل أن يغيّر شيئاً.",
          "وتُحفظ أيضاً آخر توقعات الطقس (نسخة محدودة لآخر الأماكن فقط) وقائمة مقالاتك المحفوظة وسجل قصير لما شاهدته (لتفادي التكرار) — كلها على جهازك وحده، وتُمسح مع «امسح كل شيء». ولا يُحفظ موقعك الخام أبداً.",
          "المحو محلي وفوري: احذف عبارة، أو امسح الأرشيف ودفتر العبارات، أو امسح كل شيء، دون أي طلب إلى خادم.",
        ],
      },
      {
        id: "sent",
        title: "ما يُرسل ولماذا",
        paras: [
          "للترجمة يُرسل النص الذي كتبته عبر HTTPS إلى DeepSeek ويعود. والمعجم وخريطة الظل والقراءة الثانية ترسل الكلمة أو الجملة التي تحلّلها مع الاتجاه والأسلوب. لا يُرسل شيء قبل أن يكون هناك ما يُترجم.",
          "عند الضغط على «استماع» تُرسل الجملة المترجمة — لا الأصل — إلى خدمة الصوت المختارة (ElevenLabs أو Gemini)، أو يقرأها صوت جهازك. وعند استخدام الميكروفون يُرسل الصوت إلى AssemblyAI للتفريغ، ويصدر خادمنا رمزاً مؤقتاً لتلك الجلسة، فلا يوجد مفتاح دائم على الجهاز.",
          "على Android يمكنك إدخال مفتاح DeepSeek الخاص بك. في هذا الوضع تُطلب الترجمات من جهازك مباشرة إلى DeepSeek بمفتاحك: يبقى المفتاح في تخزين التطبيق الخاص، ولا يدخل النسخ الاحتياطية، ولا يُسجَّل، ولا يُرسل إلى خوادم today.",
          "الطقس المحلي اختياري تماماً: لا يُطلب الموقع تلقائياً. إذا اخترت «استخدم موقعي»، يُطلب موقع تقريبي فقط (تُقرَّب الإحداثيات إلى منزلتين عشريتين، نحو كيلومتر واحد) ويُرسل عبر خادمنا إلى Open-Meteo للتوقعات، وإلى Open-Meteo لأسماء المدن أو إلى Nominatim/OpenStreetMap لعكس اسم الموقع إن اخترت موقعاً من جهازك. لا تتبّع في الخلفية، ولا سجل مواقع، ولا يصل موقعك إلى خدمات الترجمة أو الصوت أو التفريغ.",
          "ولا يخرج من جهازك شيء آخر: لا تحليلات ولا إعلانات ولا أدوات تتبع ولا ملفات تعريف ارتباط للتتبع؛ والطلبات من أصل الموقع نفسه وتُجرى بلا بيانات اعتماد.",
        ],
      },
      {
        id: "third-parties",
        title: "الأطراف الثالثة والحدود",
        paras: [
          "الخدمات المذكورة أعلاه تعالج النص لإرجاع نتيجة فقط، وتخضع لشروطها وسياسات خصوصيتها. لا تخزّن خوادم تطبيقنا جملك ولا ترجماتك ولا صوتك، وسجلات التشغيل تحمل أعداداً وأزمنة ورموز حالة، لا محتوى ولا مفاتيح. ويحتفظ تحديد المعدّل بمفتاح تقريبي في الذاكرة مشتق من عنوان العميل لمدة قصيرة.",
          "تبقى مزوّدات الاستضافة والشبكة ترى بيانات وصفية عادية للطلب — عنوان IP والتوقيت والحجم — كما يرى أي خدمة ويب، وقد تحتفظ بسجلات تشغيل قصيرة الأمد وفق سياستها.",
          "مكتبة الثقافة مكتوبة ونصية ومحزومة داخل التطبيق: تُصنَّع مقالاتها عند البناء من وقائع منسَّقة ومراجع عامة موثَّقة، ولا يجلب التصفّح أي صورة ولا يرسل بيانات عنك. تفتح «المراجع» في نهاية كل مقال مصادرها في تبويب جديد إن اخترت ذلك، وترى تلك المواقع طلباً عادياً حينها فقط. لا يُرسل نصك ولا موقعك إلى المكتبة إطلاقاً. بيانات الطقس من Open-Meteo (رخصة CC BY 4.0، والاستخدام المجاني غير تجاري)، وأسماء الأماكن من OpenStreetMap (رخصة ODbL)، وأسماء البحث من GeoNames عبر Open-Meteo.",
          "النقل مشفّر بـHTTPS من الطرف إلى الطرف. وما بعد ذلك لا توجد طبقة تشفير إضافية في الطريق إلى النموذج، وتعامُل المزوّد نفسه خارج سيطرتنا. للمواد السرّية راجع النتيجة قبل مشاركتها.",
          "قد يُصنَّع صوت الجهاز عبر محرّك النطق في هاتفك، وقد ينزّل أصواتاً من مزوّده. وهذه الصفحة ليست موجّهة للأطفال.",
        ],
      },
      {
        id: "controls",
        title: "أدوات التحكم والتشخيص",
        paras: [],
      },
    ],
  },
  en: {
    title: "About today",
    lead: "today is a translator for Arabic and German that starts from meaning: what you intend, how you sound, and what the other person should hear — not the words one by one. One quiet screen, no account, and everything you write stays yours.",
    updated: "Last reviewed: 17 November 2026",
    contents: "On this page",
    start: "Open translator",
    controlsLead:
      "The tools below cover export, import and storage health, and — in the installed app — your own key and the last-request diagnostics. Diagnostics hold metadata only: no sentence, key or header is stored. In the weather sheet you can change or remove the place; saved discoveries can be removed in “Saved”, and “forget everything” clears both together with the other local stores.",
    sections: [
      {
        id: "meaning",
        title: "Meaning before words",
        paras: [
          "A sentence can be correct word for word and still be wrong. “Ich habe Tomaten auf den Augen” is not about tomatoes; “إن شاء الله” is not a neutral yes. today is built to carry the intent, the tone and the cultural weight across, and to write what a native speaker would actually say in that situation.",
          "The translator is tuned for Arabic ⇄ German. Other pairs use the same model and the same instructions, but the reviewed examples and the dialect guidance are strongest for this pair.",
          "It is not a dictionary, a language course or a chat. It translates: it does not explain your text back to you, soften what you said, or answer a question you asked it to translate.",
        ],
      },
      {
        id: "translation",
        title: "How a translation is made",
        paras: [
          "Each sentence goes to a language model with instructions about meaning, register, dialect and layout. Two checks stand behind the result: a deterministic verification pass compares numbers, dates, names, links, emoji and punctuation between source and translation, and a quiet second reading may correct a real error before the result settles. While you type, a provisional translation appears word by word; when you pause, the sentence settles into a checked result.",
          "The style is the voice of the output and changes the wording, not a label: Natural mirrors the source's own register, Formal is courteous and official with German Sie and refined فصحى, Casual is how people write to each other, with du and dialect. Choose by recipient, not by language.",
          "For Arabic output you can choose Standard Arabic or Levantine, Egyptian, Gulf, Iraqi or Maghrebi. The model is told to read idioms and likely typos from context, but a short dialect phrase can still be ambiguous, and adding context helps. Genuine ambiguity is kept as ambiguity: when a text has two real readings, today shows the alternative instead of silently choosing one.",
          "Two aids sit beside the translation, never in place of it. The dictionary reads a word or a short term in the direction and dialect you chose, showing meanings, forms and examples generated by the model — not entries from a verified dictionary, so they can be incomplete or wrong. The sentence shadow compares a settled translation with its source and points out nuance that may not have survived: warmth, emphasis, respect, irony, ambiguity, cultural reference, rhythm or implied meaning. It is an estimation, not a verdict, and it will often say that nothing was lost.",
          "Translation is generated. Names, technical terms, and legal, medical or certified documents deserve a human review.",
        ],
      },
      {
        id: "privacy",
        title: "What stays on your device",
        paras: [
          "Your current draft, your translation archive (up to 2,000 entries), your phrasebook, and a short on-device translation memory (thirty days) that answers a sentence you translated before are stored only on this device. So are your language pair, style, theme, voice and interface preferences, and the statistics, which are computed from your archive on the device.",
          "In the installed Android app this is app-private storage; on the web it is this browser's local storage for this site. Nothing from those stores is uploaded.",
          "You can export a backup file, optionally protected with a password (AES-GCM through WebCrypto, with a PBKDF2-derived key). It stays in your hands; the app never uploads it. Import shows what the file contains before it changes anything.",
          "The last local forecasts (a bounded cache for recent places), your saved articles and a short seen history — used only to avoid repeats — are also stored on this device alone and are cleared by “forget everything”. Your raw location is never stored.",
          "Erasing is local and immediate: clear a phrase, the archive and phrasebook, or everything, without a request to a server.",
        ],
      },
      {
        id: "sent",
        title: "What is sent, and why",
        paras: [
          "To translate, the text you wrote is sent over HTTPS to DeepSeek and back. The dictionary, the sentence shadow and the second reading send the word or sentence they analyse, with the direction and style. Nothing is sent until there is something to translate.",
          "When you tap Listen, the translated sentence — not the original — is sent to the voice service you selected (ElevenLabs or Gemini), or read by your device's own voice. When you use the microphone, audio is streamed to AssemblyAI for transcription; our server issues a short-lived token for that session, so no permanent key sits on the device.",
          "On Android you can enter your own DeepSeek key. In that mode translation requests go from your device straight to DeepSeek with your key: it stays in the app's private storage, is excluded from backups, is never logged, and is never sent to today's servers.",
          "Local weather is entirely optional: no location is requested automatically. If you choose “Use my location”, only an approximate position (rounded to two decimals, about a kilometre) is sent through our own server to Open-Meteo for the forecast, and — when a place name is needed — to Open-Meteo's geocoding or to OpenStreetMap's Nominatim for a reverse lookup. There is no background tracking, no location history, and your location never reaches the translation, voice or dictation services.",
          "Nothing else leaves your device. There is no analytics, no advertising, no tracking pixel and no tracking cookie; requests are same-origin and are made without credentials.",
        ],
      },
      {
        id: "third-parties",
        title: "Third parties and the limits",
        paras: [
          "The providers named above process the text only to return a result, under their own terms and privacy policies. Our application servers do not store your sentences, translations or audio; operational logs carry counts, timings and status codes — never content, never keys. Rate limiting keeps a coarse, in-memory key derived from the client address for a short time.",
          "Hosting and network providers still see ordinary request metadata — IP address, timing, size — as any web service does, and may keep short-lived operational logs under their own policy.",
          "Cultural discovery is a written, text-only library bundled with the app. Its articles are produced at build time from curated facts and documented public references, so browsing makes no image request and sends nothing about you. Each article's References area opens its sources in a new tab only when you choose to, and those sites then see an ordinary request. No text or location is sent to the library. Weather data comes from Open-Meteo (CC BY 4.0; its free tier is non-commercial), place labels from OpenStreetMap (ODbL) and search place names from GeoNames via Open-Meteo.",
          "Transport is HTTPS end to end. Beyond that there is no additional encryption layer on the way to the model, and the provider's own handling is outside our control. For confidential material, review the result before sharing.",
          "The device voice may be synthesised by your phone's text-to-speech engine, which can download voices from its own provider. This page is not directed at children.",
        ],
      },
      {
        id: "controls",
        title: "Your controls and diagnostics",
        paras: [],
      },
    ],
  },
  de: {
    title: "Über today",
    lead: "today ist ein Übersetzer für Arabisch und Deutsch, der bei der Bedeutung anfängt: was du meinst, wie du klingst und was beim Gegenüber ankommen soll — nicht die Wörter einzeln. Ein ruhiger Bildschirm, kein Konto, und alles, was du schreibst, bleibt deins.",
    updated: "Zuletzt geprüft: 17. November 2026",
    contents: "Auf dieser Seite",
    start: "Übersetzer öffnen",
    controlsLead:
      "Die folgenden Werkzeuge decken Export, Import und Speicherzustand ab, in der installierten App auch deinen eigenen Schlüssel und die Diagnose der letzten Anfrage. Die Diagnose enthält nur Metadaten: keinen Satz, keinen Schlüssel, keine Header. In der Wetterkarte kannst du den Ort ändern oder entfernen; gespeicherte Entdeckungen lassen sich unter „Gespeichert“ löschen, und „Alles löschen“ entfernt beides samt den übrigen lokalen Speichern.",
    sections: [
      {
        id: "meaning",
        title: "Bedeutung vor Wörtern",
        paras: [
          "Ein Satz kann Wort für Wort richtig und trotzdem falsch sein. „Ich habe Tomaten auf den Augen“ handelt nicht von Tomaten; „إن شاء الله“ ist kein neutrales Ja. today ist darauf gebaut, Absicht, Ton und kulturelles Gewicht mitzunehmen und zu schreiben, was ein Muttersprachler in dieser Situation wirklich sagen würde.",
          "Ausgelegt ist der Übersetzer auf Arabisch ⇄ Deutsch. Andere Paare laufen über dasselbe Modell und dieselben Vorgaben, aber geprüfte Beispiele und Dialektführung sind für dieses Paar am stärksten.",
          "Er ist kein Wörterbuch, kein Sprachkurs und kein Chat. Er übersetzt: Er erklärt deinen Text nicht zurück, er entschärft nicht, was du gesagt hast, und er beantwortet keine Frage, die du übersetzt haben willst.",
        ],
      },
      {
        id: "translation",
        title: "Wie eine Übersetzung entsteht",
        paras: [
          "Jeder Satz geht mit Vorgaben zu Bedeutung, Register, Dialekt und Layout an ein Sprachmodell. Hinter dem Ergebnis stehen zwei Prüfungen: ein deterministischer Abgleich von Zahlen, Daten, Namen, Links, Emoji und Satzzeichen zwischen Quelle und Übersetzung, und eine leise zweite Lesung, die einen echten Fehler korrigieren kann, bevor das Ergebnis feststeht. Beim Schreiben erscheint eine vorläufige Übersetzung Wort für Wort; wenn du innehältst, wird der Satz zu einem geprüften Ergebnis.",
          "Der Stil ist die Stimme der Ausgabe und ändert die Formulierung, nicht das Etikett: Natürlich spiegelt das Register der Quelle, Förmlich ist höflich und amtlich mit deutschem Sie und gepflegtem فصحى, Locker ist, wie Menschen einander schreiben, mit du und Dialekt. Wähle nach Empfänger, nicht nach Sprache.",
          "Für Arabisch stehen Hocharabisch sowie levantinisch, ägyptisch, Golf-, irakisch und maghrebinisch zur Wahl. Das Modell soll Redewendungen und wahrscheinliche Tippfehler aus dem Kontext lesen; ein kurzer Dialektsatz kann trotzdem mehrdeutig bleiben, zusätzlicher Kontext hilft. Echte Mehrdeutigkeit bleibt Mehrdeutigkeit: Hat der Text zwei wirkliche Lesarten, zeigt today die Alternative, statt still eine zu wählen.",
          "Neben der Übersetzung stehen zwei Hilfen, nie an ihrer Stelle. Das Wörterbuch liest ein Wort oder einen kurzen Begriff in der gewählten Richtung und im gewählten Dialekt und zeigt Bedeutungen, Formen und Beispiele — vom Modell erzeugt, nicht aus einem geprüften Wörterbuch, also unter Umständen unvollständig oder falsch. Der Satzschatten vergleicht eine feststehende Übersetzung mit ihrer Quelle und benennt Nuancen, die verloren gegangen sein können: Wärme, Nachdruck, Respekt, Ironie, Mehrdeutigkeit, kulturelle Anspielung, Rhythmus oder Subtext. Das ist eine Einschätzung, kein Urteil; oft wird er sagen, dass nichts verloren ging.",
          "Übersetzungen werden generiert. Namen, Fachbegriffe sowie rechtliche, medizinische und beglaubigte Dokumente gehören in menschliche Prüfung.",
        ],
      },
      {
        id: "privacy",
        title: "Was auf deinem Gerät bleibt",
        paras: [
          "Dein Entwurf, dein Übersetzungsarchiv (bis zu 2.000 Einträge), dein Phrasenbuch und ein kurzes Übersetzungsgedächtnis auf dem Gerät (dreißig Tage), das einen früher übersetzten Satz beantwortet, liegen nur auf diesem Gerät. Ebenso Sprachpaar, Stil, Farbschema, Stimme und Oberflächensprache sowie die Statistik, die auf dem Gerät aus deinem Archiv berechnet wird.",
          "In der installierten Android-App ist das app-privater Speicher, im Web der lokale Speicher dieses Browsers für diese Seite. Nichts davon wird hochgeladen.",
          "Du kannst eine Sicherungsdatei exportieren, optional mit Passwort geschützt (AES-GCM über WebCrypto mit PBKDF2-abgeleitetem Schlüssel). Sie bleibt bei dir; die App lädt sie nie hoch. Vor dem Import zeigt sie, was die Datei enthält, bevor sie etwas ändert.",
          "Auch die letzten lokalen Wettervorhersagen (ein begrenzter Zwischenspeicher für zuletzt gewählte Orte), deine gespeicherten Artikel und eine kurze Verlaufsliste — nur um Wiederholungen zu vermeiden — liegen ausschließlich auf diesem Gerät und werden mit „Alles löschen“ entfernt. Dein roher Standort wird nie gespeichert.",
          "Löschen ist lokal und sofort: eine Phrase, Archiv und Phrasenbuch oder alles — ohne Anfrage an einen Server.",
        ],
      },
      {
        id: "sent",
        title: "Was gesendet wird — und warum",
        paras: [
          "Zum Übersetzen geht der geschriebene Text über HTTPS an DeepSeek und zurück. Wörterbuch, Satzschatten und die zweite Lesung senden das Wort oder den Satz, den sie untersuchen, mit Richtung und Stil. Nichts wird gesendet, solange es nichts zu übersetzen gibt.",
          "Beim Antippen von „Anhören“ geht der übersetzte Satz — nicht das Original — an den gewählten Sprachdienst (ElevenLabs oder Gemini) oder wird von der Gerätestimme gelesen. Bei Nutzung des Mikrofons wird Audio zur Transkription an AssemblyAI gestreamt; unser Server stellt für diese Sitzung ein kurzlebiges Token aus, damit kein dauerhafter Schlüssel auf dem Gerät liegt.",
          "Auf Android kannst du deinen eigenen DeepSeek-Schlüssel eintragen. Dann gehen Übersetzungsanfragen direkt von deinem Gerät an DeepSeek, mit deinem Kontingent. Der Schlüssel liegt im app-privaten Speicher, ist von Sicherungen ausgeschlossen, wird nie protokolliert und nie an today-Server gesendet.",
          "Lokales Wetter ist vollständig optional: Es wird nie automatisch nach dem Standort gefragt. Wählst du „Standort verwenden“, wird nur eine ungefähre Position (auf zwei Nachkommastellen, etwa einen Kilometer, gerundet) über unseren eigenen Server an Open-Meteo für die Vorhersage gesendet und — wenn ein Ortsname nötig ist — an die Geokodierung von Open-Meteo oder an Nominatim von OpenStreetMap für eine Rückwärtssuche. Kein Hintergrund-Tracking, kein Standortverlauf, und dein Standort erreicht nie die Übersetzungs-, Sprach- oder Diktatdienste.",
          "Sonst verlässt nichts dein Gerät: keine Analyse, keine Werbung, keine Tracking-Pixel, keine Tracking-Cookies; Anfragen laufen gleichen Ursprungs und ohne Anmeldedaten.",
        ],
      },
      {
        id: "third-parties",
        title: "Dritte und die Grenzen",
        paras: [
          "Die genannten Dienste verarbeiten den Text nur, um ein Ergebnis zurückzugeben, nach ihren eigenen Bedingungen und Datenschutzhinweisen. Unsere Anwendungsserver speichern weder Sätze noch Übersetzungen noch Audio; Betriebsprotokolle enthalten Zähler, Laufzeiten und Statuscodes — keine Inhalte, keine Schlüssel. Die Ratenbegrenzung hält kurzzeitig einen groben, aus der Client-Adresse abgeleiteten Schlüssel im Speicher.",
          "Hosting- und Netzbetreiber sehen weiterhin gewöhnliche Anfrage-Metadaten — IP-Adresse, Zeitpunkt, Größe — wie bei jedem Webdienst und können kurzfristige Betriebsprotokolle nach ihrer eigenen Richtlinie führen.",
          "Der Transport ist durchgehend HTTPS. Darüber hinaus gibt es keine zusätzliche Verschlüsselung auf dem Weg zum Modell, und der Umgang des Anbieters liegt außerhalb unserer Kontrolle. Prüfe Vertrauliches vor dem Teilen.",
          "Die kulturelle Bibliothek ist geschrieben, rein textlich und in der App enthalten. Ihre Artikel entstehen beim Build aus aufbereiteten Fakten und belegten öffentlichen Quellen; beim Blättern wird kein Bild geladen und nichts über dich gesendet. Die Quellen eines Artikels öffnen sich nur auf deinen Wunsch in einem neuen Tab, und diese Seiten sehen dann eine gewöhnliche Anfrage. Weder Text noch Standort werden an die Bibliothek gesendet. Wetterdaten kommen von Open-Meteo (CC BY 4.0; die kostenlose Stufe ist nicht-kommerziell), Ortsnamen von OpenStreetMap (ODbL) und Suchorte von GeoNames über Open-Meteo.",
          "Die Gerätestimme kann von der Text-to-Speech-Engine deines Telefons stammen, die Stimmen bei ihrem Anbieter herunterlädt. Diese Seite richtet sich nicht an Kinder.",
        ],
      },
      {
        id: "controls",
        title: "Deine Kontrolle und Diagnose",
        paras: [],
      },
    ],
  },
};

function AboutPage() {
  const { locale, rtl } = useI18n();
  useEffect(() => initLocale(), []);
  const content = copy[locale];
  const Arrow = rtl ? ArrowLeft : ArrowRight;
  return (
    <main
      dir={rtl ? "rtl" : "ltr"}
      lang={locale}
      className="mx-auto min-h-[100dvh] max-w-2xl px-5 pb-16 text-foreground pad-safe-top"
    >
      <header className="flex items-center justify-between border-b border-border py-3">
        <Link viewTransition to="/" className="text-[16px] font-semibold">
          today
        </Link>
        <Link
          viewTransition
          to="/"
          className="press-soft inline-flex min-h-11 items-center gap-2 text-[14px] text-muted-foreground hover:text-foreground"
        >
          {content.start}
          <Arrow className="size-4" aria-hidden />
        </Link>
      </header>

      <h1 className="mt-8 text-[28px] font-semibold leading-snug">{content.title}</h1>
      <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">{content.lead}</p>
      <p className="mt-3 text-[12px] uppercase tracking-[0.09em] text-faint">{content.updated}</p>

      <nav aria-label={content.contents} className="mt-6 border-t border-border pt-4">
        <p className="text-[11px] uppercase tracking-[0.09em] text-faint">{content.contents}</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] leading-relaxed">
          {content.sections.map((section) => (
            <li key={section.id}>
              <a href={"#" + section.id} className="press-soft underline-offset-4 hover:underline">
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-8 space-y-8">
        {content.sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="scroll-mt-6 border-t border-border pt-5"
          >
            <h2 className="text-[20px] font-medium leading-snug">{section.title}</h2>
            {section.paras.map((para, index) => (
              <p key={index} className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                {para}
              </p>
            ))}
            {section.id === "controls" ? (
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                {content.controlsLead}
              </p>
            ) : null}
          </section>
        ))}
      </div>

      <DataControls />
      <ProviderKey />
      <DiagnosticsPanel />

      <Link
        viewTransition
        to="/"
        className="press-soft mt-10 inline-flex min-h-11 items-center gap-2 text-[16px] font-medium underline underline-offset-4"
      >
        {content.start}
        <Arrow className="size-4" aria-hidden />
      </Link>
    </main>
  );
}
