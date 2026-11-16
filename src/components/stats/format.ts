import type { Locale } from "@/lib/i18n";
import type { Granularity } from "@/lib/stats/engine";
import { numberFormat, statsT } from "@/lib/stats/labels";

const utc = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12));
};

export function makeFormat(locale: Locale) {
  const tag = `${locale}-u-nu-latn`;
  const n = numberFormat(locale);
  const n1 = numberFormat(locale, { maximumFractionDigits: 1 });
  const pctF = numberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const signed = numberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  });
  const dayF = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" });
  const dayLongF = new Intl.DateTimeFormat(tag, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const monthF = new Intl.DateTimeFormat(tag, { month: "short", year: "numeric", timeZone: "UTC" });
  const stampF = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" });
  const weekdayF = new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" });
  const hourF = new Intl.DateTimeFormat(tag, {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: "UTC",
  });
  // 2024-01-01 was a Monday: a stable anchor for Monday-first weekday labels.
  const weekdayOf = (i: number) => weekdayF.format(new Date(Date.UTC(2024, 0, 1 + i, 12)));
  const hourOf = (h: number) => hourF.format(new Date(Date.UTC(2024, 0, 1, h, 12)));
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: "language" });
  } catch {
    names = null;
  }
  const t = statsT(locale);

  const langName = (code: string) => {
    if (code === "auto") return t("lang_auto");
    try {
      return (/^[a-z]{2}$/.test(code) && names?.of(code)) || code.toUpperCase();
    } catch {
      return code.toUpperCase();
    }
  };

  return {
    num: (v: number) => n.format(v),
    num1: (v: number) => n1.format(v),
    pct: (v: number) => (v > 0 && v < 0.005 ? `<${pctF.format(0.01)}` : pctF.format(v)),
    delta: (v: number) => signed.format(v),
    day: (key: string) => dayF.format(utc(key)),
    dayLong: (key: string) => dayLongF.format(utc(key)),
    weekday: (key: string) => weekdayF.format(utc(key)),
    weekdayOf,
    hour: hourOf,
    bucket: (from: string, to: string, g: Granularity) =>
      g === "day"
        ? dayLongF.format(utc(from))
        : g === "week"
          ? `${dayF.format(utc(from))} – ${dayF.format(utc(to))}`
          : monthF.format(utc(from)),
    bucketShort: (from: string, g: Granularity) =>
      g === "month" ? monthF.format(utc(from)) : dayF.format(utc(from)),
    stamp: (ms: number) => stampF.format(new Date(ms)),
    langName,
    pair: (pair: string) => {
      const [a, b] = pair.split(">");
      return t("pairLabel", { a: langName(a ?? ""), b: langName(b ?? "") });
    },
  };
}
export type Fmt = ReturnType<typeof makeFormat>;
