import { memo } from "react";
import type { CultureLocale } from "@/lib/culture/types";
import type { CultureListEntry } from "./contract";
import type { CultureCopy } from "./copy";
import { categoryLabel, entryPlace, localized } from "./format";
import {
  MediaBlock,
  MetaLine,
  OriginalTitle,
  SaveButton,
  TypographicPanel,
  metaClass,
} from "./CultureBits";

/** The one editorial feature at the top of the section: bigger, but the same language. */
export const CultureFeatured = memo(function CultureFeatured({
  entry,
  locale,
  copy,
  saved,
  onOpen,
  onToggleSaved,
}: {
  entry: CultureListEntry;
  locale: CultureLocale;
  copy: CultureCopy;
  saved: boolean;
  onOpen: (entry: CultureListEntry) => void;
  onToggleSaved: (id: string) => void;
}) {
  const category = categoryLabel(entry.category, copy);
  const place = entryPlace(entry, locale, copy);
  const title = localized(entry.title, locale);
  return (
    <article className="relative overflow-hidden rounded-[24px] bg-card">
      <button
        type="button"
        onClick={() => onOpen(entry)}
        aria-haspopup="dialog"
        className="press-soft flex w-full flex-col text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <MediaBlock
          media={entry.media}
          alt={title}
          aspect="aspect-[16/10]"
          copy={copy}
          fallback={<TypographicPanel locale={locale} label={category} aspect="aspect-[16/10]" />}
        />
        <div className="flex flex-col gap-2 px-5 pb-5 pt-4 sm:px-6">
          <p className={metaClass(locale)}>{copy.featuredLabel}</p>
          <MetaLine locale={locale} label={category} place={place} />
          <OriginalTitle
            original={entry.titleOriginal}
            language={entry.titleOriginalLanguage}
            title={title}
            locale={locale}
            size="text-[24px]"
          />
        </div>
      </button>
      <div className="absolute end-3 top-3 rounded-full bg-background/85 p-0.5 backdrop-blur-sm">
        <SaveButton saved={saved} copy={copy} onToggle={() => onToggleSaved(entry.id)} />
      </div>
    </article>
  );
});
