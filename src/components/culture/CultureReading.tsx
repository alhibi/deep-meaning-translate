import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { CultureDiscoveryAdapter } from "@/lib/culture/adapter";
import type {
  CultureArticle,
  CultureIndexEntry,
  CultureLocale,
  CultureSource,
} from "@/lib/culture/types";
import { useAndroidBack } from "@/lib/useAndroidBack";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { COPY, fill } from "./copy";
import {
  categoryLabel,
  contextLine,
  contentTypeLabel,
  countryNames,
  directionOf,
  languageName,
  languageTag,
  localized,
  periodLabel,
  readingTimeLabel,
  textDirection,
} from "./format";

/**
 * The reading surface: one written piece, opened as a real dialog.
 *
 * The page behind it is locked and dimmed, focus is trapped and returned to the card that
 * opened it, Escape and Android back close it, and the section restores the exact scroll
 * position on close. The piece is the page: headline, deck, teaser, sections, and only then
 * a restrained references block. Nothing here is a card.
 */

export type ReadingStatus = "loading" | "ready" | "missing" | "error";

export interface CultureReadingProps {
  adapter: CultureDiscoveryAdapter;
  id: string;
  locale: CultureLocale;
  saved: boolean;
  onClose(): void;
  onOpenRelated(id: string): void;
  onToggleSaved(id: string): void;
}

function sourceHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function ArticleSource({ source, locale }: { source: CultureSource; locale: CultureLocale }) {
  const copy = COPY[locale];
  const title = localized(source.title, locale);
  const href = sourceHref(source.url);
  return (
    <li data-culture-source className="border-t border-border py-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-faint">{source.organization}</p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="press-soft mt-1 inline-flex min-h-7 items-baseline gap-1.5 text-[14px] leading-snug text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"
        >
          {title || source.url}
          <span aria-hidden="true" className="text-[11px] text-faint">
            ↗
          </span>
          <span className="sr-only">({copy.opensInNewTab})</span>
        </a>
      ) : (
        <p className="mt-1 text-[14px] leading-snug text-muted-foreground">{title}</p>
      )}
      {source.supports ? (
        <p className="mt-1 max-w-[58ch] text-[12px] leading-[1.55] text-faint">
          {localized(source.supports, locale)}
        </p>
      ) : null}
    </li>
  );
}

function ContextBlock({ article, locale }: { article: CultureArticle; locale: CultureLocale }) {
  const copy = COPY[locale];
  const countries = countryNames(article.context.countries, locale);
  const languages = article.context.languages
    .map((code) => languageName(code, locale))
    .filter(Boolean);
  const rows: { label: string; value: string }[] = [];
  if (countries.length) rows.push({ label: copy.countryList, value: countries.join(" · ") });
  if (languages.length) rows.push({ label: copy.languageList, value: languages.join(" · ") });
  rows.push({ label: copy.filterContinent, value: copy.continents[article.context.continent] });
  const period = periodLabel(article.context.period, copy);
  if (period) rows.push({ label: copy.contextLabel, value: period });
  if (article.context.region)
    rows.push({ label: copy.contextLabel, value: article.context.region });
  if (article.context.community)
    rows.push({ label: copy.contextLabel, value: article.context.community });
  return (
    <section data-culture-context aria-labelledby="culture-context-heading" className="mt-10">
      <h3
        id="culture-context-heading"
        className="text-[10.5px] uppercase tracking-[0.14em] text-faint"
      >
        {copy.contextLabel}
      </h3>
      <dl className="mt-2 border-t border-border">
        {rows.map((row, index) => (
          <div
            key={row.label + "-" + String(index)}
            className="flex items-baseline justify-between gap-4 border-b border-border py-2 text-[13px]"
          >
            <dt className="shrink-0 text-faint">{row.label}</dt>
            <dd className="text-end text-muted-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RelatedBlock({
  entries,
  locale,
  onOpenRelated,
}: {
  entries: readonly CultureIndexEntry[];
  locale: CultureLocale;
  onOpenRelated(id: string): void;
}) {
  const copy = COPY[locale];
  if (!entries.length) return null;
  return (
    <section data-culture-related className="mt-10">
      <h3 className="text-[10.5px] uppercase tracking-[0.14em] text-faint">{copy.relatedLabel}</h3>
      <ul className="mt-2 border-t border-border">
        {entries.map((entry) => (
          <li key={entry.id} className="border-b border-border">
            <button
              type="button"
              data-culture-related-link={entry.id}
              onClick={() => onOpenRelated(entry.id)}
              className="press-soft group/related flex w-full items-baseline gap-3 py-3 text-start"
            >
              <span className="w-16 shrink-0 text-[9.5px] uppercase tracking-[0.1em] text-faint">
                {contentTypeLabel(entry.contentType, copy)}
              </span>
              <span className="min-w-0 text-[15px] leading-snug text-foreground group-hover/related:underline group-hover/related:decoration-border-strong group-hover/related:underline-offset-4">
                {localized(entry.title, locale)}
              </span>
              <span aria-hidden="true" className="ms-auto shrink-0 text-[11px] text-faint">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArticleBody({
  article,
  locale,
  sources,
  related,
  titleId,
  titleRef,
  onOpenRelated,
}: {
  article: CultureArticle;
  locale: CultureLocale;
  sources: readonly CultureSource[];
  related: readonly CultureIndexEntry[];
  titleId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onOpenRelated(id: string): void;
}) {
  const copy = COPY[locale];
  const dir = directionOf(locale);
  const expression = article.expression;
  const example = article.example ? localized(article.example, locale) : "";
  const misunderstanding = article.misunderstanding
    ? localized(article.misunderstanding, locale)
    : "";
  const comparison = article.comparison ? localized(article.comparison, locale) : "";
  const deck = localized(article.deck, locale);
  const teaser = localized(article.teaser, locale);
  const expressionDir = expression
    ? textDirection(expression.original, languageTag(expression.language) ?? expression.language)
    : dir;
  const expressionTag = expression ? languageTag(expression.language) : undefined;
  const expressionLang = expressionTag ?? undefined;

  return (
    <article dir={dir} data-culture-reading-article data-content-type={article.contentType}>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[10.5px] uppercase tracking-[0.14em]">
        <span className="text-signal-text">{contentTypeLabel(article.contentType, copy)}</span>
        <span className="text-faint">{categoryLabel(article.category, copy)}</span>
        <span className="ms-auto text-faint">{readingTimeLabel(article.readingMinutes, copy)}</span>
      </p>
      <h2
        ref={titleRef}
        id={titleId}
        data-culture-reading-title
        tabIndex={-1}
        className="mt-4 text-balance font-display text-[clamp(1.9rem,5.6vw,3rem)] font-medium leading-[1.05] tracking-[-0.025em] text-foreground outline-none"
      >
        {localized(article.title, locale)}
      </h2>
      {deck ? (
        <p className="mt-4 max-w-[60ch] text-[18px] leading-[1.5] text-muted-foreground">{deck}</p>
      ) : null}
      {teaser && teaser !== deck ? (
        <p className="mt-3 max-w-[60ch] border-s-2 border-signal-text/60 ps-3 text-[14px] leading-[1.6] text-faint">
          {teaser}
        </p>
      ) : null}
      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
        {contextLine(article, locale)}
      </p>

      {(article.sections[locale] ?? []).map((section, index) => {
        const heading = section.heading;
        return (
          <section key={heading + "-" + String(index)} data-culture-section className="mt-8">
            {heading ? (
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground">
                {heading}
              </h3>
            ) : null}
            {section.paragraphs.map((paragraph, paragraphIndex) => (
              <p
                key={String(paragraphIndex)}
                className="mt-3 max-w-[62ch] text-[16px] leading-[1.75] text-foreground/90"
              >
                {paragraph}
              </p>
            ))}
          </section>
        );
      })}

      {expression ? (
        <section
          data-culture-expression
          data-expression-lang={expressionTag}
          className="mt-10 border-y-2 border-foreground/70 py-6"
        >
          <p className="text-[10.5px] uppercase tracking-[0.14em] text-signal-text">
            {copy.expressionLabel}
            <span className="ms-2 text-faint">{expression.language}</span>
          </p>
          <p
            dir={expressionDir}
            lang={expressionLang}
            className={
              "mt-3 text-[clamp(2rem,7vw,3.2rem)] leading-[1.25] text-foreground " +
              (expressionDir === "rtl" ? "font-arabic" : "")
            }
          >
            {expression.original}
          </p>
          {expression.transliteration ? (
            <p
              dir="ltr"
              className="mt-2 text-start text-[14px] italic tracking-[0.02em] text-muted-foreground"
            >
              {expression.transliteration}
            </p>
          ) : null}
          <dl className="mt-5 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.12em] text-faint">
                {copy.glossLabel}
              </dt>
              <dd className="mt-1 text-[14.5px] leading-[1.6] text-foreground">
                {localized(expression.gloss, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.12em] text-faint">
                {copy.usageLabel}
              </dt>
              <dd className="mt-1 text-[14.5px] leading-[1.6] text-muted-foreground">
                {localized(expression.usage, locale)}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {example ? (
        <section data-culture-example className="mt-8 border-t border-border pt-4">
          <h3 className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
            {copy.exampleLabel}
          </h3>
          <p className="mt-2 max-w-[60ch] text-[15.5px] leading-[1.7] text-foreground/90">
            {example}
          </p>
        </section>
      ) : null}

      {misunderstanding ? (
        <section data-culture-misunderstanding className="mt-8 border-s-2 border-signal-text ps-4">
          <h3 className="text-[10.5px] uppercase tracking-[0.14em] text-signal-text">
            {copy.misunderstandingLabel}
          </h3>
          <p className="mt-2 max-w-[60ch] text-[15.5px] leading-[1.7] text-foreground/90">
            {misunderstanding}
          </p>
        </section>
      ) : null}

      {comparison ? (
        <section data-culture-comparison className="mt-8 border-t border-border pt-4">
          <h3 className="text-[10.5px] uppercase tracking-[0.14em] text-signal-text">
            {copy.comparisonLabel}
          </h3>
          <p className="mt-2 max-w-[62ch] text-[15.5px] leading-[1.7] text-foreground/90">
            {comparison}
          </p>
          <p className="mt-3 max-w-[58ch] text-[12px] italic leading-[1.55] text-faint">
            {copy.cautionContrast}
          </p>
        </section>
      ) : null}

      <ContextBlock article={article} locale={locale} />

      {sources.length > 0 ? (
        <section data-culture-references className="mt-10">
          <h3 className="text-[10.5px] uppercase tracking-[0.14em] text-faint">
            {copy.sourcesLabel}
          </h3>
          <p className="mt-1 max-w-[58ch] text-[12px] leading-[1.55] text-faint">
            {copy.sourcesNote}
          </p>
          <ol className="mt-3">
            {sources.map((source, index) => (
              <ArticleSource
                key={source.url + "-" + String(index)}
                source={source}
                locale={locale}
              />
            ))}
          </ol>
        </section>
      ) : null}

      <RelatedBlock entries={related} locale={locale} onOpenRelated={onOpenRelated} />
    </article>
  );
}

export function CultureReading(props: CultureReadingProps) {
  const { adapter, id, locale, saved, onClose, onOpenRelated, onToggleSaved } = props;
  const copy = COPY[locale];
  const dir = directionOf(locale);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState<ReadingStatus>("loading");
  const [article, setArticle] = useState<CultureArticle | null>(null);
  const [related, setRelated] = useState<CultureIndexEntry[]>([]);

  useFocusTrap(true, dialogRef);
  useAndroidBack(true, onClose);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const generationId = ++generation.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new id is a new article
    setStatus("loading");

    setArticle(null);

    setRelated([]);
    adapter
      .loadItem(id)
      .then((item) => {
        if (generation.current !== generationId) return;
        if (!item) {
          setStatus("missing");
          return;
        }
        setArticle(item);
        setStatus("ready");
        const declared = item.related ?? [];
        if (declared.length === 0) return;
        adapter
          .loadRelated(declared)
          .then((entries) => {
            if (generation.current === generationId)
              setRelated(entries.filter((entry) => entry.id !== id));
          })
          .catch(() => {
            if (generation.current === generationId) setRelated([]);
          });
      })
      .catch(() => {
        if (generation.current === generationId) setStatus("error");
      });
    return () => {
      generation.current += 1;
    };
  }, [adapter, id, attempt]);

  useEffect(() => {
    if (status === "ready") titleRef.current?.focus({ preventScroll: true });
  }, [status, id]);

  const title = article ? localized(article.title, locale) : "";
  const titleId = useId();

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      dir={dir}
      role="dialog"
      aria-modal="true"
      aria-label={copy.feedLabel}
      aria-labelledby={article ? titleId : undefined}
      data-culture-reading
      data-reading-status={status}
      className="fixed inset-0 z-50 outline-none"
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        data-culture-reading-scrim
        className="animate-sheet-scrim motion-reduce:animate-none absolute inset-0 bg-background/75"
      />
      <div className="animate-sheet-in motion-reduce:animate-none relative mx-auto flex h-full w-full max-w-[780px] flex-col bg-background shadow-[0_0_0_1px_var(--border)]">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 sm:px-6">
          <button
            type="button"
            data-autofocus
            data-culture-reading-close
            onClick={onClose}
            aria-label={copy.close}
            className="press-soft grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden="true" className="text-[20px] leading-none">
              ×
            </span>
          </button>
          <p className="min-w-0 truncate text-[10.5px] uppercase tracking-[0.14em] text-faint">
            {copy.feedLabel}
            {article ? (
              <span className="ms-2 text-muted-foreground">
                {categoryLabel(article.category, copy)}
              </span>
            ) : null}
          </p>
          {article ? (
            <button
              type="button"
              data-culture-reading-save
              aria-pressed={saved}
              onClick={() => onToggleSaved(article.id)}
              aria-label={fill(saved ? copy.savedAria : copy.saveAria, { title })}
              className={
                "press-soft ms-auto inline-flex min-h-9 shrink-0 items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.12em] " +
                (saved ? "text-signal-text" : "text-muted-foreground hover:text-foreground")
              }
            >
              <span aria-hidden="true" className="text-[13px] leading-none">
                {saved ? "◼" : "◻"}
              </span>
              {saved ? copy.saved : copy.save}
            </button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 sm:px-8">
          {status === "loading" ? (
            <div role="status" aria-live="polite" data-culture-reading-state="loading">
              <p className="text-[11px] uppercase tracking-[0.14em] text-faint">{copy.loading}</p>
              <div aria-hidden="true" className="mt-6 space-y-3">
                <span className="block h-2.5 w-20 animate-pulse rounded-[2px] bg-border motion-reduce:animate-none" />
                <span className="block h-10 w-4/5 animate-pulse rounded-[2px] bg-border motion-reduce:animate-none" />
                <span className="block h-3 w-full animate-pulse rounded-[2px] bg-border motion-reduce:animate-none" />
                <span className="block h-3 w-3/4 animate-pulse rounded-[2px] bg-border motion-reduce:animate-none" />
              </div>
            </div>
          ) : null}

          {status === "missing" || status === "error" ? (
            <div role="alert" data-culture-reading-state={status} className="py-10">
              <h2 className="text-[24px] font-medium leading-tight text-foreground">
                {status === "missing" ? copy.articleMissingTitle : copy.articleErrorTitle}
              </h2>
              <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-muted-foreground">
                {status === "missing" ? copy.articleMissingBody : copy.articleErrorBody}
              </p>
              <div className="mt-5 flex items-center gap-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="press-soft inline-flex min-h-10 items-center border-b border-current pb-0.5 text-[12px] font-medium uppercase tracking-[0.12em] text-foreground"
                >
                  {copy.back}
                </button>
                {status === "error" ? (
                  <button
                    type="button"
                    data-culture-reading-retry
                    onClick={() => setAttempt((value) => value + 1)}
                    className="press-soft inline-flex min-h-10 items-center text-[12px] font-medium uppercase tracking-[0.12em] text-signal-text"
                  >
                    {copy.retry}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {status === "ready" && article ? (
            <ArticleBody
              article={article}
              locale={locale}
              sources={article.sources}
              related={related}
              titleId={titleId}
              titleRef={titleRef}
              onOpenRelated={onOpenRelated}
            />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
