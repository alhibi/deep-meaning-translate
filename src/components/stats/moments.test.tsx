import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { distribution, summarize, toRecords } from "@/lib/stats/engine";
import {
  highlights,
  languageFlow,
  milestones,
  practiceProfile,
  practiceTrail,
  rhythm,
  streaks,
} from "@/lib/stats/moments";
import { categoryLabel, statsT } from "@/lib/stats/labels";
import {
  LanguageFlowMap,
  MilestonesBlock,
  PracticeLandscape,
  RecordsBlock,
  RhythmBlock,
} from "./moments";
import { makeFormat } from "./format";

const entries = [
  {
    id: "a",
    source: "de",
    target: "ar",
    original: "Guten Morgen",
    translated: "صباح الخير",
    createdAt: Date.parse("2026-11-10T09:15:00Z"),
  },
  {
    id: "b",
    source: "ar",
    target: "de",
    original: "كيف حالك اليوم",
    translated: "Wie geht es dir heute",
    createdAt: Date.parse("2026-11-11T14:30:00Z"),
  },
  {
    id: "c",
    source: "de",
    target: "ar",
    original: "Ich habe einen Termin am Montag",
    translated: "لدي موعد يوم الاثنين",
    createdAt: Date.parse("2026-11-12T14:45:00Z"),
  },
  {
    id: "d",
    source: "en",
    target: "de",
    original: "This is a longer thought that must win the longest-text record",
    translated: "Das ist ein längerer Gedanke",
    createdAt: Date.parse("2026-10-01T03:00:00Z"),
    uses: 2,
  },
  {
    id: "e",
    source: "ar",
    target: "de",
    original: "شكراً جزيلاً",
    translated: "Vielen Dank",
    createdAt: Date.parse("2026-11-12T16:10:00Z"),
  },
];

const records = toRecords(entries, "UTC");
const fmt = makeFormat("en");
const t = statsT("en");
const summary = summarize(records);
const streak = streaks(records, "2026-11-12");
const data = rhythm(records, "UTC");
const all = milestones({
  translations: summary.translations,
  words: summary.words,
  pairs: summary.pairs,
  activeDays: summary.activeDays,
  longestStreak: streak.longest,
});
const flow = languageFlow(distribution(records, "pair"), 6);
const done = all.filter((m) => m.achieved).length;

describe("statistics blocks use the archive they are given", () => {
  it("opens the exact real hour from the rhythm dial", () => {
    const onPickHour = vi.fn();
    render(
      <RhythmBlock
        data={data}
        streak={streak}
        fmt={fmt}
        t={t}
        selectedHour={null}
        onPickHour={onPickHour}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: `${fmt.hour(14)}: 2` }));
    expect(onPickHour).toHaveBeenCalledExactlyOnceWith(14);
    expect(screen.getByText(t("peakHour"))).toBeTruthy();
  });

  it("opens the busiest day and the longest translation from the record cards", () => {
    const onOpenDay = vi.fn();
    const onOpenRecord = vi.fn();
    const h = highlights(records, "UTC");
    render(
      <RecordsBlock
        records={h}
        fmt={fmt}
        t={t}
        onOpenDay={onOpenDay}
        onOpenRecord={onOpenRecord}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("recordBestDay")}: ${fmt.dayLong("2026-11-12")}`,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("recordLongest")}: ${t("wordsN", { n: fmt.num(h.longest?.words ?? 0) })}`,
      }),
    );
    expect(onOpenDay).toHaveBeenCalledExactlyOnceWith("2026-11-12");
    expect(onOpenRecord).toHaveBeenCalledExactlyOnceWith("d");
  });

  it("renders milestone progress and every real direction as a button", () => {
    render(<MilestonesBlock all={all} fmt={fmt} t={t} />);
    expect(
      screen.getByText(t("milestonesDone", { done: fmt.num(done), total: fmt.num(all.length) })),
    ).toBeTruthy();

    const onSelect = vi.fn();
    render(
      <LanguageFlowMap
        flow={flow}
        selected={null}
        onSelect={onSelect}
        fmt={fmt}
        t={t}
        rtl={false}
      />,
    );
    const first = flow.links[0]!;
    fireEvent.click(
      screen.getByRole("button", { name: `${fmt.pair(first.pair)}: ${fmt.num(first.count)}` }),
    );
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(first.pair);
  });

  it("renders the practice map as a factual, actionable plate", () => {
    const bounds = { from: "2026-10-01", to: "2026-11-12", days: 43 };
    const profile = practiceProfile(records, bounds);
    const trail = practiceTrail(records, bounds);
    const focus = profile.focus!;
    const focusLabel = categoryLabel("en", "domain", focus.id);
    const focusName = t("mapNode", {
      label: focusLabel,
      count: focus.count === 1 ? t("countOne") : t("count", { n: fmt.num(focus.count) }),
      pct: fmt.pct(focus.share),
    });
    const onOpenDomain = vi.fn();
    render(
      <PracticeLandscape
        profile={profile}
        trail={trail}
        fmt={fmt}
        t={t}
        locale="en"
        onOpenDomain={onOpenDomain}
      />,
    );

    // One mark per day of the 42-day trail window, and a summary a screen reader can read.
    expect(trail).toHaveLength(42);
    expect(screen.getAllByTestId("trail-day")).toHaveLength(trail.length);
    expect(
      screen.getByRole("group", {
        name: t("mapSummary", {
          focus: focusLabel,
          share: fmt.pct(focus.share),
          domains: fmt.num(profile.activeDomains),
          active: fmt.num(profile.activeDays),
          possible: fmt.num(profile.possibleDays),
        }),
      }),
    ).toBeTruthy();

    // The readout restates the same measures as real text, not just as a picture.
    expect(screen.getByText(t("landscapeFocus"))).toBeTruthy();
    expect(screen.getByText(t("landscapeVariety"))).toBeTruthy();
    expect(screen.getByText(t("landscapeRhythm"))).toBeTruthy();
    expect(screen.getByText(t("landscapeReturn"))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: focusName }));
    expect(onOpenDomain).toHaveBeenCalledExactlyOnceWith(focus.id);
  });

  it("opens a satellite topic and marks the selected domain as pressed", () => {
    const bounds = { from: "2026-10-01", to: "2026-11-12", days: 43 };
    const profile = practiceProfile(records, bounds);
    const trail = practiceTrail(records, bounds);
    const satellite = profile.domains[1]!;
    const satelliteName = t("mapNode", {
      label: categoryLabel("en", "domain", satellite.id),
      count: satellite.count === 1 ? t("countOne") : t("count", { n: fmt.num(satellite.count) }),
      pct: fmt.pct(satellite.share),
    });
    const onOpenDomain = vi.fn();
    render(
      <PracticeLandscape
        profile={profile}
        trail={trail}
        selectedDomain={satellite.id}
        fmt={fmt}
        t={t}
        locale="en"
        onOpenDomain={onOpenDomain}
      />,
    );

    const node = screen.getByRole("button", { name: satelliteName });
    expect(node.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("map-focus").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(node);
    fireEvent.keyDown(node, { key: "Enter" });
    expect(onOpenDomain).toHaveBeenCalledTimes(2);
    expect(onOpenDomain).toHaveBeenNthCalledWith(1, satellite.id);
    expect(onOpenDomain).toHaveBeenNthCalledWith(2, satellite.id);
  });

  it("keeps a composed plate and a calm sentence when no topic is classified", () => {
    const empty = {
      domains: [],
      focus: null,
      activeDomains: 0,
      activeDays: 3,
      possibleDays: 30,
      revisitedPhrases: 2,
      repeatUses: 4,
    };
    render(
      <PracticeLandscape
        profile={empty}
        trail={[1, 0, 2, 0]}
        fmt={fmt}
        t={t}
        locale="en"
        onOpenDomain={() => {}}
      />,
    );
    expect(screen.getByText(t("landscapeNoTopic"))).toBeTruthy();
    expect(screen.getAllByTestId("trail-day")).toHaveLength(4);
    expect(screen.queryAllByTestId("map-topic")).toHaveLength(0);
    expect(screen.queryByTestId("map-focus")).toBeNull();
    expect(screen.queryByText(t("landscapeFocus"))).toBeNull();
  });

  it("renders the same map with reduced motion without crashing", () => {
    const bounds = { from: "2026-10-01", to: "2026-11-12", days: 43 };
    const profile = practiceProfile(records, bounds);
    const trail = practiceTrail(records, bounds);
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      render(
        <PracticeLandscape
          profile={profile}
          trail={trail}
          fmt={fmt}
          t={t}
          locale="en"
          onOpenDomain={() => {}}
        />,
      );
      expect(screen.getAllByTestId("trail-day")).toHaveLength(trail.length);
      expect(screen.getByTestId("map-focus")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
