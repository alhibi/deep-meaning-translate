import { describe, expect, it } from "vitest";
import { distribution, summarize, toRecords, type Slice } from "./engine";
import {
  highlights,
  languageFlow,
  milestones,
  nextMilestones,
  practiceProfile,
  practiceTrail,
  rhythm,
  streaks,
} from "./moments";

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

describe("rhythm", () => {
  it("buckets real hours and weeks without inventing activity", () => {
    const r = rhythm(records, "UTC");
    expect(r.total).toBe(5);
    expect(r.hours[9]).toBe(1);
    expect(r.hours[14]).toBe(2);
    expect(r.hours[16]).toBe(1);
    expect(r.hours[3]).toBe(1);
    expect(r.hours[0]).toBe(0);
    // 2026-11-12 is a Thursday (index 3, Monday first); 2026-10-01 is also a Thursday.
    expect(r.weekdays[3]).toBe(3);
    expect(r.weekdays[1]).toBe(1);
    expect(r.peakHour).toBe(14);
    expect(r.peakWeekday).toBe(3);
    expect(r.parts).toEqual({ night: 1, morning: 1, afternoon: 3, evening: 0 });
  });

  it("returns null peaks only when there is nothing to count", () => {
    const r = rhythm([], "UTC");
    expect(r.peakHour).toBeNull();
    expect(r.peakWeekday).toBeNull();
    expect(r.total).toBe(0);
  });
});

describe("streaks", () => {
  it("keeps a run alive through today or yesterday and measures the longest run", () => {
    expect(streaks(records, "2026-11-12")).toMatchObject({
      current: 3,
      longest: 3,
      lastActive: "2026-11-12",
      totalDays: 4,
    });
    // No translation today yet: yesterday's run is still this person's streak.
    expect(streaks(records, "2026-11-13")).toMatchObject({ current: 3, longest: 3 });
    // A full missed day ends it; the best run is still true history.
    expect(streaks(records, "2026-11-15")).toMatchObject({ current: 0, longest: 3 });
  });
});

describe("records", () => {
  it("finds the busiest day, busiest hour, longest text and first translation", () => {
    const h = highlights(records, "UTC");
    expect(h.bestDay).toEqual({ day: "2026-11-12", count: 2 });
    expect(h.busiestHour).toEqual({ hour: 14, count: 2 });
    expect(h.longest?.id).toBe("d");
    expect(h.first?.id).toBe("d");
  });
});

describe("milestones", () => {
  const summary = summarize(records);
  const streak = streaks(records, "2026-11-12");
  const all = milestones({
    translations: summary.translations,
    words: summary.words,
    pairs: summary.pairs,
    activeDays: summary.activeDays,
    longestStreak: streak.longest,
  });

  it("marks achieved goals from real values and keeps every goal deterministic", () => {
    expect(all).toHaveLength(17);
    const achieved = new Set(all.filter((m) => m.achieved).map((m) => m.id));
    expect(achieved).toContain("first");
    expect(achieved).toContain("p2");
    expect(achieved).toContain("s3");
    expect(achieved).not.toContain("t10");
  });

  it("offers the closest unfinished goals first", () => {
    const next = nextMilestones(all, 3);
    expect(next).toHaveLength(3);
    expect(next.every((m) => !m.achieved)).toBe(true);
    // Three directions of five is the furthest any unfinished goal has come.
    expect(next[0]?.id).toBe("p5");
    expect(next[0]?.value).toBe(3);
  });
});

describe("language flow", () => {
  const slices: Slice[] = [
    { id: "de>ar", count: 3, words: 20, share: 0.5 },
    { id: "ar>de", count: 2, words: 8, share: 0.33 },
    { id: "auto>de", count: 1, words: 2, share: 0.17 },
  ];

  it("draws only real directions and reports what it left out", () => {
    const flow = languageFlow(slices, 2);
    expect(flow.links.map((l) => l.pair)).toEqual(["de>ar", "ar>de"]);
    expect(flow.shown).toBe(5);
    expect(flow.omitted).toBe(1);
    expect(flow.omittedCount).toBe(1);
    expect(flow.total).toBe(6);
    expect(flow.links[0]?.share).toBeCloseTo(0.6);
    expect(flow.sources).toEqual([
      { code: "de", count: 3 },
      { code: "ar", count: 2 },
    ]);
    expect(flow.targets).toEqual([
      { code: "ar", count: 3 },
      { code: "de", count: 2 },
    ]);
  });

  it("stays consistent with the pair distribution it is fed", () => {
    const flow = languageFlow(distribution(records, "pair"), 6);
    expect(flow.total).toBe(records.length);
    expect(flow.links.length).toBeGreaterThan(0);
  });
});

describe("practice trail", () => {
  const bounds = { from: "2026-11-09", to: "2026-11-13", days: 5 };

  it("counts one mark per calendar day, oldest first, with gaps kept as zero", () => {
    expect(practiceTrail(records, bounds)).toEqual([0, 1, 1, 2, 0]);
  });

  it("clips to the newest days of the period and to the limit", () => {
    const long = { from: "2026-10-01", to: "2026-11-12", days: 43 };
    // The five newest days only: 10-01 is outside the window even though it is in range.
    expect(practiceTrail(records, long, 5)).toEqual([0, 0, 1, 1, 2]);
    // A limit longer than the period never invents days before it.
    expect(practiceTrail(records, bounds, 42)).toEqual([0, 1, 1, 2, 0]);
  });

  it("stays empty when there is no period or no limit", () => {
    expect(practiceTrail([], bounds)).toEqual([0, 0, 0, 0, 0]);
    expect(practiceTrail(records, null)).toEqual([]);
    expect(practiceTrail(records, bounds, 0)).toEqual([]);
  });

  it("buckets by the calendar day of each row, not by UTC", () => {
    // In UTC+14 the 11-11T14:30Z row is already 11-12; the 11-12 rows are 11-13.
    const shifted = toRecords(entries, "Pacific/Kiritimati");
    const trail = practiceTrail(shifted, { from: "2026-11-12", to: "2026-11-13", days: 2 });
    expect(trail).toEqual([1, 2]);
  });
});

describe("practice profile", () => {
  it("keeps every card accountable to real rows, calendar days and saved uses", () => {
    const profile = practiceProfile(records, { from: "2026-11-10", to: "2026-11-16", days: 7 });
    expect(profile.focus).toMatchObject({ id: "daily", count: 2 });
    expect(profile.activeDomains).toBe(2);
    expect(profile.activeDays).toBe(4);
    expect(profile.possibleDays).toBe(7);
    expect(profile.revisitedPhrases).toBe(1);
    expect(profile.repeatUses).toBe(1);
  });

  it("does not turn unclassified rows into a fictional topic", () => {
    const unknown = toRecords(
      [
        {
          id: "unknown",
          source: "de",
          target: "ar",
          original: "qwerty zxcv",
          translated: "x",
          createdAt: Date.parse("2026-11-10T09:00:00Z"),
        },
      ],
      "UTC",
    );
    const profile = practiceProfile(unknown, { from: "2026-11-10", to: "2026-11-10", days: 1 });
    expect(profile.domains).toEqual([]);
    expect(profile.focus).toBeNull();
  });
});
