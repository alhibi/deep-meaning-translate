import { memo, type ReactNode } from "react";
import type { CultureLocale } from "@/lib/culture/types";
import type { CultureListEntry } from "./contract";
import type { CultureCopy } from "./copy";
import { categoryLabel, entryPlace, localized } from "./format";
import { compositionFor } from "./compositions";
import { MediaBlock, MetaLine, OriginalTitle, SaveButton, TypographicPanel } from "./CultureBits";

/**
 * The feed card. The editorial shape follows the record's category (see compositions.ts):
 * an object leads with its image, a practice with its words, a place with its landscape, a
 * word with its own script. All shapes share the surface, the meta line and the quiet footer.
 *
 * The compact index carries no body text, so a card never invents a summary: it shows the
 * title, its category and place, the record's own tags, and — when the source supplies one —
 * its image with credit, licence and a fixed aspect ratio.
 */

export interface CultureCardProps {
  entry: CultureListEntry;
  locale: CultureLocale;
  copy: CultureCopy;
  saved: boolean;
  onOpen: (entry: CultureListEntry) => void;
  onToggleSaved: (id: string) => void;
}

function CardShell({
  entry,
  copy,
  saved,
  onOpen,
  onToggleSaved,
  children,
  variant,
}: CultureCardProps & { children: ReactNode; variant: "card" | "quiet" }) {
  return (
    <article
      className={
        "relative flex h-full min-h-0 flex-col overflow-hidden " +
        (variant === "card"
          ? "rounded-2xl bg-card"
          : "rounded-xl border border-border bg-transparent")
      }
    >
      <button
        type="button"
        onClick={() => onOpen(entry)}
        aria-haspopup="dialog"
        className="press-soft flex min-h-0 flex-1 flex-col rounded-2xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {children}
      </button>
      <footer className="flex items-center justify-between gap-2 px-3 pb-1 pt-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {entry.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-[10.5px] leading-relaxed text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </span>
        <SaveButton saved={saved} copy={copy} onToggle={() => onToggleSaved(entry.id)} />
      </footer>
    </article>
  );
}

export const CultureCard = memo(function CultureCard(props: CultureCardProps) {
  const { entry, locale, copy } = props;
  const composition = compositionFor(entry.category);
  const category = categoryLabel(entry.category, copy);
  const place = entryPlace(entry, locale, copy);
  const title = localized(entry.title, locale);
  const original = entry.titleOriginal;
  const originalLanguage = entry.titleOriginalLanguage;

  if (composition === "practice") {
    return (
      <CardShell {...props} variant="card">
        <div className="flex flex-1 flex-col gap-3 px-5 pb-2 pt-5">
          <span aria-hidden className="block h-px w-12 bg-border-strong" />
          <MetaLine locale={locale} label={category} place={place} />
          <OriginalTitle
            original={original}
            language={originalLanguage}
            title={title}
            locale={locale}
            size="text-[22px]"
          />
        </div>
      </CardShell>
    );
  }

  if (composition === "word") {
    return (
      <CardShell {...props} variant="card">
        <div className="flex flex-1 flex-col gap-2 px-5 pb-2 pt-5">
          <MetaLine locale={locale} label={category} place={place} />
          <OriginalTitle
            original={original}
            language={originalLanguage}
            title={title}
            locale={locale}
            size="text-[20px]"
          />
        </div>
      </CardShell>
    );
  }

  if (composition === "material") {
    return (
      <CardShell {...props} variant="card">
        <div className="flex flex-1 flex-col gap-3 px-4 pb-2 pt-4">
          <MetaLine locale={locale} label={category} place={place} />
          <div className="flex min-w-0 items-start gap-3">
            {entry.media?.url ? (
              <MediaBlock
                media={entry.media}
                alt={title}
                aspect="aspect-square"
                copy={copy}
                compact
                fallback={<span aria-hidden className="size-24 shrink-0 rounded-xl bg-muted" />}
              />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <OriginalTitle
                original={original}
                language={originalLanguage}
                title={title}
                locale={locale}
                size="text-[17px]"
              />
            </div>
          </div>
        </div>
      </CardShell>
    );
  }

  if (composition === "food") {
    return (
      <CardShell {...props} variant="card">
        <MediaBlock
          media={entry.media}
          alt={title}
          aspect="aspect-[3/2]"
          copy={copy}
          fallback={<TypographicPanel locale={locale} label={category} aspect="aspect-[3/2]" />}
        />
        <div className="flex flex-1 flex-col gap-2 px-4 pb-2 pt-3">
          <MetaLine locale={locale} label={category} place={place} />
          <OriginalTitle
            original={original}
            language={originalLanguage}
            title={title}
            locale={locale}
            size="text-[18px]"
          />
        </div>
      </CardShell>
    );
  }

  if (composition === "place") {
    return (
      <CardShell {...props} variant="card">
        <MediaBlock
          media={entry.media}
          alt={title}
          aspect="aspect-[16/9]"
          copy={copy}
          fallback={<TypographicPanel locale={locale} label={category} aspect="aspect-[16/9]" />}
        />
        <div className="flex flex-1 flex-col gap-2 px-4 pb-2 pt-3">
          <MetaLine locale={locale} label={category} place={place} />
          <OriginalTitle
            original={original}
            language={originalLanguage}
            title={title}
            locale={locale}
            size="text-[20px]"
          />
        </div>
      </CardShell>
    );
  }

  if (composition === "quiet") {
    return (
      <CardShell {...props} variant="quiet">
        <div className="flex flex-1 flex-col gap-2 px-4 py-4">
          <MetaLine locale={locale} label={category} place={place} />
          <OriginalTitle
            original={original}
            language={originalLanguage}
            title={title}
            locale={locale}
            size="text-[16px]"
          />
        </div>
      </CardShell>
    );
  }

  // "artifact": an object leads with its own image, or with its category panel.
  return (
    <CardShell {...props} variant="card">
      <MediaBlock
        media={entry.media}
        alt={title}
        aspect="aspect-[4/3]"
        copy={copy}
        fallback={<TypographicPanel locale={locale} label={category} />}
      />
      <div className="flex flex-1 flex-col gap-2 px-4 pb-2 pt-3">
        <MetaLine locale={locale} label={category} place={place} />
        <OriginalTitle
          original={original}
          language={originalLanguage}
          title={title}
          locale={locale}
          size="text-[18px]"
        />
      </div>
    </CardShell>
  );
});
