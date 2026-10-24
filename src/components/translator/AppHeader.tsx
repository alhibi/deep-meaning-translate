import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, Bookmark, ChartNoAxesCombined } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSheet } from "@/components/translator/LanguageSheet";
import { Wordmark } from "@/components/translator/Wordmark";
import { LOCALES, LOCALE_NAME, LOCALE_SHORT, useI18n, type Locale } from "@/lib/i18n";
import { statsT } from "@/lib/stats/labels";

/**
 * Everything the page needs from the top bar: the name, the interface language,
 * the install offer (only when the browser really offers one), the theme, the saved
 * shelf and the statistics. All controls are at least 44px tall where they are
 * touch targets, and every icon-only button carries a real label.
 */
export function AppHeader({
  tagline,
  onToggleTagline,
  locale,
  onLocaleSelect,
  localeOpen,
  onOpenLocale,
  onCloseLocale,
  canInstall,
  onInstall,
  onOpenSaved,
  savedLabel,
}: {
  tagline: boolean;
  onToggleTagline: () => void;
  locale: Locale;
  onLocaleSelect: (locale: Locale) => void;
  localeOpen: boolean;
  onOpenLocale: () => void;
  onCloseLocale: () => void;
  canInstall: boolean;
  onInstall: () => void;
  onOpenSaved: () => void;
  savedLabel: string;
}) {
  const { t } = useI18n();
  return (
    <header className="flex items-center justify-between px-5 pad-safe-top pb-1">
      <Wordmark tagline={tagline} onToggle={onToggleTagline} />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onOpenLocale}
          aria-haspopup="dialog"
          aria-label={t("uiLanguage")}
          className="press-soft grid h-9 min-w-9 place-items-center rounded-full px-2 text-[12px] font-medium tracking-wide text-muted-foreground"
        >
          <span aria-hidden className={locale === "ar" ? "font-arabic text-[14px]" : ""}>
            {LOCALE_SHORT[locale]}
          </span>
        </button>
        <LanguageSheet
          open={localeOpen}
          title={t("uiLanguage")}
          searchable={false}
          items={LOCALES.map((l) => ({
            code: l,
            native: LOCALE_NAME[l],
            name: LOCALE_NAME[l],
            rtl: l === "ar",
          }))}
          value={locale}
          onSelect={(c) => onLocaleSelect(c as Locale)}
          onClose={onCloseLocale}
        />
        {canInstall ? (
          <button
            type="button"
            onClick={onInstall}
            className="press-soft animate-fade inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] text-muted-foreground"
          >
            <ArrowDownToLine className="size-3.5" strokeWidth={1.75} />
            {t("install")}
          </button>
        ) : null}
        <ThemeToggle label={t("theme")} />
        <button
          type="button"
          onClick={onOpenSaved}
          aria-label={savedLabel}
          className="press grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <Bookmark className="size-[18px]" strokeWidth={1.75} />
        </button>
        <Link
          to="/stats"
          aria-label={statsT(locale)("open")}
          className="press grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <ChartNoAxesCombined className="size-[18px]" strokeWidth={1.75} />
        </Link>
      </div>
    </header>
  );
}
