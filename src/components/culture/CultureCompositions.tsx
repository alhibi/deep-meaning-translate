import type { CultureIndexEntry, CultureLocale } from "@/lib/culture/types";
import { COPY, fill } from "./copy";
import {
  categoryLabel,
  contentTypeLabel,
  countryName,
  directionOf,
  localized,
  placeLine,
  readingTimeLabel,
  textDirection,
} from "./format";

/**
 * Six written compositions, one family.
 *
 * A piece is laid out according to what it is, not fitted into a card: a feature opens the
 * page with a large headline and a deck; a note is a compact paragraph; a language piece
 * gives its title the width of a phrase; a scene reads as a vignette with an indented first
 * line; a contrast puts two contexts beside each other and warns against flattening them; a
 * detail is a small, restrained observation carried by one accent rule.
 *
 * There are no pictures, no cards with borders and shadows, and no generic tiles: the
 * hierarchy is made of type, space, hairlines and the single signal colour.
 */

export interface CultureCardProps {
  entry: CultureIndexEntry;
  locale: CultureLocale;
  saved: boolean;
  onOpen(entry: CultureIndexEntry): void;
  onToggleSaved(id: string): void;
}

const TITLE = "font-display text-balance tracking-[-0.02em] text-foreground";

function titleOf(entry: CultureIndexEntry, locale: CultureLocale): string {
  return localized(entry.title, locale);
}

function SaveControl({
  entry,
  locale,
  saved,
  onToggleSaved,
  quiet,
}: {
  entry: CultureIndexEntry;
  locale: CultureLocale;
  saved: boolean;
  onToggleSaved(id: string): void;
  quiet?: boolean;
}) {
  const copy = COPY[locale];
  const title = titleOf(entry, locale);
  return (
    <button
      type="button"
      data-culture-save
      data-saved={saved ? "true" : "false"}
      aria-pressed={saved}
      aria-label={fill(saved ? copy.savedAria : copy.saveAria, { title })}
      onClick={() => onToggleSaved(entry.id)}
      className={
        "press-soft inline-flex min-h-8 shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] " +
        (saved
          ? "text-signal-text"
          : quiet
            ? "text-faint hover:text-foreground"
            : "text-muted-foreground hover:text-foreground")
      }
    >
      <span aria-hidden="true" className="text-[13px] leading-none">
        {saved ? "◼" : "◻"}
      </span>
      {saved ? copy.saved : copy.save}
    </button>
  );
}

function ReadControl({
  entry,
  locale,
  onOpen,
  align,
}: {
  entry: CultureIndexEntry;
  locale: CultureLocale;
  onOpen(entry: CultureIndexEntry): void;
  align?: "start" | "end";
}) {
  const copy = COPY[locale];
  return (
    <button
      type="button"
      data-culture-read
      onClick={() => onOpen(entry)}
      aria-label={fill(copy.readAria, { title: titleOf(entry, locale) })}
      className={
        "press-soft group/read inline-flex min-h-8 items-center gap-1.5 text-[12px] font-medium text-foreground " +
        (align === "end" ? "ms-auto" : "")
      }
    >
      {copy.read}
      <span
        aria-hidden="true"
        className="inline-block rtl:-scale-x-100 transition-transform duration-200 group-hover/read:translate-x-0.5"
      >
        →
      </span>
    </button>
  );
}

function TitleButton({
  entry,
  locale,
  onOpen,
  className,
  dir,
}: {
  entry: CultureIndexEntry;
  locale: CultureLocale;
  onOpen(entry: CultureIndexEntry): void;
  className: string;
  dir?: "rtl" | "ltr";
}) {
  return (
    <h3 className={TITLE + " " + className}>
      <button
        type="button"
        data-culture-open
        dir={dir}
        onClick={() => onOpen(entry)}
        className="press-soft text-start decoration-1 underline-offset-[6px] hover:underline hover:decoration-border-strong"
      >
        {titleOf(entry, locale)}
      </button>
    </h3>
  );
}

function EntryMeta({
  entry,
  locale,
  saved,
  onToggleSaved,
  showType,
}: {
  entry: CultureIndexEntry;
  locale: CultureLocale;
  saved: boolean;
  onToggleSaved(id: string): void;
  showType?: boolean;
}) {
  const copy = COPY[locale];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-faint">
      {showType ? (
        <span className="uppercase tracking-[0.1em] text-muted-foreground">
          {contentTypeLabel(entry.contentType, copy)}
        </span>
      ) : null}
      <span>{placeLine(entry, locale, copy)}</span>
      <span aria-hidden="true" className="text-border-strong">
        ·
      </span>
      <span>{readingTimeLabel(entry.readingMinutes, copy)}</span>
      <span className="ms-auto">
        <SaveControl
          entry={entry}
          locale={locale}
          saved={saved}
          onToggleSaved={onToggleSaved}
          quiet
        />
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- A. feature */

export function FeatureComposition(props: CultureCardProps) {
  const { entry, locale, saved, onOpen, onToggleSaved } = props;
  const copy = COPY[locale];
  const dir = directionOf(locale);
  return (
    <article
      dir={dir}
      data-culture-card
      data-composition="feature"
      data-entry-id={entry.id}
      className="border-t-2 border-foreground/80 pt-4"
    >
      <div className="flex items-baseline justify-between gap-4 text-[11px] uppercase tracking-[0.14em]">
        <span className="text-signal-text">{copy.types.feature}</span>
        <span className="text-faint">{categoryLabel(entry.category, copy)}</span>
      </div>
      <TitleButton
        entry={entry}
        locale={locale}
        onOpen={onOpen}
        className="mt-5 text-[clamp(1.85rem,5.4vw,2.9rem)] font-medium leading-[1.04] tracking-[-0.02em]"
      />
      <p className="mt-4 max-w-[58ch] text-[17px] leading-[1.55] text-muted-foreground">
        {localized(entry.teaser, locale)}
      </p>
      <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] text-faint">
        <span className="text-muted-foreground">{placeLine(entry, locale, copy)}</span>
        <span aria-hidden="true">·</span>
        <span>{readingTimeLabel(entry.readingMinutes, copy)}</span>
        <span className="ms-auto">
          <SaveControl
            entry={entry}
            locale={locale}
            saved={saved}
            onToggleSaved={onToggleSaved}
            quiet
          />
        </span>
      </div>
      <div className="mt-3 flex items-center">
        <ReadControl entry={entry} locale={locale} onOpen={onOpen} />
        <span aria-hidden="true" className="ms-3 h-px flex-1 bg-border" />
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------- B. note */

export function NoteComposition(props: CultureCardProps) {
  const { entry, locale, saved, onOpen, onToggleSaved } = props;
  const copy = COPY[locale];
  const dir = directionOf(locale);
  return (
    <article
      dir={dir}
      data-culture-card
      data-composition="note"
      data-entry-id={entry.id}
      className="grid grid-cols-[3.25rem_1fr] gap-x-4 border-t border-border pt-4 sm:grid-cols-[5rem_1fr]"
    >
      <p className="text-[10.5px] uppercase leading-[1.5] tracking-[0.12em] text-faint">
        {copy.types.note}
        <span className="mt-1 block text-[10px] normal-case tracking-normal text-muted-foreground">
          {categoryLabel(entry.category, copy)}
        </span>
      </p>
      <div className="min-w-0">
        <TitleButton
          entry={entry}
          locale={locale}
          onOpen={onOpen}
          className="text-[21px] font-medium leading-[1.25]"
        />
        <p className="mt-2 line-clamp-3 max-w-[58ch] text-[14.5px] leading-[1.65] text-muted-foreground">
          {localized(entry.teaser, locale)}
        </p>
        <EntryMeta entry={entry} locale={locale} saved={saved} onToggleSaved={onToggleSaved} />
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- C. language */

export function LanguageComposition(props: CultureCardProps) {
  const { entry, locale, saved, onOpen, onToggleSaved } = props;
  const copy = COPY[locale];
  const dir = directionOf(locale);
  const title = titleOf(entry, locale);
  // The title is interface copy, but a curated entry can carry the phrase itself; the
  // script direction is read from the text rather than assumed from the locale.
  const phraseDir = textDirection(title);
  return (
    <article
      dir={dir}
      data-culture-card
      data-composition="language"
      data-entry-id={entry.id}
      className="border-t border-border pt-3.5"
    >
      <div className="flex items-baseline justify-between gap-3 text-[10.5px] uppercase tracking-[0.14em]">
        <span className="text-signal-text">{copy.types.language}</span>
        <span className="text-faint">{placeLine(entry, locale, copy)}</span>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <span aria-hidden="true" className="mt-1 block h-10 w-px shrink-0 bg-signal-text/60" />
        <div className="min-w-0">
          <TitleButton
            entry={entry}
            locale={locale}
            onOpen={onOpen}
            dir={phraseDir}
            className="text-[clamp(1.55rem,4.2vw,2.2rem)] font-medium leading-[1.2]"
          />
          <p
            dir={phraseDir}
            className="mt-2 max-w-[52ch] text-[15px] leading-[1.6] text-muted-foreground"
          >
            {localized(entry.teaser, locale)}
          </p>
          {entry.hasExpression ? (
            <p className="mt-2.5 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.1em] text-signal-text">
              <span aria-hidden="true">“</span>
              {copy.expressionLabel}
            </p>
          ) : null}
        </div>
      </div>
      <EntryMeta
        entry={entry}
        locale={locale}
        saved={saved}
        onToggleSaved={onToggleSaved}
        showType
      />
    </article>
  );
}

/* ------------------------------------------------------------------ D. scene */

export function SceneComposition(props: CultureCardProps) {
  const { entry, locale, saved, onOpen, onToggleSaved } = props;
  const copy = COPY[locale];
  const dir = directionOf(locale);
  return (
    <article
      dir={dir}
      data-culture-card
      data-composition="scene"
      data-entry-id={entry.id}
      className="border-t border-border pt-4"
    >
      <div className="flex items-baseline gap-3 text-[10.5px] uppercase tracking-[0.14em]">
        <span className="text-muted-foreground">{copy.types.scene}</span>
        <span className="text-faint">{categoryLabel(entry.category, copy)}</span>
        <span className="ms-auto text-faint">{placeLine(entry, locale, copy)}</span>
      </div>
      <TitleButton
        entry={entry}
        locale={locale}
        onOpen={onOpen}
        className="mt-3 text-[24px] font-medium leading-[1.25]"
      />
      <p className="mt-3 max-w-[56ch] text-[16px] leading-[1.8] text-muted-foreground [text-indent:1.5em]">
        {localized(entry.teaser, locale)}
      </p>
      <EntryMeta entry={entry} locale={locale} saved={saved} onToggleSaved={onToggleSaved} />
    </article>
  );
}

/* ---------------------------------------------------------------- E. contrast */

export function ContrastComposition(props: CultureCardProps) {
  const { entry, locale, saved, onOpen, onToggleSaved } = props;
  const copy = COPY[locale];
  const dir = directionOf(locale);
  // Two real contexts from the record, never an invented pairing: two countries when the
  // piece names two, otherwise the one country against its continent, otherwise the
  // continent against the subject. The caution line is copy, not data.
  const first = entry.countries[0] ? countryName(entry.countries[0], locale) : "";
  const second = entry.countries[1] ? countryName(entry.countries[1], locale) : "";
  const leftLabel = first ? copy.countryList : copy.filterContinent;
  const leftText = first || copy.continents[entry.continent];
  const rightLabel = second ? copy.countryList : first ? copy.filterContinent : copy.filterCategory;
  const rightText =
    second || (first ? copy.continents[entry.continent] : categoryLabel(entry.category, copy));
  return (
    <article
      dir={dir}
      data-culture-card
      data-composition="contrast"
      data-entry-id={entry.id}
      className="border-t border-border pt-3.5"
    >
      <div className="flex items-baseline justify-between gap-3 text-[10.5px] uppercase tracking-[0.14em]">
        <span className="text-signal-text">{copy.types.contrast}</span>
        <span className="text-faint">{categoryLabel(entry.category, copy)}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 divide-x divide-border rtl:divide-x-reverse">
        <div className="pe-3">
          <p className="text-[10px] uppercase tracking-[0.1em] text-faint">{leftLabel}</p>
          <p className="mt-1.5 text-[19px] font-medium leading-[1.3] text-foreground">{leftText}</p>
        </div>
        <div className="ps-3">
          <p className="text-[10px] uppercase tracking-[0.1em] text-faint">{rightLabel}</p>
          <p className="mt-1.5 text-[19px] font-medium leading-[1.3] text-foreground">
            {rightText}
          </p>
        </div>
      </div>
      <p className="mt-3 border-s-2 border-signal-text/70 ps-3 text-[12px] italic leading-[1.55] text-faint">
        {copy.cautionContrast}
      </p>
      <TitleButton
        entry={entry}
        locale={locale}
        onOpen={onOpen}
        className="mt-4 text-[20px] font-medium leading-[1.3]"
      />
      <p className="mt-2 line-clamp-2 text-[14px] leading-[1.65] text-muted-foreground">
        {localized(entry.teaser, locale)}
      </p>
      <EntryMeta entry={entry} locale={locale} saved={saved} onToggleSaved={onToggleSaved} />
    </article>
  );
}

/* ----------------------------------------------------------------- F. detail */

export function DetailComposition(props: CultureCardProps) {
  const { entry, locale, saved, onOpen, onToggleSaved } = props;
  const copy = COPY[locale];
  const dir = directionOf(locale);
  return (
    <article
      dir={dir}
      data-culture-card
      data-composition="detail"
      data-entry-id={entry.id}
      className="grid grid-cols-[2px_1fr] gap-x-3.5 border-t border-border pt-3"
    >
      <span aria-hidden="true" className="block bg-signal-text/70" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.14em] text-signal-text">
          {copy.types.detail}
          <span className="ms-2 text-faint">{categoryLabel(entry.category, copy)}</span>
        </p>
        <TitleButton
          entry={entry}
          locale={locale}
          onOpen={onOpen}
          className="mt-1.5 text-[17px] font-medium leading-[1.35]"
        />
        <p className="mt-1.5 line-clamp-2 max-w-[58ch] text-[13.5px] leading-[1.6] text-muted-foreground">
          {localized(entry.teaser, locale)}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 text-[10.5px] text-faint">
          <span>{readingTimeLabel(entry.readingMinutes, copy)}</span>
          <span className="ms-auto">
            <SaveControl
              entry={entry}
              locale={locale}
              saved={saved}
              onToggleSaved={onToggleSaved}
              quiet
            />
          </span>
        </div>
      </div>
    </article>
  );
}

/** The dispatcher: contentType chooses the composition, never a generic card. */
export function CultureCard(props: CultureCardProps) {
  switch (props.entry.contentType) {
    case "feature":
      return <FeatureComposition {...props} />;
    case "language":
      return <LanguageComposition {...props} />;
    case "scene":
      return <SceneComposition {...props} />;
    case "contrast":
      return <ContrastComposition {...props} />;
    case "detail":
      return <DetailComposition {...props} />;
    case "note":
    default:
      return <NoteComposition {...props} />;
  }
}
