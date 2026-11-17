import { useState, type ReactNode } from "react";
import { Bookmark } from "lucide-react";
import type { CultureLocale, CultureMedia } from "@/lib/culture/types";
import { isAllowedCultureImageUrl } from "@/lib/culture/media";
import type { CultureCopy } from "./copy";
import { licenseName, textDirection } from "./format";

/**
 * Shared pieces of the discovery surface: one meta line, one typographic fallback panel,
 * one image block with its credit and rights, one save control. They exist so the six card
 * compositions (and the featured card, and the reading surface) cannot drift apart in
 * wording, contrast or touch size.
 */

export function metaClass(locale: CultureLocale): string {
  return locale === "ar"
    ? "flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-snug text-faint"
    : "flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase leading-snug tracking-[0.14em] text-faint";
}

export function MetaLine({
  locale,
  label,
  place,
}: {
  locale: CultureLocale;
  label: string;
  place: string;
}) {
  return (
    <p className={metaClass(locale)}>
      <span>{label}</span>
      {place ? (
        <>
          <span aria-hidden>·</span>
          <span className={locale === "ar" ? "" : "normal-case tracking-normal"}>{place}</span>
        </>
      ) : null}
    </p>
  );
}

/** The typographic stand-in for an image: category, a rule, and nothing invented. */
export function TypographicPanel({
  locale,
  label,
  aspect = "aspect-[4/3]",
}: {
  locale: CultureLocale;
  label: string;
  aspect?: string | undefined;
}) {
  return (
    <div className={"flex w-full flex-col justify-end gap-2 bg-muted p-4 " + aspect}>
      <span className={metaClass(locale)}>{label}</span>
      <span aria-hidden className="block h-px w-10 bg-border-strong" />
    </div>
  );
}

/**
 * An image at a fixed aspect ratio, lazily decoded, with its credit and rights always
 * visible. A failed or absent image becomes the caller's typographic fallback: no empty
 * frame, no broken icon, no substituted photograph.
 */
export function MediaBlock({
  media,
  alt,
  aspect,
  copy,
  fallback,
  compact = false,
}: {
  media?: CultureMedia | undefined;
  alt: string;
  aspect: string;
  copy: CultureCopy;
  fallback: ReactNode;
  compact?: boolean | undefined;
}) {
  const [failed, setFailed] = useState(false);
  // Defence in depth: the loader already rejects images outside the runtime allowlist, but
  // the component refuses too, so no other data path can make the page fetch a foreign host.
  const allowed =
    Boolean(media?.url) &&
    isAllowedCultureImageUrl(media?.url) &&
    (!media?.thumbnailUrl || isAllowedCultureImageUrl(media.thumbnailUrl));
  if (!media?.url || !allowed || failed) return <>{fallback}</>;
  const width = media.width ?? 1200;
  const height = media.height ?? 800;
  return (
    <figure className={"m-0 " + (compact ? "w-24 shrink-0" : "")}>
      <div className={"relative w-full overflow-hidden bg-muted " + aspect}>
        <img
          src={media.thumbnailUrl ?? media.url}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={width}
          height={height}
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      </div>
      <figcaption
        className={
          compact
            ? "mt-1 text-[9.5px] leading-tight text-faint"
            : "flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-2 text-[10.5px] leading-snug text-faint"
        }
      >
        <span>
          {copy.imageCreditLabel}: {media.credit}
        </span>
        <span aria-hidden>·</span>
        <span>
          {copy.rightsLabel}: {licenseName(media.license)}
        </span>
      </figcaption>
    </figure>
  );
}

/** The bookmark control: 44 px of touch target, pressed state, no colour-only signal. */
export function SaveButton({
  saved,
  copy,
  onToggle,
  className = "",
}: {
  saved: boolean;
  copy: CultureCopy;
  onToggle: () => void;
  className?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={saved}
      aria-label={saved ? copy.unsaveLabel : copy.saveLabel}
      className={
        "press-soft grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        className
      }
    >
      <Bookmark
        aria-hidden
        className="size-[18px]"
        strokeWidth={1.75}
        fill={saved ? "currentColor" : "none"}
      />
    </button>
  );
}

/**
 * A title that knows what it is: original script first where the corpus has one, the
 * interface translation beneath. Direction comes from the language tag when supplied, and
 * from the script otherwise, so an Arabic word inside a German page still reads correctly.
 */
export function OriginalTitle({
  original,
  language,
  title,
  locale,
  size = "text-[26px]",
}: {
  original?: string | undefined;
  language?: string | undefined;
  title: string;
  locale: CultureLocale;
  size?: string | undefined;
}) {
  const hasOriginal = Boolean(original && original.trim() && original.trim() !== title.trim());
  const dir = textDirection(original, language);
  const arabic = locale === "ar" || dir === "rtl";
  if (!hasOriginal) {
    return (
      <h3
        className={
          (arabic ? "font-medium " : "font-medium tracking-[-0.01em] ") + size + " leading-snug"
        }
      >
        {title}
      </h3>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <p
        lang={
          language && /^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]+)?$/.test(language) ? language : undefined
        }
        dir={dir}
        className={
          "text-[22px] leading-snug text-foreground sm:text-[26px] " +
          (dir === "rtl" ? "font-arabic" : "")
        }
      >
        {original}
      </p>
      <h3 className={"text-[13.5px] font-medium leading-snug text-muted-foreground"}>{title}</h3>
    </div>
  );
}
