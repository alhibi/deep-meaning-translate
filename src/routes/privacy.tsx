import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { initLocale, useI18n } from "@/lib/i18n";
import { DataControls } from "@/components/DataControls";

export const Route = createFileRoute("/privacy")({
  // Public and indexable: a privacy page is a page people look for.
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "Privacy — today" },
      {
        name: "description",
        content:
          "What today stores on your device, what is sent to translation and voice services, and what is never collected. No accounts, no tracking, no stored translations on our servers.",
      },
      { property: "og:title", content: "Privacy — today" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://fluently.today/privacy" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://fluently.today/privacy" }],
  }),
  component: PrivacyPage,
});

/**
 * Written as a short, specific statement of facts — not a legal template. Every claim
 * here corresponds to something the code actually does (see AGENTS.md and AUDIT.md).
 */
const copy = {
  en: {
    title: "Privacy",
    lead: "today has no accounts, no analytics and no advertising. Everything you write is yours; this page lists exactly what leaves your device and why.",
    updated: "Last updated: 24 October 2026",
    sections: [
      {
        title: "What stays on your device",
        body: "Your current draft, your translation archive (up to 2,000 entries), your phrasebook, your language pair, style, theme and voice preferences are stored only on this device — app-private storage in the Android app, this browser's local storage on the web. They are never uploaded. Clearing the app's data (or clearing this site's data in a browser) removes them permanently.",
      },
      {
        title: "What is sent, and to whom",
        body: "The text you translate is sent over an encrypted connection to a language model (DeepSeek, and OpenCode when enabled) to produce the translation. When you tap Listen, the translated sentence — not the original — is sent to a speech service (ElevenLabs or Gemini), or read by your device's own voice. When you use the microphone, audio goes to AssemblyAI for transcription. Nothing else is transmitted.",
      },
      {
        title: "What is never kept",
        body: "Our servers do not store your text, translations or audio. Request logs contain only counts and timings — never content, never languages paired with content. There are no cookies, no tracking pixels and no third-party analytics.",
      },
      {
        title: "Third-party processing",
        body: "The services named above process the text only to return a result. Their own handling is governed by their terms. For confidential material, review the result before sharing; a device voice may still be synthesized by a TTS engine that downloads voices. Saved phrases, the archive and statistics never leave your device.",
      },
      {
        title: "Your controls",
        body: "You can delete a single phrase, clear the archive and phrasebook, or remove everything from the statistics page. Uninstalling the app or clearing its data deletes all of it; in a browser that is clearing this site's data. No request to a server is needed to erase your data.",
      },
      {
        title: "Children and contact",
        body: "today is a general-purpose translation tool and is not directed at children. Questions about this page can be sent to the address published on the site.",
      },
    ],
  },
  ar: {
    title: "الخصوصية",
    lead: "لا حسابات ولا تحليلات ولا إعلانات في today. كل ما تكتبه ملكك؛ وتسرد هذه الصفحة بالضبط ما يخرج من جهازك ولماذا.",
    updated: "آخر تحديث: 24 أكتوبر 2026",
    sections: [
      {
        title: "ما يبقى على جهازك",
        body: "مسوّدتك الحالية، وأرشيف ترجماتك (حتى 2000 مدخل)، ودفتر عباراتك، واللغتان المختارتان، والأسلوب والثيم وإعدادات الصوت — كلها محفوظة على هذا الجهاز فقط: في تخزين التطبيق الخاص على Android، وفي التخزين المحلي للمتصفح على الويب. لا تُرفع أبداً، ومسح بيانات التطبيق (أو بيانات الموقع في المتصفح) يحذفها نهائياً.",
      },
      {
        title: "ما يُرسل وإلى مَن",
        body: "يُرسل النص الذي تترجمه عبر اتصال مشفّر إلى نموذج لغوي (DeepSeek، وOpenCode عند تفعيله) لإنتاج الترجمة. وعند الضغط على «استماع» تُرسل الجملة المترجمة — لا الأصل — إلى خدمة صوت (ElevenLabs أو Gemini)، أو يقرأها صوت جهازك. وعند استخدام الميكروفون يُرسل الصوت إلى AssemblyAI للتفريغ. لا يُرسل شيء غير ذلك.",
      },
      {
        title: "ما لا يُحفظ إطلاقاً",
        body: "لا تخزّن خوادمنا نصّك ولا ترجماتك ولا صوتك. سجلات الطلبات تحتوي أعداداً وأزمنة فقط، لا محتوى ولا أزواج لغات مرتبطة بمحتوى. لا ملفات تعريف ارتباط ولا أدوات تتبّع ولا تحليلات طرف ثالث.",
      },
      {
        title: "المعالجة لدى أطراف ثالثة",
        body: "الخدمات المذكورة أعلاه تعالج النص لإرجاع نتيجة فقط، ويخضع تعاملها لشروطها. للمواد السرّية راجع النتيجة قبل المشاركة؛ فصوت الجهاز قد يعتمد على محرّك نطق ينزّل الأصوات. العبارات المحفوظة والأرشيف والإحصاءات لا تغادر جهازك.",
      },
      {
        title: "تحكّمك",
        body: "يمكنك حذف عبارة واحدة، أو مسح الأرشيف ودفتر العبارات، أو حذف كل شيء من صفحة الإحصاءات. إلغاء تثبيت التطبيق أو مسح بياناته يحذف كل ذلك، وفي المتصفح يكفي مسح بيانات الموقع. لا يُرسل أي طلب إلى خادم لمسح بياناتك.",
      },
      {
        title: "الأطفال والتواصل",
        body: "today أداة ترجمة عامة غير موجّهة للأطفال. يمكن إرسال الأسئلة حول هذه الصفحة إلى العنوان المنشور على الموقع.",
      },
    ],
  },
  de: {
    title: "Datenschutz",
    lead: "today hat keine Konten, keine Analyse und keine Werbung. Alles, was du schreibst, gehört dir; diese Seite listet genau auf, was dein Gerät verlässt und warum.",
    updated: "Zuletzt aktualisiert: 24. Oktober 2026",
    sections: [
      {
        title: "Was auf deinem Gerät bleibt",
        body: "Dein aktueller Entwurf, dein Übersetzungsarchiv (bis zu 2.000 Einträge), dein Phrasenbuch, Sprachpaar, Stil, Farbschema und Stimmeinstellungen liegen ausschließlich auf diesem Gerät — im app-privaten Speicher der Android-App, im lokalen Speicher dieses Browsers im Web. Sie werden nie hochgeladen; das Löschen der App-Daten (bzw. der Websitedaten im Browser) entfernt sie endgültig.",
      },
      {
        title: "Was gesendet wird — und an wen",
        body: "Der zu übersetzende Text geht verschlüsselt an ein Sprachmodell (DeepSeek, bei Aktivierung OpenCode). Beim Antippen von „Anhören“ wird der übersetzte Satz — nicht das Original — an einen Sprachdienst (ElevenLabs oder Gemini) gesendet oder von der Gerätestimme gelesen. Bei Nutzung des Mikrofons geht Audio zur Transkription an AssemblyAI. Mehr wird nicht übertragen.",
      },
      {
        title: "Was nie gespeichert wird",
        body: "Unsere Server speichern weder Text noch Übersetzungen noch Audio. Anfrageprotokolle enthalten nur Zähler und Laufzeiten — keine Inhalte, keine Sprachpaare mit Inhalt. Es gibt keine Cookies, keine Tracking-Pixel und keine Analyse von Dritten.",
      },
      {
        title: "Verarbeitung durch Dritte",
        body: "Die genannten Dienste verarbeiten den Text nur, um ein Ergebnis zurückzugeben; ihre Bedingungen gelten. Prüfe bei Vertraulichem das Ergebnis vor dem Teilen; eine Gerätestimme kann von einer TTS-Engine stammen, die Stimmen herunterlädt. Gespeicherte Phrasen, Archiv und Statistik verlassen dein Gerät nie.",
      },
      {
        title: "Deine Kontrolle",
        body: "Du kannst einzelne Phrasen löschen, Archiv und Phrasenbuch leeren oder auf der Statistikseite alles entfernen. Die App zu deinstallieren oder ihre Daten zu löschen entfernt alles; im Browser sind es die Websitedaten. Dafür ist keine Anfrage an einen Server nötig.",
      },
      {
        title: "Kinder und Kontakt",
        body: "today ist ein allgemeines Übersetzungswerkzeug und richtet sich nicht an Kinder. Fragen zu dieser Seite können an die auf der Website genannte Adresse gesendet werden.",
      },
    ],
  },
};

function PrivacyPage() {
  const { locale, rtl } = useI18n();
  useEffect(() => initLocale(), []);
  const content = copy[locale];
  return (
    <main
      dir={rtl ? "rtl" : "ltr"}
      lang={locale}
      className="mx-auto min-h-[100dvh] max-w-2xl px-5 pb-14 text-foreground pad-safe-top"
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
          {locale === "ar" ? "المترجم" : locale === "de" ? "Übersetzer" : "Translator"}
        </Link>
      </header>
      <h1 className="mt-8 text-[28px] font-semibold leading-snug">{content.title}</h1>
      <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">{content.lead}</p>
      <p className="mt-3 text-[12px] uppercase tracking-[0.09em] text-faint">{content.updated}</p>
      <div className="mt-8 space-y-7">
        {content.sections.map((section) => (
          <section key={section.title} className="border-t border-border pt-5">
            <h2 className="text-[17px] font-semibold">{section.title}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{section.body}</p>
          </section>
        ))}
      </div>
      <DataControls />
    </main>
  );
}
