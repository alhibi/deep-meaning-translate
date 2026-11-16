import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, Star, X } from "lucide-react";
import { useI18n, type Key } from "@/lib/i18n";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { feel } from "@/lib/feel";
import { normalizeLanguageQuery } from "@/lib/translation/languages";
import { readDeviceValue, writeDeviceValue } from "@/lib/persistence/settings";
import { useAndroidBack } from "@/lib/useAndroidBack";

export interface PickerItem {
  code: string;
  native: string;
  name: string;
  rtl?: boolean;
  aliases?: string[];
  popular?: boolean;
}

interface Props {
  open: boolean;
  title: string;
  items: PickerItem[];
  value: string;
  recent?: string[];
  /** Codes worth offering before the full list (the natural partners of the source). */
  suggested?: string[] | undefined;
  searchable?: boolean;
  /** Items aren't languages (e.g. dialects): show names as given, no locale lookups. */
  plain?: boolean;
  onSelect: (code: string) => void;
  onClose: () => void;
}

const codeOk = (v: unknown): v is string => typeof v === "string" && /^[a-z]{2}$/.test(v);

function LanguageRow({
  it,
  value,
  plain,
  localized,
  favorite,
  onPick,
  onToggleFavorite,
  t,
}: {
  it: PickerItem;
  value: string;
  plain: boolean;
  localized: (code: string) => string;
  favorite: boolean;
  onPick: (code: string) => void;
  onToggleFavorite: (code: string) => void;
  t: (key: Key) => string;
}) {
  const active = it.code === value;
  const sub = plain ? "" : localized(it.code);
  const secondary =
    sub && normalizeLanguageQuery(sub) !== normalizeLanguageQuery(it.native)
      ? sub
      : it.name !== it.native
        ? it.name
        : "";
  return (
    <li className="flex items-center gap-0.5">
      <button
        type="button"
        data-picker-row
        onClick={() => onPick(it.code)}
        aria-pressed={active}
        className="press-soft flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-3 text-start transition-colors hover:bg-card"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            dir="auto"
            className={`truncate ${active ? "text-foreground" : "text-foreground/90"} ${
              it.rtl
                ? "font-arabic text-[19px] leading-[1.35]"
                : "text-[17px] leading-[1.35] tracking-[-0.01em]"
            } ${active ? "font-semibold" : "font-medium"}`}
          >
            {it.code === "auto" && !plain ? t("detect") : it.native}
          </span>
          {secondary && it.code !== "auto" ? (
            <span dir="auto" className="truncate text-[12px] text-faint">
              {secondary}
            </span>
          ) : null}
        </span>
        <span
          className={`grid size-6 shrink-0 place-items-center ${active ? "text-signal" : "text-transparent"}`}
        >
          <Check className="size-[18px]" strokeWidth={2} />
        </span>
      </button>
      {!plain && it.code !== "auto" ? (
        <button
          type="button"
          onClick={() => onToggleFavorite(it.code)}
          aria-label={favorite ? t("langUnfavorite") : t("langFavorite")}
          aria-pressed={favorite}
          className={`press-soft grid size-10 shrink-0 place-items-center rounded-full ${
            favorite ? "text-signal-text" : "text-faint hover:text-foreground"
          }`}
        >
          <Star
            className="size-[17px]"
            strokeWidth={1.75}
            fill={favorite ? "currentColor" : "none"}
          />
        </button>
      ) : (
        <span className="w-1" aria-hidden />
      )}
    </li>
  );
}

export function LanguageSheet({
  open,
  title,
  items,
  value,
  recent = [],
  suggested = [],
  searchable = true,
  plain = false,
  onSelect,
  onClose,
}: Props) {
  useAndroidBack(open, onClose);
  const { t, locale, rtl } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);
  const pushed = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(mounted && !closing, sheetRef);

  const localized = useMemo(() => {
    let dn: Intl.DisplayNames | null = null;
    try {
      dn = new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      dn = null;
    }
    // Non-language codes (e.g. dialect ids like "levant") make Intl throw — fall back to nothing.
    return (code: string) => {
      if (!dn || code === "auto") return "";
      try {
        return dn.of(code) ?? "";
      } catch {
        return "";
      }
    };
  }, [locale]);

  // Mount / unmount with exit animation
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync with an external system (speech, storage, viewport, mount animation)
      setMounted(true);
      setClosing(false);
      setQuery("");
      setDrag(0);
      setFavorites(readFavorites());
    } else if (mounted) {
      setClosing(true);
      const id = window.setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 180);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back button closes the sheet
  useEffect(() => {
    if (!open) return;
    window.history.pushState({ sheet: "language" }, "");
    pushed.current = true;
    const onPop = () => {
      pushed.current = false;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      }
    };
  }, [open, onClose]);

  const pick = useCallback(
    (code: string) => {
      feel.tap();
      onSelect(code);
      onClose();
    },
    [onSelect, onClose],
  );

  const toggleFavorite = useCallback((code: string) => {
    setFavorites((prev) => {
      const next = prev.includes(code)
        ? prev.filter((c) => c !== code)
        : [code, ...prev].slice(0, 8);
      writeFavorites(next);
      feel.tap();
      return next;
    });
  }, []);

  const q = normalizeLanguageQuery(query);
  const filtered = useMemo(() => {
    if (!q) return items;
    return items.filter((it) =>
      [it.native, it.name, localized(it.code), it.code, ...(it.aliases ?? [])].some(
        (s) => s && normalizeLanguageQuery(s).includes(q),
      ),
    );
  }, [items, q, localized]);

  /* Sections keep a 76-language list navigable without a second screen: what this person
   * uses, what this pair needs, what most people need, then everyone else. A code appears
   * once — the first section that claims it. */
  const sections = useMemo(() => {
    if (q) return [{ key: "search", label: null as string | null, items: filtered }];
    const byCode = new Map(items.map((i) => [i.code, i]));
    const seen = new Set<string>();
    const take = (codes: readonly string[], limit = Infinity) => {
      const out: PickerItem[] = [];
      for (const code of codes) {
        if (out.length >= limit || seen.has(code)) continue;
        const item = byCode.get(code);
        if (!item) continue;
        seen.add(code);
        out.push(item);
      }
      return out;
    };
    const out: { key: string; label: string | null; items: PickerItem[] }[] = [];
    const fav = take(favorites, 6);
    if (fav.length) out.push({ key: "favorites", label: t("langFavorites"), items: fav });
    const rec = take(recent, 4);
    if (rec.length) out.push({ key: "recent", label: t("langRecent"), items: rec });
    const sug = take(suggested, 4);
    if (sug.length) out.push({ key: "suggested", label: t("langSuggested"), items: sug });
    const popular = take(items.filter((i) => i.popular).map((i) => i.code));
    if (popular.length) out.push({ key: "popular", label: t("langPopular"), items: popular });
    const all = take(items.filter((i) => i.code !== "auto").map((i) => i.code));
    if (all.length) out.push({ key: "all", label: t("langAll"), items: all });
    return out;
  }, [q, filtered, items, favorites, recent, suggested, t]);

  const auto = useMemo(
    () => (q ? null : (items.find((i) => i.code === "auto") ?? null)),
    [items, q],
  );

  if (!mounted || typeof document === "undefined") return null;

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0]!.clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null) return;
    setDrag(Math.max(0, e.touches[0]!.clientY - startY.current));
  };
  const onTouchEnd = () => {
    if (drag > 90) onClose();
    else setDrag(0);
    startY.current = null;
  };

  /** Arrow keys move between rows, so a long list never requires 70 Tab presses. */
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const rows = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-picker-row]"),
    );
    if (!rows.length) return;
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? rows.length - 1
          : at < 0
            ? 0
            : (at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    e.preventDefault();
    rows[next]?.focus();
  };

  return createPortal(
    <div
      ref={sheetRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 outline-none"
      dir={rtl ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-background/70 ${closing ? "animate-sheet-scrim-out" : "animate-sheet-scrim"}`}
      />
      <div
        style={{
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: drag ? "none" : undefined,
        }}
        className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[82dvh] w-full max-w-xl flex-col rounded-t-[26px] border-t border-border bg-surface ${
          closing ? "animate-sheet-out" : "animate-sheet-in"
        }`}
      >
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="shrink-0 touch-none"
        >
          <div className="flex justify-center pt-2.5">
            <span aria-hidden className="h-1 w-9 rounded-full bg-border-strong" />
          </div>
          <div className="flex items-center justify-between px-5 pb-2 pt-3">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="press-soft grid size-9 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="size-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        </div>
        {searchable ? (
          <div className="shrink-0 px-4 pb-2">
            <label className="flex h-11 items-center gap-2.5 rounded-2xl bg-card px-3.5 transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--signal)]">
              <Search className="size-4 shrink-0 text-faint" strokeWidth={1.75} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("langSearch")}
                aria-label={t("langSearch")}
                autoComplete="off"
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={t("clear")}
                  className="text-faint"
                >
                  <X className="size-4" strokeWidth={1.75} />
                </button>
              ) : null}
            </label>
          </div>
        ) : null}
        <div
          onKeyDown={onListKeyDown}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          {auto ? (
            <ul>
              <LanguageRow
                it={auto}
                value={value}
                plain={plain}
                localized={localized}
                favorite={false}
                onPick={pick}
                onToggleFavorite={toggleFavorite}
                t={t}
              />
            </ul>
          ) : null}
          {sections.map((section) => (
            <div key={section.key}>
              {section.label ? (
                <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
                  {section.label}
                </p>
              ) : null}
              <ul>
                {section.items.map((it) => (
                  <LanguageRow
                    key={`${section.key}-${it.code}`}
                    it={it}
                    value={value}
                    plain={plain}
                    localized={localized}
                    favorite={favorites.includes(it.code)}
                    onPick={pick}
                    onToggleFavorite={toggleFavorite}
                    t={t}
                  />
                ))}
              </ul>
            </div>
          ))}
          {!auto && !sections.some((s) => s.items.length) ? (
            <p className="px-4 py-8 text-center text-[14px] text-faint">{t("langNone")}</p>
          ) : null}
          {!plain && !q ? (
            <p className="px-4 pb-3 pt-4 text-[11px] leading-relaxed text-faint">
              {t("langOptimizedFor")}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const RECENT_KEY = "lingua.recent-langs";
const FAVORITES_KEY = "lingua.language-favorites.v1";

export function readRecent(): string[] {
  try {
    const v = JSON.parse(readDeviceValue(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? [...new Set(v.filter(codeOk))].slice(0, 5) : [];
  } catch {
    return [];
  }
}
export function pushRecent(code: string) {
  if (!codeOk(code)) return;
  try {
    const next = [code, ...readRecent().filter((c) => c !== code)].slice(0, 5);
    void writeDeviceValue(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Device-only, bounded and validated — a damaged list must never reach the picker. */
export function readFavorites(): string[] {
  try {
    const v = JSON.parse(readDeviceValue(FAVORITES_KEY) ?? "[]");
    return Array.isArray(v) ? [...new Set(v.filter(codeOk))].slice(0, 8) : [];
  } catch {
    return [];
  }
}
function writeFavorites(codes: string[]) {
  void writeDeviceValue(
    FAVORITES_KEY,
    JSON.stringify([...new Set(codes.filter(codeOk))].slice(0, 8)),
  );
}
