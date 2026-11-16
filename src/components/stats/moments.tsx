import {
  memo,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  CalendarDays,
  Check,
  Clock,
  Compass,
  FileText,
  Flame,
  Moon,
  Repeat2,
  Shapes,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { Slice } from "@/lib/stats/engine";
import {
  PARTS_OF_DAY,
  nextMilestones,
  partOfDay,
  type FlowNode,
  type Highlights,
  type LanguageFlow,
  type Milestone,
  type PartOfDay,
  type PracticeProfile,
  type Rhythm,
  type Streaks,
} from "@/lib/stats/moments";
import { colorOf, pairColor } from "@/lib/stats/taxonomy";
import { categoryLabel, statsT } from "@/lib/stats/labels";
import type { Fmt } from "./format";

const PART_COLOR: Record<PartOfDay, string> = {
  night: "var(--cat-4)",
  morning: "var(--cat-5)",
  afternoon: "var(--cat-1)",
  evening: "var(--cat-10)",
};

/* --------------------------------------------------------- practice map */

/**
 * The practice landscape is the visual centerpiece of the page: one plate where the
 * strongest topic sits at the centre and the other topics orbit it. Every radius, angle
 * and ribbon is derived from the real archive, and the typographic readout states the
 * same measures as plain numbers — the picture is never the only way to read the data.
 */

/** Plate geometry in SVG user units; the viewBox keeps the map legible at every width. */
const PLATE_W = 400;
const PLATE_H = 300;
const PLATE_X = PLATE_W / 2;
const PLATE_Y = 146;
const FOCUS_R = 27;
const OUTER_ORBIT = { rx: 96, ry: 78 };
const INNER_ORBIT = { rx: 64, ry: 50 };
const TRAIL_ORBIT = { x: PLATE_X, y: 150, rx: 190, ry: 132 };
const MAX_SATELLITES = 9;
const DEG = Math.PI / 180;

type LabelSide = "left" | "right" | "above";
type StatsLocale = "en" | "ar" | "de";

interface SatelliteSlot {
  /** SVG angle: 0 points right, -90 points up. */
  angle: number;
  orbit: "inner" | "outer";
  side: LabelSide;
}

/**
 * Rank-based slots: the second-strongest topic takes the first, each further topic the
 * next. Angles are hand-chosen and label sides alternate because a plain even spread
 * around the ring stacks labels on top of each other at the top of the plate.
 */
const SATELLITE_SLOTS: readonly SatelliteSlot[] = [
  { angle: -50, orbit: "outer", side: "right" },
  { angle: 145, orbit: "outer", side: "left" },
  { angle: -90, orbit: "outer", side: "above" },
  { angle: -160, orbit: "outer", side: "left" },
  { angle: 15, orbit: "inner", side: "right" },
  { angle: 38, orbit: "outer", side: "right" },
  { angle: 165, orbit: "inner", side: "left" },
  { angle: -125, orbit: "outer", side: "left" },
  { angle: -30, orbit: "inner", side: "right" },
];

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Split a category name into at most two lines, balanced at a word boundary. */
function wrapLabel(label: string, budget: number): string[] {
  if (label.length <= budget) return [label];
  const words = label.split(" ");
  if (words.length < 2) return [label];
  let split = 1;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index++) {
    const head = words.slice(0, index).join(" ").length;
    const tail = words.slice(index).join(" ").length;
    const score = Math.max(head, tail) + Math.abs(head - tail) / 4;
    if (score < best) {
      best = score;
      split = index;
    }
  }
  return [words.slice(0, split).join(" "), words.slice(split).join(" ")];
}

interface PlacedTopic {
  id: string;
  label: string;
  count: number;
  share: number;
  color: string;
  x: number;
  y: number;
  radius: number;
  /** Share of the strongest satellite (0–1): the one scale size and ribbon width need. */
  weight: number;
  ribbon: string;
  lines: string[];
  labelX: number;
  labelY: number;
  anchor: "start" | "middle" | "end";
}

/** Deterministic constellation: rank decides the slot, the archive decides size and path. */
function placeTopics(profile: PracticeProfile, locale: StatsLocale): PlacedTopic[] {
  const focus = profile.focus;
  if (!focus) return [];
  const rtl = locale === "ar";
  const others = profile.domains.slice(1, 1 + MAX_SATELLITES);
  const strongest = Math.max(1, ...others.map((slice) => slice.count));
  return others.map((slice, index) => {
    const slot = SATELLITE_SLOTS[index % SATELLITE_SLOTS.length]!;
    const orbit = slot.orbit === "outer" ? OUTER_ORBIT : INNER_ORBIT;
    const angle = slot.angle * DEG;
    const x = PLATE_X + Math.cos(angle) * orbit.rx;
    const y = PLATE_Y + Math.sin(angle) * orbit.ry;
    const weight = Math.min(1, slice.count / strongest);
    const radius = 7 + 9 * Math.sqrt(weight);
    const label = categoryLabel(locale, "domain", slice.id);
    const lines = wrapLabel(label, slot.side === "above" ? 12 : 10);
    const labelY =
      slot.side === "above"
        ? y - radius - (lines.length > 1 ? 20 : 8)
        : y - (lines.length > 1 ? 6 : 3.5);
    const labelX =
      slot.side === "above" ? x : slot.side === "right" ? x + radius + 6 : x - radius - 6;
    const anchor: PlacedTopic["anchor"] =
      slot.side === "above"
        ? "middle"
        : rtl
          ? slot.side === "right"
            ? "end"
            : "start"
          : slot.side === "right"
            ? "start"
            : "end";
    const dx = x - PLATE_X;
    const dy = y - PLATE_Y;
    const distance = Math.hypot(dx, dy) || 1;
    const ux = dx / distance;
    const uy = dy / distance;
    const startX = PLATE_X + ux * (FOCUS_R + 6);
    const startY = PLATE_Y + uy * (FOCUS_R + 6);
    const endX = x - ux * (radius + 2);
    const endY = y - uy * (radius + 2);
    const bend = (index % 2 === 0 ? 1 : -1) * distance * 0.22;
    const controlX = (startX + endX) / 2 - uy * bend;
    const controlY = (startY + endY) / 2 + ux * bend;
    const ribbon = [
      "M",
      round1(startX),
      round1(startY),
      "Q",
      round1(controlX),
      round1(controlY),
      round1(endX),
      round1(endY),
    ].join(" ");
    return {
      id: slice.id,
      label,
      count: slice.count,
      share: slice.share,
      color: colorOf("domain", slice.id),
      x,
      y,
      radius,
      weight,
      ribbon,
      lines,
      labelX,
      labelY,
      anchor,
    };
  });
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  if (typeof query.addEventListener !== "function") return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION).matches
  );
}

/** One media-query read, no polling: a reduced-motion device gets a still plate. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

export function PracticeLandscape({
  profile,
  trail,
  selectedDomain = null,
  fmt,
  t,
  locale,
  onOpenDomain,
}: {
  profile: PracticeProfile;
  /** One count per day of practice, oldest first — the outer trail orbit. */
  trail: number[];
  selectedDomain?: string | null;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  locale: StatsLocale;
  onOpenDomain: (domain: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  const [drawn, setDrawn] = useState(false);
  // A single post-paint flip drives the mounting transition; there is no animation loop.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-shot mount transition, not a state sync
    setDrawn(true);
  }, []);
  const revealed = drawn || reducedMotion;
  const rtl = locale === "ar";
  const dotsId = "practice-dots-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const topics = useMemo(() => placeTopics(profile, locale), [profile, locale]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const emphasis = hovered ?? focusedId ?? selectedDomain;
  const focus = profile.focus;
  const focusLabel = focus ? categoryLabel(locale, "domain", focus.id) : "";
  const focusColor = focus ? colorOf("domain", focus.id) : "var(--faint)";
  const focusLines = focus ? wrapLabel(focusLabel, 18) : [];
  const trailMax = Math.max(1, ...trail);
  const summary = focus
    ? t("mapSummary", {
        focus: focusLabel,
        share: fmt.pct(focus.share),
        domains: fmt.num(profile.activeDomains),
        active: fmt.num(profile.activeDays),
        possible: fmt.num(profile.possibleDays),
      })
    : t("mapSummaryEmpty");

  /** Mount-only transition: nodes grow from their own centre, staggered by rank. */
  const mountStyle = (x: number, y: number, delay: number): CSSProperties =>
    reducedMotion
      ? {}
      : {
          opacity: revealed ? 1 : 0,
          transform: revealed
            ? "translate(0px, 0px) scale(1)"
            : "translate(" +
              x +
              "px, " +
              y +
              "px) scale(0.35) translate(" +
              -x +
              "px, " +
              -y +
              "px)",
          transition:
            "opacity 420ms var(--ease-out) " +
            delay +
            "ms, transform 520ms var(--ease-out) " +
            delay +
            "ms",
        };

  const countWords = (count: number) =>
    count === 1 ? t("countOne") : t("count", { n: fmt.num(count) });

  return (
    <div>
      <p className="mb-5 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
        {t("landscapeSub")}
      </p>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr] lg:items-center lg:gap-4">
        <div className={focus ? "min-w-0" : "min-w-0 lg:col-span-2"}>
          <div className="mx-auto w-full max-w-[520px]">
            <svg
              viewBox={"0 0 " + PLATE_W + " " + PLATE_H}
              className="w-full overflow-visible"
              role="group"
              aria-label={summary}
            >
              <defs>
                <pattern id={dotsId} width="9" height="9" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="0.7" fill="var(--border)" />
                </pattern>
              </defs>
              <rect
                width={PLATE_W}
                height={PLATE_H}
                fill={"url(#" + dotsId + ")"}
                opacity="0.55"
                aria-hidden="true"
              />
              <g
                aria-hidden="true"
                fill="none"
                style={{
                  opacity: revealed ? 1 : 0,
                  transition: reducedMotion ? "none" : "opacity 900ms var(--ease-out)",
                }}
              >
                <ellipse
                  cx={PLATE_X}
                  cy={PLATE_Y}
                  rx={OUTER_ORBIT.rx}
                  ry={OUTER_ORBIT.ry}
                  stroke="var(--border)"
                />
                <ellipse
                  cx={PLATE_X}
                  cy={PLATE_Y}
                  rx={INNER_ORBIT.rx}
                  ry={INNER_ORBIT.ry}
                  stroke="var(--faint)"
                  strokeDasharray="1 7"
                  opacity="0.65"
                />
                <ellipse
                  cx={TRAIL_ORBIT.x}
                  cy={TRAIL_ORBIT.y}
                  rx={TRAIL_ORBIT.rx}
                  ry={TRAIL_ORBIT.ry}
                  stroke="var(--border)"
                  strokeDasharray="2 10"
                  opacity="0.45"
                />
              </g>
              <g aria-hidden="true">
                {trail.map((count, index) => {
                  const angle = -Math.PI / 2 + (index / Math.max(1, trail.length)) * Math.PI * 2;
                  const x = TRAIL_ORBIT.x + Math.cos(angle) * TRAIL_ORBIT.rx;
                  const y = TRAIL_ORBIT.y + Math.sin(angle) * TRAIL_ORBIT.ry;
                  const intensity = count / trailMax;
                  const latest = index === trail.length - 1;
                  const style: CSSProperties = reducedMotion
                    ? {}
                    : {
                        opacity: revealed ? (count ? 1 : 0.8) : 0,
                        transition: "opacity 520ms var(--ease-out) " + (260 + index * 9) + "ms",
                      };
                  if (!count)
                    return (
                      <circle
                        key={index}
                        data-testid="trail-day"
                        cx={x}
                        cy={y}
                        r={2.1}
                        fill="none"
                        stroke="var(--border)"
                        strokeWidth="1"
                        style={style}
                      />
                    );
                  return (
                    <circle
                      key={index}
                      data-testid="trail-day"
                      cx={x}
                      cy={y}
                      r={1.5 + 2.4 * Math.sqrt(intensity)}
                      fill={latest ? "var(--signal)" : "var(--muted-foreground)"}
                      opacity={0.4 + 0.5 * intensity}
                      style={style}
                    />
                  );
                })}
              </g>
              <g aria-hidden="true">
                {topics.map((topic, index) => {
                  const active = emphasis === topic.id;
                  const dimmed = emphasis !== null && !active;
                  return (
                    <path
                      key={"ribbon-" + topic.id}
                      d={topic.ribbon}
                      fill="none"
                      stroke={topic.color}
                      strokeWidth={(1.3 + 4.6 * topic.weight) * (active ? 1.5 : 1)}
                      strokeLinecap="round"
                      pathLength={1}
                      strokeDasharray="1 1"
                      strokeDashoffset={revealed ? 0 : 1}
                      opacity={dimmed ? 0.05 : active ? 0.75 : 0.18 + 0.3 * topic.weight}
                      style={{
                        transition: reducedMotion
                          ? "none"
                          : "opacity 240ms var(--ease-soft), stroke-width 240ms var(--ease-soft), stroke-dashoffset 760ms var(--ease-out) " +
                            (120 + index * 45) +
                            "ms",
                      }}
                    />
                  );
                })}
              </g>
              <g>
                {topics.map((topic, index) => {
                  const dimmed = emphasis !== null && emphasis !== topic.id;
                  const selected = selectedDomain === topic.id;
                  const focusedHere = focusedId === topic.id;
                  return (
                    <g
                      key={topic.id}
                      role="button"
                      tabIndex={0}
                      data-testid="map-topic"
                      aria-label={t("mapNode", {
                        label: topic.label,
                        count: countWords(topic.count),
                        pct: fmt.pct(topic.share),
                      })}
                      aria-pressed={selected}
                      onClick={() => onOpenDomain(topic.id)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onOpenDomain(topic.id);
                      }}
                      onMouseEnter={() => setHovered(topic.id)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setFocusedId(topic.id)}
                      onBlur={() => setFocusedId(null)}
                      style={{
                        cursor: "pointer",
                        opacity: dimmed ? 0.42 : 1,
                        transition: reducedMotion ? "none" : "opacity 240ms var(--ease-soft)",
                      }}
                    >
                      <g style={mountStyle(topic.x, topic.y, 200 + index * 45)}>
                        <circle cx={topic.x} cy={topic.y} r={topic.radius + 9} fill="transparent" />
                        <circle
                          cx={topic.x}
                          cy={topic.y}
                          r={topic.radius}
                          fill={topic.color}
                          opacity="0.92"
                        />
                        <circle
                          cx={topic.x}
                          cy={topic.y}
                          r={topic.radius + 4.5}
                          fill="none"
                          stroke={topic.color}
                          strokeWidth="1"
                          opacity="0.35"
                        />
                        {selected ? (
                          <circle
                            cx={topic.x}
                            cy={topic.y}
                            r={topic.radius + 8}
                            fill="none"
                            stroke={topic.color}
                            strokeWidth="1.4"
                          />
                        ) : null}
                        {focusedHere ? (
                          <circle
                            cx={topic.x}
                            cy={topic.y}
                            r={topic.radius + 8}
                            fill="none"
                            stroke="var(--ring)"
                            strokeWidth="2"
                          />
                        ) : null}
                        <text
                          x={topic.labelX}
                          y={topic.labelY}
                          textAnchor={topic.anchor}
                          fill="var(--foreground)"
                          style={{ direction: rtl ? "rtl" : "ltr", fontSize: 10, fontWeight: 500 }}
                        >
                          {topic.lines[0]}
                          {topic.lines.slice(1).map((line, lineIndex) => (
                            <tspan key={lineIndex} x={topic.labelX} dy={13}>
                              {line}
                            </tspan>
                          ))}
                          <tspan
                            fill="var(--muted-foreground)"
                            style={{ fontSize: 9.2, fontVariantNumeric: "tabular-nums" }}
                          >
                            {" "}
                            {fmt.pct(topic.share)}
                          </tspan>
                        </text>
                      </g>
                    </g>
                  );
                })}
                {focus ? (
                  <g
                    role="button"
                    tabIndex={0}
                    data-testid="map-focus"
                    aria-label={t("mapNode", {
                      label: focusLabel,
                      count: countWords(focus.count),
                      pct: fmt.pct(focus.share),
                    })}
                    aria-pressed={selectedDomain === focus.id}
                    onClick={() => onOpenDomain(focus.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onOpenDomain(focus.id);
                    }}
                    onMouseEnter={() => setHovered(focus.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setFocusedId(focus.id)}
                    onBlur={() => setFocusedId(null)}
                    style={{ cursor: "pointer" }}
                  >
                    <g style={mountStyle(PLATE_X, PLATE_Y, 80)}>
                      <circle cx={PLATE_X} cy={PLATE_Y} r={FOCUS_R + 12} fill="transparent" />
                      <circle
                        cx={PLATE_X}
                        cy={PLATE_Y}
                        r={FOCUS_R + 10}
                        fill="none"
                        stroke="var(--border)"
                      />
                      <circle cx={PLATE_X} cy={PLATE_Y} r={FOCUS_R} fill={focusColor} />
                      <circle
                        cx={PLATE_X}
                        cy={PLATE_Y}
                        r={FOCUS_R - 6}
                        fill="none"
                        stroke="var(--background)"
                        strokeWidth="1"
                        opacity="0.28"
                      />
                      {selectedDomain === focus.id ? (
                        <circle
                          cx={PLATE_X}
                          cy={PLATE_Y}
                          r={FOCUS_R + 13}
                          fill="none"
                          stroke={focusColor}
                          strokeWidth="1.4"
                        />
                      ) : null}
                      {focusedId === focus.id ? (
                        <circle
                          cx={PLATE_X}
                          cy={PLATE_Y}
                          r={FOCUS_R + 13}
                          fill="none"
                          stroke="var(--ring)"
                          strokeWidth="2"
                        />
                      ) : null}
                      <text
                        x={PLATE_X}
                        y={PLATE_Y + FOCUS_R + 18}
                        textAnchor="middle"
                        fill="var(--foreground)"
                        style={{
                          direction: rtl ? "rtl" : "ltr",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {focusLines[0]}
                        {focusLines.slice(1).map((line, lineIndex) => (
                          <tspan key={lineIndex} x={PLATE_X} dy={13}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                      <text
                        x={PLATE_X}
                        y={PLATE_Y + FOCUS_R + 18 + (focusLines.length - 1) * 13 + 14}
                        textAnchor="middle"
                        fill="var(--muted-foreground)"
                        style={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}
                      >
                        {fmt.pct(focus.share)}
                      </text>
                    </g>
                  </g>
                ) : (
                  <g aria-hidden="true" style={mountStyle(PLATE_X, PLATE_Y, 120)}>
                    <circle
                      cx={PLATE_X}
                      cy={PLATE_Y}
                      r={FOCUS_R}
                      fill="none"
                      stroke="var(--border)"
                    />
                    <circle
                      cx={PLATE_X}
                      cy={PLATE_Y}
                      r={FOCUS_R + 11}
                      fill="none"
                      stroke="var(--border)"
                      strokeDasharray="1 6"
                    />
                    <circle cx={PLATE_X} cy={PLATE_Y} r={3.5} fill="var(--faint)" />
                  </g>
                )}
              </g>
            </svg>
          </div>
          {trail.length ? (
            <p className="mt-2 text-center text-[11px] tabular-nums text-faint">
              {t("mapTrail", { n: fmt.num(trail.length) })}
            </p>
          ) : null}
          {focus ? null : (
            <p className="mx-auto mt-1 max-w-md text-center text-[12.5px] leading-relaxed text-muted-foreground">
              {t("landscapeNoTopic")}
            </p>
          )}
        </div>
        {focus ? <PracticeReadout profile={profile} locale={locale} fmt={fmt} t={t} /> : null}
      </div>
      {focus ? (
        <p className="mt-4 max-w-2xl text-[11.5px] leading-relaxed text-faint">
          {t("mapLegend")}
          {profile.domains.length > MAX_SATELLITES + 1 ? (
            <span className="ms-2">
              {t("mapMore", { n: fmt.num(profile.domains.length - MAX_SATELLITES - 1) })}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** The picture restated as numbers: four hairlines, icon, label, large tabular value. */
function PracticeReadout({
  profile,
  locale,
  fmt,
  t,
}: {
  profile: PracticeProfile;
  locale: StatsLocale;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
}) {
  const share = profile.possibleDays > 0 ? profile.activeDays / profile.possibleDays : 0;
  const rows: {
    id: string;
    icon: LucideIcon;
    label: string;
    value: string;
    detail: string;
    long: boolean;
  }[] = [
    {
      id: "focus",
      icon: Compass,
      label: t("landscapeFocus"),
      value: profile.focus ? categoryLabel(locale, "domain", profile.focus.id) : "—",
      detail: profile.focus ? fmt.pct(profile.focus.share) : "—",
      long: true,
    },
    {
      id: "variety",
      icon: Shapes,
      label: t("landscapeVariety"),
      value: fmt.num(profile.activeDomains),
      detail: t("domainsTitle"),
      long: false,
    },
    {
      id: "rhythm",
      icon: CalendarDays,
      label: t("landscapeRhythm"),
      value: fmt.num(profile.activeDays) + " / " + fmt.num(profile.possibleDays),
      detail: fmt.pct(share),
      long: false,
    },
    {
      id: "return",
      icon: Repeat2,
      label: t("landscapeReturn"),
      value: fmt.num(profile.revisitedPhrases),
      detail: profile.repeatUses ? t("mapRepeatUses", { n: fmt.num(profile.repeatUses) }) : "—",
      long: false,
    },
  ];
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-1 lg:gap-0 lg:border-s lg:border-border lg:ps-6">
      {rows.map(({ id, icon: Icon, label, value, detail, long }) => (
        <div
          key={id}
          className="flex min-w-0 flex-col gap-1 border-t border-border pt-3 lg:flex-row lg:items-baseline lg:justify-between lg:gap-5 lg:py-3.5"
        >
          <dt className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Icon className="size-3.5 shrink-0" strokeWidth={1.7} />
            <span className="truncate">{label}</span>
          </dt>
          <dd className="m-0 flex min-w-0 flex-col lg:items-end">
            <span
              className={
                long
                  ? "text-[16.5px] font-semibold leading-snug"
                  : "text-[25px] font-semibold leading-none tabular-nums"
              }
            >
              {value}
            </span>
            <span className="mt-0.5 text-[11px] tabular-nums text-faint">{detail}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PartIcon({ part, className }: { part: PartOfDay; className?: string }) {
  const Icon =
    part === "night" ? Moon : part === "morning" ? Sunrise : part === "afternoon" ? Sun : Sunset;
  return <Icon className={className} strokeWidth={1.6} />;
}

function partLabel(t: ReturnType<typeof statsT>, part: PartOfDay): string {
  return t(
    part === "night"
      ? "partNight"
      : part === "morning"
        ? "partMorning"
        : part === "afternoon"
          ? "partAfternoon"
          : "partEvening",
  );
}

/* ------------------------------------------------------------------- rhythm */

/**
 * 24 hour marks around a clock. Height is frequency, colour is the part of the day, and
 * the busiest hour is written in the middle. Hours are real buttons when a detail view is
 * available, so the graph is not a picture you can only look at.
 */
const RhythmDial = memo(function RhythmDial({
  data,
  fmt,
  t,
  selectedHour,
  onPickHour,
}: {
  data: Rhythm;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  selectedHour?: number | null | undefined;
  onPickHour?: ((hour: number) => void) | undefined;
}) {
  const max = Math.max(1, ...data.hours);
  const peak = data.peakHour;
  const center = 84;
  const inner = 33;
  const label = t("rhythmLabel", {
    hour: peak === null ? "—" : fmt.hour(peak),
    n: fmt.num(peak === null ? 0 : (data.hours[peak] ?? 0)),
  });
  return (
    <div className="relative mx-auto w-full max-w-[188px]">
      <svg viewBox="0 0 168 168" className="size-full" role="group" aria-label={label}>
        <circle
          cx={center}
          cy={center}
          r={63}
          fill="none"
          stroke="var(--border)"
          strokeWidth="1"
          strokeDasharray="2 5"
        />
        {data.hours.map((count, hour) => {
          const angle = ((hour * 15 - 90) * Math.PI) / 180;
          const len = count ? 11 + (count / max) * 38 : 7;
          const x1 = center + Math.cos(angle) * inner;
          const y1 = center + Math.sin(angle) * inner;
          const x2 = center + Math.cos(angle) * (inner + len);
          const y2 = center + Math.sin(angle) * (inner + len);
          const active = selectedHour === hour;
          const interactive = !!onPickHour && count > 0;
          const color = active ? "var(--signal)" : PART_COLOR[partOfDay(hour)];
          return (
            <g
              key={hour}
              className="stats-rhythm-hit"
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : -1}
              aria-label={`${fmt.hour(hour)}: ${fmt.num(count)}`}
              aria-pressed={interactive ? active : undefined}
              style={{ cursor: interactive ? "pointer" : "default" }}
              onClick={interactive ? () => onPickHour?.(hour) : undefined}
              onKeyDown={
                interactive
                  ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onPickHour?.(hour);
                    }
                  : undefined
              }
            >
              <line
                data-hit
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth="14"
                strokeLinecap="round"
              />
              <line
                className="stats-rhythm-bar"
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={active ? 5 : 3.2}
                strokeLinecap="round"
                opacity={count ? 0.45 + 0.55 * (count / max) : 0.22}
              />
            </g>
          );
        })}
        <text
          x={center}
          y={80}
          textAnchor="middle"
          fill="var(--foreground)"
          style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
        >
          {peak === null ? "—" : fmt.hour(peak)}
        </text>
        <text
          x={center}
          y={96}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          style={{ fontSize: 8.5 }}
        >
          {t("peakHour")}
        </text>
      </svg>
    </div>
  );
});

function PartDayBar({ data, fmt, t }: { data: Rhythm; fmt: Fmt; t: ReturnType<typeof statsT> }) {
  const total = Math.max(1, data.total);
  return (
    <div>
      <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-full" aria-hidden="true">
        {PARTS_OF_DAY.map((part) => (
          <span
            key={part}
            className="h-full motion-safe:transition-[flex-grow] motion-safe:duration-500"
            style={{
              flexGrow: data.parts[part],
              flexBasis: 0,
              background: PART_COLOR[part],
              opacity: data.parts[part] ? 0.85 : 0.2,
            }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {PARTS_OF_DAY.map((part) => (
          <div key={part} className="flex min-w-0 items-center gap-2">
            <PartIcon part={part} className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
              {partLabel(t, part)}
            </span>
            <span className="text-[12px] tabular-nums text-foreground">
              {fmt.num(data.parts[part])}
            </span>
            <span className="w-8 text-end text-[11px] tabular-nums text-faint">
              {fmt.pct(data.parts[part] / total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekdayStrip({ data, fmt, t }: { data: Rhythm; fmt: Fmt; t: ReturnType<typeof statsT> }) {
  const max = Math.max(1, ...data.weekdays);
  const summary = data.weekdays
    .map((count, i) => `${fmt.weekdayOf(i)} ${fmt.num(count)}`)
    .join(", ");
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-muted-foreground">{t("weekdayTitle")}</span>
        <span className="text-[11px] tabular-nums text-faint">
          {data.peakWeekday === null ? "—" : fmt.num(data.weekdays[data.peakWeekday] ?? 0)}
        </span>
      </div>
      <div role="img" aria-label={summary} className="flex h-14 items-end gap-1.5" dir="ltr">
        {data.weekdays.map((count, i) => {
          const peak = data.peakWeekday === i && count > 0;
          return (
            <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span
                className={`w-full max-w-6 rounded-t-[3px] ${
                  peak ? "bg-signal" : count ? "bg-muted-foreground/45" : "bg-border"
                }`}
                style={{ height: count ? Math.max(4, (count / max) * 40) : 2 }}
              />
              <span className={`truncate text-[10px] ${peak ? "text-foreground" : "text-faint"}`}>
                {fmt.weekdayOf(i)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RhythmBlock({
  data,
  streak,
  fmt,
  t,
  selectedHour,
  onPickHour,
}: {
  data: Rhythm;
  streak: Streaks;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  selectedHour?: number | null | undefined;
  onPickHour?: ((hour: number) => void) | undefined;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-[190px_1fr] sm:items-center">
      <RhythmDial data={data} fmt={fmt} t={t} selectedHour={selectedHour} onPickHour={onPickHour} />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Flame className="size-3.5" strokeWidth={1.7} />
              <span className="text-[11.5px]">{t("streakCurrent")}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-[24px] font-semibold leading-none tabular-nums">
                {fmt.num(streak.current)}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                {t("daysN", { n: fmt.num(streak.current) })}
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Trophy className="size-3.5" strokeWidth={1.7} />
              <span className="text-[11.5px]">{t("streakBest")}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-[24px] font-semibold leading-none tabular-nums">
                {fmt.num(streak.longest)}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                {t("daysN", { n: fmt.num(streak.longest) })}
              </span>
            </div>
          </div>
        </div>
        <PartDayBar data={data} fmt={fmt} t={t} />
        <WeekdayStrip data={data} fmt={fmt} t={t} />
      </div>
      <p className="text-[11.5px] leading-relaxed text-faint sm:col-span-2">{t("streakHint")}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ records */

export function RecordsBlock({
  records,
  fmt,
  t,
  onOpenDay,
  onOpenRecord,
}: {
  records: Highlights;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  onOpenDay: (day: string) => void;
  onOpenRecord: (id: string) => void;
}) {
  const best = records.bestDay;
  const hour = records.busiestHour;
  const longest = records.longest;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <button
        type="button"
        disabled={!best}
        onClick={() => best && onOpenDay(best.day)}
        className="press-soft flex min-w-0 flex-col rounded-lg border border-border bg-surface p-3 text-start disabled:opacity-60"
        aria-label={best ? `${t("recordBestDay")}: ${fmt.dayLong(best.day)}` : t("recordBestDay")}
      >
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <CalendarDays className="size-3.5" strokeWidth={1.7} />
          <span className="text-[11.5px]">{t("recordBestDay")}</span>
        </span>
        <span className="mt-2 text-[16px] font-semibold leading-tight">
          {best ? fmt.day(best.day) : "—"}
        </span>
        <span className="mt-1 text-[11.5px] text-muted-foreground">
          {best ? t("count", { n: fmt.num(best.count) }) : t("noActivity")}
        </span>
      </button>

      <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface p-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="size-3.5" strokeWidth={1.7} />
          <span className="text-[11.5px]">{t("recordBusiestHour")}</span>
        </span>
        <span className="mt-2 text-[16px] font-semibold leading-tight tabular-nums">
          {hour ? fmt.hour(hour.hour) : "—"}
        </span>
        <span className="mt-1 text-[11.5px] text-muted-foreground">
          {hour ? t("count", { n: fmt.num(hour.count) }) : t("noActivity")}
        </span>
      </div>

      <button
        type="button"
        disabled={!longest}
        onClick={() => longest && onOpenRecord(longest.id)}
        className="press-soft flex min-w-0 flex-col rounded-lg border border-border bg-surface p-3 text-start disabled:opacity-60"
        aria-label={
          longest
            ? `${t("recordLongest")}: ${t("wordsN", { n: fmt.num(longest.words) })}`
            : t("recordLongest")
        }
      >
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <FileText className="size-3.5" strokeWidth={1.7} />
          <span className="text-[11.5px]">{t("recordLongest")}</span>
        </span>
        <span className="mt-2 text-[16px] font-semibold leading-tight tabular-nums">
          {longest ? t("wordsN", { n: fmt.num(longest.words) }) : "—"}
        </span>
        <span
          dir="auto"
          className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground"
        >
          {longest ? longest.original : t("noActivity")}
        </span>
      </button>

      <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface p-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Sparkles className="size-3.5" strokeWidth={1.7} />
          <span className="text-[11.5px]">{t("recordFirst")}</span>
        </span>
        <span className="mt-2 text-[16px] font-semibold leading-tight">
          {records.first ? fmt.day(records.first.day) : "—"}
        </span>
        <span className="mt-1 text-[11.5px] text-muted-foreground">
          {records.first ? fmt.pair(records.first.pair) : t("noActivity")}
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- milestones */

function milestoneLabel(m: Milestone, fmt: Fmt, t: ReturnType<typeof statsT>): string {
  if (m.id === "first") return t("milestoneFirst");
  switch (m.metric) {
    case "translations":
      return t("ms_translations", { n: fmt.num(m.target) });
    case "words":
      return t("ms_words", { n: fmt.num(m.target) });
    case "pairs":
      return t("ms_pairs", { n: fmt.num(m.target) });
    case "streak":
      return t("ms_streak", { n: fmt.num(m.target) });
    case "days":
      return t("ms_days", { n: fmt.num(m.target) });
  }
}

export function MilestonesBlock({
  all,
  fmt,
  t,
}: {
  all: Milestone[];
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
}) {
  const achieved = all.filter((m) => m.achieved).length;
  const next = nextMilestones(all, 3);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-muted-foreground">
          {t("milestonesDone", { done: fmt.num(achieved), total: fmt.num(all.length) })}
        </span>
        <span className="text-[11.5px] text-faint">{t("milestonesNote")}</span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={t("milestonesDone", { done: fmt.num(achieved), total: fmt.num(all.length) })}
      >
        <span
          className="block h-full rounded-full bg-signal motion-safe:transition-[width] motion-safe:duration-500"
          style={{ width: `${all.length ? (achieved / all.length) * 100 : 0}%` }}
        />
      </div>
      {next.length ? (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
            {t("milestonesNext")}
          </p>
          <ul className="flex flex-col gap-3">
            {next.map((m) => {
              const pct = Math.min(100, (m.value / m.target) * 100);
              return (
                <li key={m.id} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13.5px] text-foreground">
                      {milestoneLabel(m, fmt, t)}
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                      {fmt.num(m.value)} / {fmt.num(m.target)} ·{" "}
                      {t("ms_left", { n: fmt.num(m.target - m.value) })}
                    </span>
                  </div>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-border">
                    <span
                      className="block h-full rounded-full bg-signal/70 motion-safe:transition-[width] motion-safe:duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Check className="size-4 text-signal-text" strokeWidth={2} />
          {t("milestonesAll")}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- language flow */

interface Placed extends FlowNode {
  x: number;
  y: number;
  height: number;
}

function place(nodes: FlowNode[], x: number, top: number, bottom: number): Placed[] {
  const gap = 9;
  const total = nodes.reduce((n, node) => n + node.count, 0) || 1;
  const room = bottom - top - gap * Math.max(0, nodes.length - 1);
  let y = top;
  return nodes.map((node) => {
    const height = Math.max(7, (node.count / total) * room);
    const placed = { ...node, x, y, height };
    y += height + gap;
    return placed;
  });
}

function ribbon(x1: number, y1: number, x2: number, y2: number, width: number): string {
  const dx = (x2 - x1) * 0.48;
  const top = y1 - width / 2;
  const bottom = y1 + width / 2;
  const endTop = y2 - width / 2;
  const endBottom = y2 + width / 2;
  return [
    `M ${x1} ${top}`,
    `C ${x1 + dx} ${top}, ${x2 - dx} ${endTop}, ${x2} ${endTop}`,
    `L ${x2} ${endBottom}`,
    `C ${x2 - dx} ${endBottom}, ${x1 + dx} ${bottom}, ${x1} ${bottom}`,
    "Z",
  ].join(" ");
}

/**
 * Source languages → target languages, one ribbon per real direction. Width is frequency,
 * colour is the direction's stable colour, and every ribbon is a button that opens that
 * direction's translations. In RTL the source moves to the right and the reading edge
 * follows the interface; the data never changes direction.
 */
export const LanguageFlowMap = memo(function LanguageFlowMap({
  flow,
  selected,
  onSelect,
  fmt,
  t,
  rtl,
}: {
  flow: LanguageFlow;
  selected: string | null;
  onSelect: (pair: string) => void;
  fmt: Fmt;
  t: ReturnType<typeof statsT>;
  rtl: boolean;
}) {
  const sourceX = rtl ? 252 : 88;
  const targetX = rtl ? 88 : 252;
  const top = 30;
  const bottom = 176;
  const sources = place(flow.sources, sourceX, top, bottom);
  const targets = place(flow.targets, targetX, top, bottom);
  if (!sources.length || !targets.length) return null;
  const sourceBy = new Map(sources.map((n) => [n.code, n]));
  const targetBy = new Map(targets.map((n) => [n.code, n]));
  const sourceCursor = new Map<string, number>();
  const targetCursor = new Map<string, number>();
  const drawn = [...flow.links]
    .sort((a, b) => a.count - b.count)
    .flatMap((link) => {
      const from = sourceBy.get(link.from);
      const to = targetBy.get(link.to);
      if (!from || !to) return [];
      const sy = sourceCursor.get(link.from) ?? from.y;
      const ty = targetCursor.get(link.to) ?? to.y;
      const sh = Math.max(1.5, (link.count / from.count) * from.height);
      const th = Math.max(1.5, (link.count / to.count) * to.height);
      sourceCursor.set(link.from, sy + sh);
      targetCursor.set(link.to, ty + th);
      const width = Math.min(12, Math.max(2, Math.min(sh, th) * 0.82));
      return [
        {
          ...link,
          path: ribbon(from.x, sy + sh / 2, to.x, ty + th / 2, width),
          width,
          color: pairColor(link.pair),
        },
      ];
    });
  const summary = t("flowSummary", { total: fmt.num(flow.shown) });
  return (
    <div>
      <svg
        viewBox="0 0 340 200"
        className="w-full"
        role="group"
        aria-label={summary}
        style={{ direction: rtl ? "rtl" : "ltr" }}
      >
        <text
          x={rtl ? sourceX + 8 : sourceX - 8}
          y={14}
          textAnchor={rtl ? "start" : "end"}
          fill="var(--faint)"
          style={{ fontSize: 9.5 }}
        >
          {t("flowFrom")}
        </text>
        <text
          x={rtl ? targetX - 8 : targetX + 8}
          y={14}
          textAnchor={rtl ? "end" : "start"}
          fill="var(--faint)"
          style={{ fontSize: 9.5 }}
        >
          {t("flowTo")}
        </text>
        {drawn.map((link) => {
          const dim = selected ? selected !== link.pair : false;
          return (
            <path
              key={`ribbon-${link.pair}`}
              d={link.path}
              fill={link.color}
              opacity={selected === link.pair ? 0.8 : dim ? 0.1 : 0.3}
              className="stats-flow-link pointer-events-none"
            />
          );
        })}
        {drawn.map((link) => (
          <path
            key={`hit-${link.pair}`}
            data-hit
            d={link.path}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(16, link.width + 10)}
            className="stats-flow-hit cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={`${fmt.pair(link.pair)}: ${fmt.num(link.count)}`}
            aria-pressed={selected === link.pair}
            onClick={() => onSelect(link.pair)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onSelect(link.pair);
            }}
          />
        ))}
        {sources.map((node) => (
          <g key={`s-${node.code}`} pointerEvents="none">
            <rect
              x={node.x - 3}
              y={node.y}
              width="6"
              height={node.height}
              rx="2.5"
              fill="var(--muted-foreground)"
              opacity="0.55"
            />
            <text
              x={rtl ? node.x + 10 : node.x - 10}
              y={node.y + node.height / 2}
              dy=".34em"
              textAnchor={rtl ? "start" : "end"}
              fill="var(--foreground)"
              style={{ fontSize: 10 }}
            >
              {fmt.langName(node.code)}
            </text>
          </g>
        ))}
        {targets.map((node) => (
          <g key={`t-${node.code}`} pointerEvents="none">
            <rect
              x={node.x - 3}
              y={node.y}
              width="6"
              height={node.height}
              rx="2.5"
              fill="var(--muted-foreground)"
              opacity="0.55"
            />
            <text
              x={rtl ? node.x - 10 : node.x + 10}
              y={node.y + node.height / 2}
              dy=".34em"
              textAnchor={rtl ? "end" : "start"}
              fill="var(--foreground)"
              style={{ fontSize: 10 }}
            >
              {fmt.langName(node.code)}
            </text>
          </g>
        ))}
      </svg>
      {flow.omitted > 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
          {t("flowOmitted", {
            n: fmt.num(flow.omitted),
            count: fmt.num(flow.omittedCount),
          })}
        </p>
      ) : null}
    </div>
  );
});
