import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { tick } from "@/lib/haptics";

export interface PickerItem {
  code: string;
  native: string;
  name: string;
  rtl?: boolean;
  aliases?: string[];
}

interface Props {
  open: boolean;
  title: string;
  items: PickerItem[];
  value: string;
  recent?: string[];
  searchable?: boolean;
  /** Items aren't languages (e.g. dialects): show names as given, no locale lookups. */
  plain?: boolean;
  onSelect: (code: string) => void;
  onClose: () => void;
}

const norm = (s: string) =>
  s.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f\u064B-\u065F]/g, "").trim();

export function LanguageSheet({ open, title, items, value, recent = [], searchable = true, plain = false, onSelect, onClose }: Props) {
  const { t, locale, rtl } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState("");
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);
  const pushed = useRef(false);

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
      setMounted(true);
      setClosing(false);
      setQuery("");
      setDrag(0);
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
      tick();
      onSelect(code);
      onClose();
    },
    [onSelect, onClose],
  );

  const q = norm(query);
  const filtered = useMemo(() => {
    if (!q) return items;
    return items.filter((it) =>
      [it.native, it.name, localized(it.code), it.code, ...(it.aliases ?? [])].some((s) => s && norm(s).includes(q)),
    );
  }, [items, q, localized]);

  const recentItems = useMemo(
    () => (q ? [] : recent.map((c) => items.find((i) => i.code === c)).filter((i): i is PickerItem => Boolean(i)).slice(0, 3)),
    [recent, items, q],
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

  const Row = ({ it }: { it: PickerItem }) => {
    const active = it.code === value;
    const sub = plain ? "" : localized(it.code);
    const secondary = sub && norm(sub) !== norm(it.native) ? sub : it.name !== it.native ? it.name : "";
    return (
      <li>
        <button
          type="button"
          onClick={() => pick(it.code)}
          aria-pressed={active}
          className="press-soft flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-start transition-colors hover:bg-card"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              style={{ textAlign: rtl ? "right" : "left" }}
              className={`truncate ${active ? "text-foreground" : "text-foreground/90"} ${
                it.rtl ? "font-arabic text-[19px] leading-[1.35]" : "text-[17px] leading-[1.35] tracking-[-0.01em]"
              } ${active ? "font-semibold" : "font-medium"}`}
            >
              {it.code === "auto" && !plain ? t("detect") : it.native}
            </span>
            {secondary && it.code !== "auto" ? (
              <span className="truncate text-[12px] text-faint">{secondary}</span>
            ) : null}
          </span>
          <span className={`grid size-6 shrink-0 place-items-center ${active ? "text-signal" : "text-transparent"}`}>
            <Check className="size-[18px]" strokeWidth={2} />
          </span>
        </button>
      </li>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50" dir={rtl ? "rtl" : "ltr"} role="dialog" aria-modal="true" aria-label={title}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-background/70 ${closing ? "animate-sheet-scrim-out" : "animate-sheet-scrim"}`}
      />
      <div
        style={{ transform: drag ? `translateY(${drag}px)` : undefined, transition: drag ? "none" : undefined }}
        className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[82dvh] w-full max-w-xl flex-col rounded-t-[26px] border-t border-border bg-surface ${
          closing ? "animate-sheet-out" : "animate-sheet-in"
        }`}
      >
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className="shrink-0 touch-none">
          <div className="flex justify-center pt-2.5">
            <span aria-hidden className="h-1 w-9 rounded-full bg-border-strong" />
          </div>
          <div className="flex items-center justify-between px-5 pb-2 pt-3">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
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
                <button type="button" onClick={() => setQuery("")} aria-label={t("clear")} className="text-faint">
                  <X className="size-4" strokeWidth={1.75} />
                </button>
              ) : null}
            </label>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {recentItems.length ? (
            <>
              <p className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{t("langRecent")}</p>
              <ul>{recentItems.map((it) => <Row key={`r-${it.code}`} it={it} />)}</ul>
              <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{t("langAll")}</p>
            </>
          ) : null}
          {filtered.length ? (
            <ul>{filtered.map((it) => <Row key={it.code} it={it} />)}</ul>
          ) : (
            <p className="px-4 py-8 text-center text-[14px] text-faint">{t("langNone")}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const RECENT_KEY = "lingua.recent-langs";
export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function pushRecent(code: string) {
  if (code === "auto") return;
  try {
    const next = [code, ...readRecent().filter((c) => c !== code)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
