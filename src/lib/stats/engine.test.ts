import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../history";
import {
  addDays,
  change,
  dayKey,
  distribution,
  granularityFor,
  insights,
  previousBounds,
  rangeBounds,
  select,
  sortRecords,
  summarize,
  timeline,
  toRecords,
  topWithOthers,
  weekKey,
} from "./engine";
import { countWords, localDomain, localIntent, localKind } from "./classify";
import { CATEGORY_DICT, STATS_DICT } from "./labels";
import { DIMENSION_VALUES } from "./taxonomy";
import { parseResult } from "../translation/parse";

const TZ = "Europe/Berlin";
/** Local Berlin wall-clock time → epoch ms (October 2026 is UTC+2 until the 25th). */
const at = (iso: string) => Date.parse(`${iso}+02:00`);
let n = 0;
const entry = (p: Partial<HistoryEntry> & { original: string; at: string }): HistoryEntry => ({
  id: `e${++n}`,
  source: "de",
  target: "ar",
  translated: "x",
  createdAt: at(p.at),
  v: 2,
  ...p,
});

describe("word counting rule", () => {
  it("counts words, not characters, the same way for Arabic, German and English", () => {
    expect(countWords("Guten Morgen, wie geht's?")).toBe(4);
    expect(countWords("صباح الخير، كيف حالك؟")).toBe(4);
    expect(countWords("Bitte die E-Mail prüfen 🙂 !!")).toBe(4);
    expect(countWords("وبالمدرسة")).toBe(1); // attached letters stay one word
    expect(countWords("   ")).toBe(0);
    expect(countWords("2026 حتى 10:30")).toBe(4);
  });
});

describe("text type is separate from topic and function", () => {
  it("classifies by structure", () => {
    expect(localKind("Termin")).toBe("word");
    expect(localKind("guten Appetit")).toBe("phrase");
    expect(localKind("Ich komme morgen.")).toBe("sentence");
    expect(localKind("Ich komme morgen. Bis dann!")).toBe("text");
  });
  it("finds topic and function independently", () => {
    // Same work topic, two different functions.
    expect(localDomain("Kannst du mir den Vertrag vom Chef schicken?")).toBe("work");
    expect(localIntent("Entschuldigung, ich bin heute zu spät zur Arbeit.")).toBe("apologize");
    expect(localIntent("Kannst du mir helfen?")).toBe("request");
    expect(localIntent("Wo ist der Bahnhof?")).toBe("ask");
    expect(localDomain("بدي موعد بالبلدية")).toBe("services");
    expect(localIntent("شكراً كتير")).toBe("thank");
    expect(localDomain("qwerty zxcv")).toBe("none");
  });
});

describe("records from the archive (old and new)", () => {
  it("never counts the same id twice and keeps legacy rows", () => {
    const old = { ...entry({ original: "Hallo", at: "2026-10-10T10:00:00" }), v: undefined };
    delete (old as Partial<HistoryEntry>).v;
    const recs = toRecords([old, old, entry({ original: "Danke", at: "2026-10-11T10:00:00" })], TZ);
    expect(recs).toHaveLength(2);
    expect(recs.find((r) => r.original === "Hallo")?.legacy).toBe(true);
  });
  it("drops rows without a translation (failed or empty)", () => {
    expect(toRecords([entry({ original: "Hallo", translated: "  ", at: "2026-10-10T10:00:00" })], TZ)).toHaveLength(0);
  });
  it("user correction beats model tag beats local estimate", () => {
    const [r] = toRecords(
      [entry({ original: "Termin beim Arzt", at: "2026-10-10T10:00:00", tags: { domain: "health" }, fix: { domain: "services" } })],
      TZ,
    );
    expect(r!.domain).toBe("services");
    expect(r!.origin.domain).toBe("user");
    const [m] = toRecords([entry({ original: "Termin beim Arzt", at: "2026-10-10T10:00:00", tags: { domain: "health" } })], TZ);
    expect(m!.origin.domain).toBe("model");
    const [l] = toRecords([entry({ original: "Termin beim Arzt", at: "2026-10-10T10:00:00" })], TZ);
    expect(l!.origin.domain).toBe("local");
  });
});

describe("dates and time zones", () => {
  it("buckets by the viewer's calendar day, not UTC", () => {
    // 23:30 UTC on Oct 10 is already Oct 11 in Berlin.
    expect(dayKey(Date.parse("2026-10-10T23:30:00Z"), TZ)).toBe("2026-10-11");
    expect(dayKey(Date.parse("2026-10-10T23:30:00Z"), "UTC")).toBe("2026-10-10");
  });
  it("handles month and DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekKey("2026-10-18")).toBe("2026-10-12"); // Sunday → Monday of that week
    // Berlin leaves summer time on 2026-10-25: a late-evening entry stays on its own day.
    expect(dayKey(Date.parse("2026-10-25T22:59:00Z"), TZ)).toBe("2026-10-25");
    expect(dayKey(Date.parse("2026-10-25T23:00:00Z"), TZ)).toBe("2026-10-26");
  });
  it("periods include today and the right number of days", () => {
    const b = rangeBounds("7d", "2026-10-19", [])!;
    expect(b).toEqual({ from: "2026-10-13", to: "2026-10-19", days: 7 });
    expect(previousBounds("7d", b)).toEqual({ from: "2026-10-06", to: "2026-10-12", days: 7 });
    expect(previousBounds("all", b)).toBeNull();
    expect(rangeBounds("custom", "2026-10-19", [], { from: "2026-10-15", to: "2026-10-01" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-15",
      days: 15,
    });
    expect(rangeBounds("all", "2026-10-19", [])).toBeNull();
  });
});

describe("hand-checked dataset", () => {
  // 6 translations, 3 directions, 4 active days.
  const data = toRecords(
    [
      entry({ original: "Guten Morgen", at: "2026-10-19T08:00:00", source: "de", target: "ar" }), // 2 words
      entry({ original: "Wie geht es dir?", at: "2026-10-19T09:00:00", source: "de", target: "ar" }), // 4
      entry({ original: "شكراً جزيلاً", at: "2026-10-18T10:00:00", source: "ar", target: "de" }), // 2
      entry({ original: "Ich brauche einen Termin beim Amt.", at: "2026-10-16T10:00:00", source: "de", target: "ar" }), // 6
      entry({ original: "hello", at: "2026-10-13T23:50:00", source: "en", target: "de" }), // 1
      entry({ original: "Alt", at: "2026-10-12T12:00:00", source: "de", target: "ar" }), // outside 7d
    ],
    TZ,
  );
  const today = "2026-10-19";
  const b = rangeBounds("7d", today, data)!;
  const visible = select(data, b, {});

  it("totals match manual counts", () => {
    const s = summarize(visible);
    expect(s.translations).toBe(5);
    expect(s.words).toBe(15);
    expect(s.pairs).toBe(3);
    expect(s.topPair).toEqual({ pair: "de>ar", count: 3 });
    expect(s.activeDays).toBe(4);
    expect(s.avgWords).toBe(3);
  });
  it("Arabic→German and German→Arabic are different pairs", () => {
    const d = distribution(visible, "pair");
    expect(d.find((x) => x.id === "de>ar")?.count).toBe(3);
    expect(d.find((x) => x.id === "ar>de")?.count).toBe(1);
    expect(d.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
  });
  it("filters narrow every number together", () => {
    const f = select(data, b, { pair: "de>ar" });
    expect(summarize(f).translations).toBe(3);
    expect(timeline(f, b).reduce((a, x) => a + x.translations, 0)).toBe(3);
    expect(distribution(f, "kind").reduce((a, x) => a + x.count, 0)).toBe(3);
    const both = select(data, b, { lang: "ar" });
    expect(both).toHaveLength(4); // either side
  });
  it("timeline is zero-filled and sums to the total", () => {
    const tl = timeline(visible, b);
    expect(tl).toHaveLength(7);
    expect(tl.find((x) => x.key === "2026-10-19")?.translations).toBe(2);
    expect(tl.find((x) => x.key === "2026-10-17")?.translations).toBe(0);
    expect(tl.reduce((a, x) => a + x.words, 0)).toBe(15);
  });
  it("comparison uses real previous data and refuses a zero base", () => {
    expect(change(5, 1)).toBe(4);
    expect(change(5, 0)).toBeNull();
    expect(change(5, null)).toBeNull();
    const prev = select(data, previousBounds("7d", b), {});
    expect(prev.map((r) => r.original)).toEqual(["Alt"]);
  });
  it("sorts by newest, oldest and use count", () => {
    expect(sortRecords(visible, "oldest")[0]!.original).toBe("hello");
    expect(sortRecords(visible, "newest")[0]!.original).toBe("Wie geht es dir?");
  });
});

describe("shares, others and empty sets", () => {
  it("handles a zero denominator", () => {
    expect(summarize([]).avgWords).toBeNull();
    expect(distribution([], "domain")).toEqual([]);
  });
  it("folds the tail into one 'others' slice with the right count", () => {
    const slices = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => ({ id, count: 7 - i, words: 0, share: 0 }));
    const { top, others } = topWithOthers(slices, 5);
    expect(top).toHaveLength(4);
    expect(others?.count).toBe(3 + 2 + 1);
  });
  it("granularity follows the period length", () => {
    expect(granularityFor(30)).toBe("day");
    expect(granularityFor(90)).toBe("week");
    expect(granularityFor(400)).toBe("month");
  });
});

describe("patterns are descriptive and need evidence", () => {
  it("says nothing below the minimum", () => {
    const few = toRecords([entry({ original: "Hallo", at: "2026-10-19T08:00:00" })], TZ);
    expect(insights(few, null)).toEqual([]);
  });
  it("reports a repeated phrase and the leading direction", () => {
    const recs = toRecords(
      [
        entry({ original: "Danke", at: "2026-10-19T08:00:00", uses: 3 }),
        entry({ original: "Termin", at: "2026-10-18T08:00:00" }),
        entry({ original: "Arzt", at: "2026-10-17T08:00:00" }),
        entry({ original: "Bahn", at: "2026-10-16T08:00:00" }),
        entry({ original: "مرحبا", at: "2026-10-15T08:00:00", source: "ar", target: "de" }),
      ],
      TZ,
    );
    const found = insights(recs, rangeBounds("7d", "2026-10-19", recs));
    expect(found.find((i) => i.type === "repeated")).toMatchObject({ items: [{ text: "Danke", times: 3 }] });
    expect(found.find((i) => i.type === "topPair")).toMatchObject({ pair: "de>ar", count: 4 });
  });
});

describe("model tags", () => {
  it("keeps only tag values the taxonomy knows", () => {
    const r = parseResult(
      '{"translation":"x","tags":{"kind":"idiom","domain":"astrology","intent":"thank"}}',
      { text: "a", source: "de", target: "ar", style: "natural" },
    );
    expect(r.tags).toEqual({ kind: "idiom", intent: "thank" });
    const none = parseResult('{"translation":"x"}', { text: "a", source: "de", target: "ar", style: "natural" });
    expect(none.tags).toBeUndefined();
  });
});

describe("labels", () => {
  it("ar, en and de have identical statistics keys and every category is named", () => {
    const keys = Object.keys(STATS_DICT.en).sort();
    for (const l of ["ar", "de"] as const) expect(Object.keys(STATS_DICT[l]).sort()).toEqual(keys);
    for (const l of ["ar", "en", "de"] as const)
      for (const [dim, ids] of Object.entries(DIMENSION_VALUES))
        for (const id of ids)
          expect((CATEGORY_DICT[l] as Record<string, Record<string, string>>)[dim]![id], `${l}.${dim}.${id}`).toBeTruthy();
  });
});

describe("archive behaviour", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  it("re-translating the same text updates one row and keeps its date", async () => {
    const { history } = await import("../history");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T08:00:00Z"));
    history.add({ source: "de", target: "ar", original: "Danke", translated: "شكرا" });
    vi.setSystemTime(new Date("2026-10-19T08:00:05Z"));
    history.add({ source: "de", target: "ar", original: "Danke", translated: "شكراً" }); // same occasion
    let rows = history.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.uses).toBe(1);
    expect(rows[0]!.createdAt).toBe(Date.parse("2026-10-19T08:00:00Z"));
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    history.add({ source: "de", target: "ar", original: "Danke", translated: "شكراً" }); // a new occasion
    rows = history.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.uses).toBe(2);
    vi.setSystemTime(new Date("2026-10-19T18:00:00Z"));
    history.add({ source: "de", target: "ar", original: "Danke", translated: "شكراً" }, { quiet: true }); // restored draft
    expect(history.list()[0]!.uses).toBe(2);
    vi.useRealTimers();
  });
  it("a correction changes only the tag, and survives a reload", async () => {
    const { history } = await import("../history");
    history.add({ source: "de", target: "ar", original: "Termin", translated: "موعد", tags: { domain: "health" } });
    const id = history.list()[0]!.id;
    const created = history.list()[0]!.createdAt;
    history.retag(id, { domain: "services" });
    vi.resetModules();
    const fresh = (await import("../history")).history.list()[0]!;
    expect(fresh.fix).toEqual({ domain: "services" });
    expect(fresh.tags).toEqual({ domain: "health" });
    expect(fresh.createdAt).toBe(created);
    expect(fresh.uses).toBe(1);
  });
  it("old history rows (no version, no tags) load and are counted once", async () => {
    localStorage.setItem(
      "lingua.history.v1",
      JSON.stringify([
        { id: "a", source: "de", target: "ar", original: "Hallo", translated: "مرحبا", createdAt: 1 },
        { id: "a", source: "de", target: "ar", original: "Hallo", translated: "مرحبا", createdAt: 1 },
        { id: "b", source: "de", target: "ar", original: "Hi", translated: "هاي", createdAt: 2, tags: { domain: "mars" } },
      ]),
    );
    const { history } = await import("../history");
    const rows = history.list();
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[1]!.tags).toBeUndefined();
    expect(toRecords(rows).every((r) => r.legacy)).toBe(true);
  });
  it("never archives a failed/empty result or an undetermined target", async () => {
    const { history } = await import("../history");
    history.add({ source: "de", target: "auto", original: "Hallo", translated: "x" });
    history.add({ source: "de", target: "ar", original: "Hallo", translated: "  " });
    expect(history.list()).toHaveLength(0);
  });
  it("keeps far more than the old 40 rows", async () => {
    const { history, HISTORY_LIMIT } = await import("../history");
    for (let i = 0; i < 60; i++) history.add({ source: "de", target: "ar", original: `Satz ${i} xyz${i}`, translated: "y" });
    expect(history.list()).toHaveLength(60);
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(2000);
  });
});
