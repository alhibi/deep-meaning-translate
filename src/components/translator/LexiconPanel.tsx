import { memo, useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { isRtl } from "@/lib/translation/languages";
import type { LexicalKind, LexiconResult } from "@/lib/translation/lexicon";

const LABEL: Record<
  LexicalKind,
  "lexNoun" | "lexAdjective" | "lexVerb" | "lexAdverb" | "lexPhrase" | "lexName" | "lexTerm"
> = {
  noun: "lexNoun",
  adjective: "lexAdjective",
  verb: "lexVerb",
  adverb: "lexAdverb",
  phrase: "lexPhrase",
  proper_noun: "lexName",
  term: "lexTerm",
};

export const LexiconPanel = memo(function LexiconPanel({
  value,
  loading,
}: {
  value: LexiconResult | null;
  loading: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  useEffect(() => setExpanded(false), [value?.sourceTerm, value?.targetLanguage]);

  if (loading && !value) {
    return (
      <div className="animate-fade border-t border-border px-5 py-4" aria-live="polite">
        <span className="inline-flex items-center gap-2 text-[12px] text-faint">
          <span className="size-1.5 animate-breathe rounded-full bg-signal" />
          {t("lexLoading")}
        </span>
      </div>
    );
  }
  if (!value) return null;

  const entries = expanded ? value.entries : value.entries.slice(0, 3);
  const canExpand = value.entries.length > 3;
  const rtl = isRtl(value.targetLanguage);

  return (
    <section className="animate-rise px-5 pb-5 pt-2" aria-labelledby={`${contentId}-title`}>
      {value.translation ? (
        <div className="mb-3 rounded-2xl bg-card px-4 py-3">
          <p className="text-[11px] text-faint">{t("lexModel")}</p>
          <p
            lang={value.targetLanguage}
            dir={rtl ? "rtl" : "ltr"}
            className={`mt-0.5 text-start text-[20px] font-medium text-foreground ${rtl ? "font-arabic" : ""}`}
          >
            {value.translation}
          </p>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <h2 id={`${contentId}-title`} className="text-[13px] font-medium text-muted-foreground">
          {t("lexMore")}
        </h2>
        {canExpand ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-controls={contentId}
            className="press-soft inline-flex min-h-9 items-center gap-1.5 text-[12px] text-signal-text"
          >
            {expanded ? t("lexLess") : t("lexAll")}
            <ChevronDown
              className={`size-3.5 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`}
              strokeWidth={1.75}
            />
          </button>
        ) : null}
      </div>

      <ol id={contentId} className="mt-1 divide-y divide-border">
        {entries.map((entry, index) => (
          <li key={`${entry.term}-${entry.partOfSpeech}-${index}`} className="py-4 first:pt-3">
            <div className="flex items-start gap-3" dir={rtl ? "rtl" : "ltr"}>
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rotate-45 bg-signal" />
              <div className="min-w-0 flex-1 text-start">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    lang={value.targetLanguage}
                    className={`text-[18px] font-medium text-foreground ${rtl ? "font-arabic" : ""}`}
                  >
                    {entry.term}
                  </span>
                  <span className="text-[11px] text-faint">{t(LABEL[entry.partOfSpeech])}</span>
                  {entry.primary ? (
                    <span className="text-[10px] text-signal-text">{t("lexBest")}</span>
                  ) : null}
                </div>
                <p
                  lang={value.targetLanguage}
                  className={`mt-1 text-[14px] leading-relaxed text-muted-foreground ${rtl ? "font-arabic" : ""}`}
                >
                  {entry.meanings.join("، ")}
                </p>
                {entry.definition ? (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
                    {entry.definition}
                    {entry.register ? ` · ${entry.register}` : ""}
                  </p>
                ) : null}
                {entry.forms?.length ? (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                    <span className="text-faint">{t("lexForms")}: </span>
                    <span dir="auto">{entry.forms.join(" · ")}</span>
                  </p>
                ) : null}
                {entry.synonyms?.length ? (
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    <span className="text-faint">{t("lexSynonyms")}: </span>
                    <span lang={value.targetLanguage} className={rtl ? "font-arabic" : ""}>
                      {entry.synonyms.join("، ")}
                    </span>
                  </p>
                ) : null}
                {expanded && entry.example ? (
                  <div className="mt-2 border-s border-border-strong ps-3 text-[12px] leading-relaxed">
                    <p dir="auto" className="text-muted-foreground">
                      {entry.example}
                    </p>
                    {entry.exampleTranslation ? (
                      <p dir="auto" className="mt-0.5 text-faint">
                        {entry.exampleTranslation}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
});
