import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { distribution, summarize, toRecords } from "@/lib/stats/engine";
import {
  highlights,
  languageFlow,
  milestones,
  practiceProfile,
  rhythm,
  streaks,
} from "@/lib/stats/moments";
import { statsT } from "@/lib/stats/labels";
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

  it("renders the topic landscape as an actionable, factual map", () => {
    const onOpenDomain = vi.fn();
    const profile = practiceProfile(records, { from: "2026-10-01", to: "2026-11-12", days: 43 });
    render(
      <PracticeLandscape
        profile={profile}
        fmt={fmt}
        t={t}
        locale="en"
        onOpenDomain={onOpenDomain}
      />,
    );
    expect(screen.getByText(t("landscapeFocus"))).toBeTruthy();
    const focus = profile.focus!;
    fireEvent.click(
      screen.getByRole("button", {
        name: `Daily life in Germany: ${fmt.num(focus.count)}`,
      }),
    );
    expect(onOpenDomain).toHaveBeenCalledExactlyOnceWith(focus.id);
  });
});
