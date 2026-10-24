import { memo, useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { isRtl } from "@/lib/translation/languages";
import { sortRecords, type SortId, type StatRecord } from "@/lib/stats/engine";
import { colorOf } from "@/lib/stats/taxonomy";
import { categoryLabel, type statsT } from "@/lib/stats/labels";
import type { Locale } from "@/lib/i18n";
import type { Fmt } from "./format";

const PAGE = 30;

/** The individual translations behind any number: sortable, searchable, loaded in pages. */
export const RecordList = memo(function RecordList({
  records,
  onOpen,
  fmt,
  t,
  locale,
  controls = true,
  limit,
}: {
  records: StatRecord[];
  onOpen: (id: string) => void;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  locale: Locale;
  controls?: boolean;
  limit?: number;
}) {
  const [sort, setSort] = useState<SortId>("newest");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(limit ?? PAGE);
  const q = useDeferredValue(query.trim().toLowerCase());
  const list = useMemo(() => {
    const base = q
      ? records.filter(
          (r) => r.original.toLowerCase().includes(q) || r.translated.toLowerCase().includes(q),
        )
      : records;
    return sortRecords(base, sort);
  }, [records, sort, q]);

  return (
    <div>
      {controls ? (
        <div className="mb-2 flex flex-col gap-2">
          <label className="flex h-10 items-center gap-2 rounded-xl bg-card px-3 text-muted-foreground focus-within:ring-1 focus-within:ring-ring">
            <Search className="size-4 shrink-0" strokeWidth={1.75} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-faint"
            />
          </label>
          <div role="radiogroup" aria-label={t("sort")} className="flex gap-1">
            {(["newest", "oldest", "uses"] as SortId[]).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={sort === s}
                onClick={() => setSort(s)}
                className={`press-soft h-8 rounded-full px-3 text-[12.5px] ${
                  sort === s ? "bg-card text-foreground" : "text-muted-foreground"
                }`}
              >
                {t(s === "newest" ? "s_newest" : s === "oldest" ? "s_oldest" : "s_uses")}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {list.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">{t("noMatch")}</p>
      ) : (
        <ul className="flex flex-col">
          {list.slice(0, shown).map((r) => (
            <li key={r.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                className="press-soft flex w-full flex-col gap-1 py-3 text-start"
              >
                <span className="flex items-center gap-2 text-[11px] text-faint">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: colorOf("domain", r.domain) }}
                  />
                  <span className="truncate">{categoryLabel(locale, "domain", r.domain)}</span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">{fmt.pair(r.pair)}</span>
                  {r.uses > 1 ? (
                    <span className="ms-auto shrink-0 tabular-nums">
                      {t("i_times", { n: r.uses })}
                    </span>
                  ) : null}
                </span>
                <span
                  dir={isRtl(r.source) ? "rtl" : "ltr"}
                  lang={r.source}
                  className="line-clamp-2 text-start text-[15px] leading-snug text-foreground"
                >
                  {r.original}
                </span>
                <span
                  dir={isRtl(r.target) ? "rtl" : "ltr"}
                  lang={r.target}
                  className="line-clamp-1 text-start text-[13px] text-muted-foreground"
                >
                  {r.translated}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.length > shown ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="press-soft mt-2 h-10 w-full rounded-xl text-[13px] text-muted-foreground hover:text-foreground"
        >
          {t("more")} · {fmt.num(list.length - shown)}
        </button>
      ) : null}
    </div>
  );
});
