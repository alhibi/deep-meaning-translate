import { memo, useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Key } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n";
import { isRtl } from "@/lib/translation/languages";
import type {
  LexicalEntry,
  LexicalKind,
  LexicalNuance,
  NuanceKind,
  LexiconResult,
} from "@/lib/translation/lexicon";

/**
 * Copy for states the shared interface table does not own. Feature copy lives with the
 * feature (precedent: DataControls, ProviderKey), so a calm dictionary failure needs no
 * i18n.ts edit and the interface table never grows a feature-specific key.
 */
export const LEXICON_COPY = {
  en: {
    // State-neutral on purpose: the hook cannot tell a provider outage from the enrichment
    // queue dropping a task at capacity, and both mean the same thing to the reader.
    failed: "The dictionary didn't answer this time. Your translation is unaffected.",
  },
  ar: {
    failed: "لم يُجب المعجم هذه المرة. ترجمتك لم تتأثر.",
  },
  de: {
    failed: "Das Wörterbuch hat diesmal nicht geantwortet. Deine Übersetzung ist davon unberührt.",
  },
} as const;

const KIND_LABEL: Record<LexicalKind, Key> = {
  noun: "lexNoun",
  adjective: "lexAdjective",
  verb: "lexVerb",
  adverb: "lexAdverb",
  phrase: "lexPhrase",
  proper_noun: "lexName",
  term: "lexTerm",
};

const NUANCE_LABEL: Record<NuanceKind, Key> = {
  shift: "lexNuance_shift",
  near_synonym: "lexNuance_near_synonym",
  double: "lexNuance_double",
  idiom: "lexNuance_idiom",
  false_friend: "lexNuance_false_friend",
};

/** Joins readings in the punctuation the target language actually uses. */
function joinReadings(readings: string[], targetRtl: boolean): string {
  return readings.join(targetRtl ? "، " : " · ");
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2.5">
      <h4 className="text-[11px] font-normal text-faint">{label}</h4>
      {children}
    </div>
  );
}

/**
 * The details block is mostly target-language material (synonyms, examples) with
 * UI-language labels and translations between it, so direction is set per element rather
 * than inherited from either side of the pair.
 */
function EntryDetails({
  entry,
  targetLanguage,
  targetRtl,
}: {
  entry: LexicalEntry;
  targetLanguage: string;
  targetRtl: boolean;
}) {
  const { t } = useI18n();
  const sample = entry.examples[0];
  return (
    <div className="mt-1 border-s border-border-strong ps-3">
      {entry.forms.length ? (
        <Fact label={t("lexForms")}>
          <ul className="mt-1 space-y-0.5">
            {entry.forms.map((form) => (
              <li
                key={form}
                dir="auto"
                className="text-[12.5px] leading-relaxed text-muted-foreground"
              >
                {form}
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
      {entry.collocations.length ? (
        <Fact label={t("lexCollocations")}>
          <ul className="mt-1 space-y-0.5">
            {entry.collocations.map((collocation) => (
              <li
                key={collocation}
                lang={targetLanguage}
                dir={targetRtl ? "rtl" : "ltr"}
                className={`text-[12.5px] leading-relaxed text-muted-foreground ${targetRtl ? "font-arabic" : ""}`}
              >
                {collocation}
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
      {entry.synonyms.length ? (
        <Fact label={t("lexSynonyms")}>
          <p
            lang={targetLanguage}
            dir={targetRtl ? "rtl" : "ltr"}
            className={`mt-1 text-[12.5px] leading-relaxed text-muted-foreground ${targetRtl ? "font-arabic" : ""}`}
          >
            {joinReadings(entry.synonyms, targetRtl)}
          </p>
        </Fact>
      ) : null}
      {entry.nuances.length ? (
        <Fact label={t("lexNuances")}>
          <ul className="mt-1 space-y-1.5">
            {entry.nuances.map((nuance: LexicalNuance) => (
              <li key={`${nuance.kind}-${nuance.text}`} dir="auto">
                <span className="text-[11px] text-signal-text">{t(NUANCE_LABEL[nuance.kind])}</span>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">{nuance.text}</p>
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
      {sample ? (
        <Fact label={t("lexExamples")}>
          <ul className="mt-1 space-y-1.5">
            {entry.examples.map((example) => (
              <li key={example.text}>
                <p
                  lang={targetLanguage}
                  dir={targetRtl ? "rtl" : "ltr"}
                  className={`text-[13px] leading-relaxed text-foreground ${targetRtl ? "font-arabic" : ""}`}
                >
                  {example.text}
                </p>
                {example.translation ? (
                  <p dir="auto" className="mt-0.5 text-[12px] leading-relaxed text-faint">
                    {example.translation}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
      {entry.pronunciation ? (
        <Fact label={t("lexPronunciation")}>
          <p
            dir="auto"
            lang={targetLanguage}
            className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground"
          >
            {entry.pronunciation}
          </p>
        </Fact>
      ) : null}
      {entry.register || entry.variety ? (
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-faint">
          {entry.register ? (
            <span>
              {t("lexRegister")}: <span dir="auto">{entry.register}</span>
            </span>
          ) : null}
          {entry.variety ? (
            <span>
              {t("lexVariety")}: <span dir="auto">{entry.variety}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One reading. The row itself follows the interface direction; only the target-language
 * spans carry the target direction, so a German headword in an Arabic interface is never
 * laid out right-to-left (or the reverse).
 */
function EntryRow({
  entry,
  targetLanguage,
  targetRtl,
  uiRtl,
}: {
  entry: LexicalEntry;
  targetLanguage: string;
  targetRtl: boolean;
  uiRtl: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const hasDetails =
    !!entry.forms.length ||
    !!entry.synonyms.length ||
    !!entry.collocations.length ||
    !!entry.nuances.length ||
    entry.examples.length > 0 ||
    !!entry.pronunciation ||
    !!entry.register ||
    !!entry.variety;
  const [leading, ...otherReadings] = entry.meanings;

  return (
    <li className="py-4 first:pt-3" data-testid="lexicon-entry" dir={uiRtl ? "rtl" : "ltr"}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-2 size-1.5 shrink-0 rotate-45 bg-signal" />
        <div className="min-w-0 flex-1 text-start">
          <h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              lang={targetLanguage}
              dir={targetRtl ? "rtl" : "ltr"}
              className={`text-[18px] font-medium text-foreground ${targetRtl ? "font-arabic" : ""}`}
            >
              {entry.term}
            </span>
            <span className="text-[11px] font-normal text-faint">
              {t(KIND_LABEL[entry.partOfSpeech])}
            </span>
            {entry.primary ? (
              <span className="text-[10px] font-normal text-signal-text">{t("lexBest")}</span>
            ) : null}
          </h3>
          <div className="mt-1 text-start">
            <p className="text-[14px] leading-relaxed text-foreground">
              {entry.primary ? (
                <span className="text-[11px] text-faint">{t("lexInThisSentence")} </span>
              ) : null}
              <span
                lang={targetLanguage}
                dir={targetRtl ? "rtl" : "ltr"}
                className={targetRtl ? "font-arabic" : undefined}
              >
                {leading}
              </span>
            </p>
            {otherReadings.length ? (
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                <span className="text-faint">{t("lexOtherMeanings")}: </span>
                <span
                  lang={targetLanguage}
                  dir={targetRtl ? "rtl" : "ltr"}
                  className={targetRtl ? "font-arabic" : undefined}
                >
                  {joinReadings(otherReadings, targetRtl)}
                </span>
              </p>
            ) : null}
            {entry.definition ? (
              <p dir="auto" className="mt-1.5 text-[12px] leading-relaxed text-faint">
                {entry.definition}
              </p>
            ) : null}
          </div>
          {hasDetails ? (
            <>
              <button
                type="button"
                onClick={() => setOpen((wasOpen) => !wasOpen)}
                aria-expanded={open}
                aria-controls={detailsId}
                aria-label={`${entry.term} — ${open ? t("lexHideDetails") : t("lexShowDetails")}`}
                className="press-soft mt-2 inline-flex min-h-9 items-center gap-1.5 text-[12px] text-signal-text"
              >
                {open ? t("lexHideDetails") : t("lexShowDetails")}
                <ChevronDown
                  aria-hidden
                  className={`size-3.5 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
                  strokeWidth={1.75}
                />
              </button>
              <div id={detailsId}>
                {open ? (
                  <EntryDetails
                    entry={entry}
                    targetLanguage={targetLanguage}
                    targetRtl={targetRtl}
                  />
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * The lexical reference inside the dictionary sheet.
 *
 * Readings are already ranked by the parser: the first entry is the reading that fits the
 * sentence the person wrote. Nothing here is presented as a verified dictionary fact — the
 * model-source line is part of the surface, and details stay collapsed so a short lookup
 * does not become a page.
 *
 * States are three, not one: loading (the lookup is running), empty (the term has no
 * lexical reading) and failed (the dictionary could not be reached). A failure is quiet and
 * explicitly says the translation is unaffected — a dictionary reading is optional
 * enrichment, never a second translator.
 */
export const LexiconPanel = memo(function LexiconPanel({
  value,
  loading,
  failed = false,
}: {
  value: LexiconResult | null;
  loading: boolean;
  /**
   * The last lookup failed (network/provider). Optional so an existing caller that does not
   * know the failure keeps working; the sheet forwards it once the hook exposes it.
   */
  failed?: boolean;
}) {
  const { t, locale, rtl: uiRtl } = useI18n();
  const copy = LEXICON_COPY[locale] ?? LEXICON_COPY.en;
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const listId = useId();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new reading is a new panel; the old disclosure state must not leak into it
    setExpanded(false);
  }, [value?.sourceTerm, value?.targetLanguage, value?.context]);

  if (loading && !value) {
    return (
      <div className="px-5 py-4" role="status" aria-live="polite">
        <span className="inline-flex items-center gap-2 text-[12px] text-faint">
          <span aria-hidden className="size-1.5 animate-breathe rounded-full bg-signal" />
          {t("lexLoading")}
        </span>
      </div>
    );
  }
  if (!value) {
    if (failed) {
      return (
        <p
          role="status"
          aria-live="polite"
          data-testid="lexicon-failure"
          className="px-5 py-4 text-[12.5px] leading-relaxed text-faint"
        >
          {copy.failed}
        </p>
      );
    }
    return <p className="px-5 py-4 text-[12.5px] leading-relaxed text-faint">{t("lexEmpty")}</p>;
  }

  const targetRtl = isRtl(value.targetLanguage);
  const sourceRtl = isRtl(value.sourceLanguage);
  const entries = expanded ? value.entries : value.entries.slice(0, 3);
  const canExpand = value.entries.length > 3;

  return (
    <section className="px-5 pb-5 pt-2" aria-labelledby={titleId} aria-busy={loading || undefined}>
      <p className="text-[11px] leading-relaxed text-faint">{t("lexModelSource")}</p>
      {value.translation ? (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className="text-[11px] text-faint">{t("lexModel")}</span>
          <span
            lang={value.targetLanguage}
            dir={targetRtl ? "rtl" : "ltr"}
            className={`text-[17px] font-medium text-foreground ${targetRtl ? "font-arabic" : ""}`}
          >
            {value.translation}
          </span>
        </p>
      ) : null}
      {value.context ? (
        <div className="mt-3">
          <p className="text-[11px] text-faint">{t("lexContext")}</p>
          <p
            lang={value.sourceLanguage}
            dir={sourceRtl ? "rtl" : "ltr"}
            className={`mt-0.5 text-[13px] leading-relaxed text-muted-foreground ${sourceRtl ? "font-arabic" : ""}`}
          >
            {value.context}
          </p>
        </div>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-4">
        <h2 id={titleId} className="text-[13px] font-medium text-muted-foreground">
          {t("lexMeanings")}
        </h2>
        {canExpand ? (
          <button
            type="button"
            onClick={() => setExpanded((wasOpen) => !wasOpen)}
            aria-expanded={expanded}
            aria-controls={listId}
            className="press-soft inline-flex min-h-9 items-center gap-1.5 text-[12px] text-signal-text"
          >
            {expanded ? t("lexLess") : t("lexAll")}
            <ChevronDown
              aria-hidden
              className={`size-3.5 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`}
              strokeWidth={1.75}
            />
          </button>
        ) : null}
      </div>
      <ol id={listId} className="mt-1 divide-y divide-border">
        {entries.map((entry, index) => (
          <EntryRow
            key={`${entry.term}-${entry.partOfSpeech}-${index}`}
            entry={entry}
            targetLanguage={value.targetLanguage}
            targetRtl={targetRtl}
            uiRtl={uiRtl}
          />
        ))}
      </ol>
    </section>
  );
});
