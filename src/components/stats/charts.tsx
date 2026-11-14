import { memo } from "react";
import type { Bucket, Granularity } from "@/lib/stats/engine";
import type { Fmt } from "./format";
import { addDays, daysBetween, weekKey } from "@/lib/stats/engine";

/** Every point represents one actual bucket, including days with no activity. */
export function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const points = values
    .map(
      (value, i) =>
        `${values.length > 1 ? (i / (values.length - 1)) * 120 : 60},${29 - (value / max) * 25}`,
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 120 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-8 w-full text-muted-foreground"
    >
      <path d="M0 29H120" stroke="var(--border-strong)" fill="none" />
      {values.length === 1 ? (
        <circle cx="60" cy={29 - ((values[0] ?? 0) / max) * 25} r="2" fill="currentColor" />
      ) : (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/** Daily buckets only. Blank cells are outside the period, not zero-activity days. */
export function CalendarChart({
  buckets,
  metric,
  selected,
  todayKey,
  onSelect,
  fmt,
  label,
  less,
  more,
}: {
  buckets: Bucket[];
  metric: "translations" | "words";
  selected: string | null;
  todayKey: string;
  onSelect: (key: string) => void;
  fmt: Fmt;
  label: string;
  less: string;
  more: string;
}) {
  const first = buckets[0];
  if (!first) return null;
  const monday = weekKey(first.from);
  const padding = daysBetween(monday, first.from);
  const max = Math.max(1, ...buckets.map((b) => b[metric]));
  return (
    <div role="group" aria-label={label}>
      <div dir="ltr" className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="pb-1 text-center text-[12px] text-muted-foreground">
            {fmt.weekday(addDays(monday, i))}
          </span>
        ))}
        {Array.from({ length: padding }, (_, i) => (
          <span key={`pad-${i}`} aria-hidden="true" />
        ))}
        {buckets.map((b) => {
          const level = b[metric] === 0 ? 0 : Math.max(1, Math.ceil((b[metric] / max) * 4));
          const name = `${fmt.dayLong(b.from)}: ${fmt.num(b[metric])}`;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onSelect(b.key)}
              aria-label={name}
              aria-pressed={selected === b.key}
              aria-current={b.key === todayKey ? "date" : undefined}
              title={name}
              data-level={level}
              data-selected={selected === b.key}
              className="stats-calendar-day press-soft flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md border text-[12px] tabular-nums"
            >
              <span>{fmt.num(Number(b.from.slice(-2)))}</span>
              <span className="text-[10px]">{fmt.num(b[metric])}</span>
            </button>
          );
        })}
      </div>
      <div
        className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground"
        aria-hidden="true"
      >
        <span>{less}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            data-level={level}
            className="stats-calendar-day size-2.5 rounded-sm border"
          />
        ))}
        <span>{more}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ timeline */

/**
 * Activity bars. Time always runs left → right (chronology is not mirrored in RTL),
 * every bar is a real button with its own label, and the readout sits above the
 * chart so it never covers data under a finger.
 */
export const TimelineChart = memo(function TimelineChart({
  buckets,
  metric,
  granularity,
  selected,
  todayKey,
  onSelect,
  fmt,
  label,
  compact = false,
}: {
  buckets: Bucket[];
  metric: "translations" | "words";
  granularity: Granularity;
  selected: string | null;
  todayKey: string;
  onSelect?: (key: string) => void;
  fmt: Fmt;
  label: string;
  compact?: boolean;
}) {
  const max = Math.max(1, ...buckets.map((b) => b[metric]));
  const height = compact ? 56 : 148;
  const labelEvery = Math.max(1, Math.ceil(buckets.length / (compact ? 4 : 6)));
  return (
    <div dir="ltr" role="group" aria-label={label}>
      {!compact ? (
        <div className="mb-1 flex justify-between text-[11px] tabular-nums text-faint">
          <span>{fmt.num(max)}</span>
        </div>
      ) : null}
      <div className="relative" style={{ height }}>
        {!compact ? (
          <>
            <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" />
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
          </>
        ) : null}
        <div className="absolute inset-0 flex items-end gap-[3px] border-b border-border-strong">
          {buckets.map((b) => {
            const v = b[metric];
            const h = v ? Math.max(3, (v / max) * height) : 0;
            const isSel = selected === b.key;
            const isToday = todayKey >= b.from && todayKey <= b.to;
            const name = `${fmt.bucket(b.from, b.to, granularity)}: ${fmt.num(v)}`;
            return (
              <button
                key={b.key}
                type="button"
                disabled={!onSelect}
                onClick={() => onSelect?.(b.key)}
                aria-label={name}
                aria-pressed={onSelect ? isSel : undefined}
                title={name}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center disabled:cursor-default"
              >
                <span
                  className={`block w-full max-w-[22px] rounded-t-[4px] motion-safe:transition-[height,background-color] motion-safe:duration-300 ${
                    isSel ? "bg-signal" : v ? "bg-muted-foreground group-hover:bg-foreground" : ""
                  }`}
                  style={{ height: h }}
                />
                {isToday && !compact ? (
                  <span className="absolute -bottom-[7px] size-1 rounded-full bg-signal-text" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      {!compact ? (
        <div className="mt-2.5 flex gap-[3px] text-[10.5px] tabular-nums text-faint">
          {buckets.map((b, i) => (
            <span
              key={b.key}
              className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center"
            >
              {i % labelEvery === 0 ? fmt.bucketShort(b.from, granularity) : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
});

/* ---------------------------------------------------------------------- donut */

export interface DonutSlice {
  id: string;
  value: number;
  color: string;
  label: string;
}

export const Donut = memo(function Donut({
  slices,
  selected,
  onSelect,
  center,
  caption,
  label,
}: {
  slices: DonutSlice[];
  selected: string | null;
  onSelect: (id: string) => void;
  center: string;
  caption: string;
  label: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const r = 42;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 1.6 : 0;
  const arcs = slices.reduce<{ slice: DonutSlice; length: number; offset: number }[]>((out, slice) => {
    const previous = out[out.length - 1];
    out.push({ slice, length: (slice.value / total) * c, offset: previous ? previous.offset + previous.length : 0 });
    return out;
  }, []);
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[188px]">
      {/* A group, not an image: the slices are real buttons, so a keyboard user can
          reach the same filter a pointer user reaches. */}
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="group" aria-label={label}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border)" strokeWidth="9" />
        {arcs.map(({ slice: s, length: len, offset }) => {
          const dash = Math.max(0.01, len - gap);
          return (
            <circle
              key={s.id}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={selected === s.id ? 13 : 9}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              opacity={selected && selected !== s.id ? 0.35 : 1}
              onClick={() => onSelect(s.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelect(s.id);
              }}
              role="button"
              tabIndex={0}
              aria-label={s.label}
              aria-pressed={selected === s.id}
              className="donut-slice cursor-pointer motion-safe:transition-[stroke-width,opacity] motion-safe:duration-300"
            >
              <title>{s.label}</title>
            </circle>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-[26px] font-semibold leading-none tracking-tight tabular-nums">
            {center}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{caption}</div>
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------- horizontal bars */

export interface BarRow {
  id: string;
  label: string;
  count: number;
  share: number;
  color: string;
  estimated?: boolean;
}

/** Category rows: swatch + name + count + share, so colour is never the only cue. */
export const BarList = memo(function BarList({
  rows,
  selected,
  onSelect,
  fmt,
  estimatedLabel,
}: {
  rows: BarRow[];
  selected?: string | null | undefined;
  onSelect: (id: string) => void;
  fmt: Fmt;
  estimatedLabel?: string | undefined;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="flex flex-col">
      {rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onSelect(r.id)}
            aria-pressed={selected === r.id}
            className={`press-soft w-full rounded-md px-2 py-3 text-start transition-colors hover:bg-card ${
              selected === r.id ? "bg-card" : ""
            }`}
          >
            <span className="flex items-baseline gap-2">
              <span
                className="size-2 shrink-0 translate-y-[-1px] rounded-[3px]"
                style={{ background: r.color }}
              />
              <span className="min-w-0 flex-1 text-[14px] text-foreground">
                {r.label}
                {r.estimated && estimatedLabel ? (
                  <span className="ms-1.5 text-[11px] text-faint">· {estimatedLabel}</span>
                ) : null}
              </span>
              <span className="text-[13px] tabular-nums text-foreground">{fmt.num(r.count)}</span>
              <span className="w-10 text-end text-[12px] tabular-nums text-muted-foreground">
                {fmt.pct(r.share)}
              </span>
            </span>
            <span className="mt-2 block h-[6px] overflow-hidden rounded-full bg-border">
              <span
                className="block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500"
                style={{ width: `${(r.count / max) * 100}%`, background: r.color }}
              />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
});

/* ---------------------------------------------------------------- stacked bar */

export const StackBar = memo(function StackBar({
  rows,
  selected,
  onSelect,
  fmt,
  label,
}: {
  rows: BarRow[];
  selected?: string | null | undefined;
  onSelect: (id: string) => void;
  fmt: Fmt;
  label: string;
}) {
  return (
    <div>
      <div
        role="img"
        aria-label={label}
        className="flex h-3 gap-[2px] overflow-hidden rounded-full"
      >
        {rows.map((r) => (
          <span
            key={r.id}
            className="h-full motion-safe:transition-[flex-grow,opacity] motion-safe:duration-500"
            style={{
              flexGrow: r.count,
              flexBasis: 0,
              background: r.color,
              opacity: selected && selected !== r.id ? 0.35 : 1,
            }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            aria-pressed={selected === r.id}
            className={`press-soft inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-[13px] ${
              selected === r.id ? "border-border-strong bg-card" : "border-border"
            }`}
          >
            <span className="size-2 rounded-[3px]" style={{ background: r.color }} />
            <span className="text-foreground">{r.label}</span>
            <span className="tabular-nums text-muted-foreground">{fmt.pct(r.share)}</span>
          </button>
        ))}
      </div>
    </div>
  );
});
