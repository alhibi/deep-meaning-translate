/**
 * Cost benchmark for the device archive and the statistics derivation.
 *
 * Deterministic fixture, measured in one jsdom/node process — these are **not device
 * numbers**. The test only asserts the fixture's shape (so a silent empty run cannot
 * pass); the printed numbers are the evidence reported in the task, re-run after the
 * fixes with the same command:
 *
 *   npx vitest run src/lib/persistence/storage.bench.test.ts
 *
 * Kept small enough to run with the suite: the archive is full (2,000 rows) but each
 * measurement is a handful of iterations.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { history, type HistoryEntry } from "../history";
import { resetSavedCache, saved } from "../saved";
import { readStatsPrefs } from "../stats/useArchive";
import {
  dayKey,
  distribution,
  insights,
  rangeBounds,
  select,
  summarize,
  timeline,
  toRecords,
  type StatRecord,
} from "../stats/engine";
import {
  highlights,
  hourOfDay,
  practiceProfile,
  practiceTrail,
  rhythm,
  streaks,
} from "../stats/moments";

const ARCHIVE = 2000;
const ADDS = 20;
const REPS = 5;
const SAVED_ROWS = 300;
const HISTORY_KEY = "lingua.history.v1";
const SAVED_KEY = "lingua.saved.v1";
const STATS_PREFS_KEY = "lingua.stats.v1";

const HOUR = 3_600_000;
const BASE = Date.UTC(2026, 0, 1);

/** Mixed German/Arabic sentences so local classification (the expensive part) runs. */
const TEXTS: readonly [string, string][] = [
  ["Guten Morgen, wie geht es dir heute?", "صباح الخير، كيف حالك اليوم؟"],
  [
    "Kannst du mir bitte den Termin beim Arzt bestätigen?",
    "هل يمكنك تأكيد الموعد عند الطبيب من فضلك؟",
  ],
  ["Danke für alles, bis morgen!", "شكراً على كل شيء، إلى الغد!"],
  ["Der Vertrag muss vor Freitag unterschrieben werden.", "يجب توقيع العقد قبل يوم الجمعة."],
  ["بدي موعد بالبلدية يارب", "Ich brauche einen Termin bei der Gemeinde."],
  ["Herzlichen Glückwunsch zum neuen Job!", "تهانينا القلبية على الوظيفة الجديدة!"],
];

function entry(i: number): HistoryEntry {
  const [de, ar] = TEXTS[i % TEXTS.length]!;
  const arabicSource = i % 5 === 0;
  return {
    id: `bench-${i}`,
    source: arabicSource ? "ar" : "de",
    target: arabicSource ? "de" : "ar",
    original: arabicSource ? ar : de,
    translated: arabicSource ? de : ar,
    createdAt: BASE + i * HOUR,
    updatedAt: BASE + i * HOUR,
    v: 2,
    uses: 1 + (i % 3),
    style: i % 3 === 0 ? "formal" : "natural",
    formality: i % 2 === 0 ? "neutral" : "polite",
  };
}

const archive = (n: number): HistoryEntry[] => Array.from({ length: n }, (_, i) => entry(i));

function savedRow(i: number) {
  const [de, ar] = TEXTS[i % TEXTS.length]!;
  return {
    id: `phrase-${i}`,
    source: "de",
    target: "ar",
    original: `Phrase Nummer ${i} ${de.slice(0, 10)}`,
    translated: ar,
    createdAt: BASE + i * HOUR,
    known: i % 4,
    reviewedAt: BASE + i * HOUR,
  };
}

function seedArchive(rows: HistoryEntry[]) {
  // Writers keep the archive newest-first; the fixture must too.
  localStorage.setItem(HISTORY_KEY, JSON.stringify([...rows].reverse()));
  history.reload();
}

/** Array whose element reads are counted, so a pass is observable, not a feeling. */
function counted<T>(rows: T[]): { proxy: T[]; reads: () => number } {
  let reads = 0;
  const proxy = new Proxy(rows, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key)) reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  return { proxy, reads: () => reads };
}

function timeSync(label: string, fn: () => void): number {
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  console.log(`BENCH ${label}: ${ms.toFixed(2)} ms`);
  return ms;
}

async function timeAsync(label: string, fn: () => Promise<void>): Promise<number> {
  const t0 = performance.now();
  await fn();
  const ms = performance.now() - t0;
  console.log(`BENCH ${label}: ${ms.toFixed(2)} ms`);
  return ms;
}

beforeEach(() => {
  localStorage.clear();
  history.reload();
  resetSavedCache();
});

describe("storage + statistics cost (jsdom/node numbers, not device claims)", () => {
  it("measures history.add over a full 2,000-row archive", async () => {
    seedArchive(archive(ARCHIVE));
    expect(history.list()).toHaveLength(ARCHIVE);
    const bytesBefore = (localStorage.getItem(HISTORY_KEY) ?? "").length;

    const ms = await timeAsync(`history.add x${ADDS} (archive ${ARCHIVE})`, async () => {
      for (let i = 0; i < ADDS; i++)
        await history.add({
          source: "de",
          target: "ar",
          original: `Neuer Satz ${i} ${"x".repeat(8)}`,
          translated: `جملة جديدة ${i}`,
        });
    });
    const bytesAfter = (localStorage.getItem(HISTORY_KEY) ?? "").length;
    console.log(
      `BENCH history.add: ${(ms / ADDS).toFixed(2)} ms/add, serialized write ${bytesAfter} chars (was ${bytesBefore}), list ${history.list().length}`,
    );
    expect(history.list()).toHaveLength(ARCHIVE);
    expect(history.list()[0]?.original).toContain("Neuer Satz 19");
  });

  it("measures the full archive read + validate path", async () => {
    seedArchive(archive(ARCHIVE));
    const reads = 20;
    const ms = timeSync(`history read+parse x${reads} (archive ${ARCHIVE})`, () => {
      for (let i = 0; i < reads; i++) {
        history.reload();
        expect(history.list()).toHaveLength(ARCHIVE);
      }
    });
    console.log(`BENCH history read+parse: ${(ms / reads).toFixed(2)} ms/read`);
    expect(history.list()[0]?.id).toBe("bench-1999");
  });

  it("measures statistics derivation passes and time", () => {
    const entries = archive(ARCHIVE);
    seedArchive(entries);
    const source = history.list();
    // Warm the classifier/JIT on a small archive so the 2,000-row number is not a cold start.
    toRecords(source.slice(0, 64));
    const entryCount = counted(source);
    const convert = timeSync("toRecords first conversion", () => void toRecords(entryCount.proxy));
    const records = toRecords(source);
    expect(records).toHaveLength(ARCHIVE);
    const convertReads = entryCount.reads();
    expect(convertReads).toBeGreaterThanOrEqual(ARCHIVE);
    console.log(
      `BENCH toRecords first conversion: ${convert.toFixed(2)} ms, ${convertReads} array reads, ${records.length} records`,
    );

    // What a tag correction costs on the statistics screen: the archive array changes,
    // every entry object except the corrected one is the same reference.
    const corrected = source.map((e, i) =>
      i === 0 ? { ...e, fix: { domain: "services" as const } } : e,
    );
    const rederive = timeSync(
      "toRecords after one-row correction",
      () => void toRecords(corrected),
    );
    console.log(`BENCH toRecords after one-row correction: ${rederive.toFixed(2)} ms`);

    const today = "2026-03-01";
    const bounds = rangeBounds("30d", today, records)!;
    // The page's pipeline: every number derives from the same two arrays, as the route does.
    const pipeline = (all: StatRecord[], visible: StatRecord[]) => {
      const summary = summarize(visible);
      const prev = select(visible, bounds, { pair: "de>ar" });
      summarize(prev);
      timeline(visible, bounds);
      distribution(visible, "pair");
      distribution(visible, "kind");
      distribution(visible, "domain");
      distribution(visible, "intent");
      distribution(visible, "register");
      insights(visible, bounds);
      summarize(all);
      streaks(all, today);
      rhythm(visible);
      practiceProfile(visible, bounds);
      practiceTrail(visible, bounds);
      highlights(visible);
    };
    const visible = select(records, bounds, {});
    expect(visible.length).toBeGreaterThan(0);

    // A filter/period change rebuilds `visible` and re-derives; measurement uses fresh
    // arrays per repetition so the memo's warm path does not flatter the numbers.
    let reads = 0;
    const ms = timeSync(`statistics derivation x${REPS} (visible ${visible.length})`, () => {
      for (let i = 0; i < REPS; i++) {
        const freshVisible = select(records, bounds, {});
        const visibleCount = counted(freshVisible);
        const allCount = counted(records);
        pipeline(allCount.proxy, visibleCount.proxy);
        reads += visibleCount.reads() + allCount.reads();
      }
    });
    const passes = Math.round(reads / REPS);
    console.log(
      `BENCH statistics: ${(ms / REPS).toFixed(2)} ms/pass, ${passes} array reads/pass for ${visible.length} visible of ${records.length}`,
    );
    // The same visible array is measured twice by the route (rhythm + highlights).
    const rhythmCount = counted(visible);
    rhythm(rhythmCount.proxy);
    const firstRhythm = rhythmCount.reads();
    rhythm(rhythmCount.proxy);
    console.log(
      `BENCH rhythm twice on the same array: ${firstRhythm} then ${rhythmCount.reads() - firstRhythm} array reads`,
    );
    expect(passes).toBeGreaterThan(0);
  });

  it("measures the per-row derivation primitives inside toRecords/rhythm", () => {
    const entries = archive(ARCHIVE);
    const stamps = entries.map((e) => e.createdAt);
    const day = timeSync("dayKey x2000", () => {
      for (const ms of stamps) dayKey(ms, "Europe/Berlin");
    });
    const hour = timeSync("hourOfDay x2000", () => {
      for (const ms of stamps) hourOfDay(ms, "Europe/Berlin");
    });
    console.log(
      `BENCH primitives: ${((day / ARCHIVE) * 1000).toFixed(1)} µs/dayKey, ${((hour / ARCHIVE) * 1000).toFixed(1)} µs/hourOfDay`,
    );
    expect(stamps).toHaveLength(ARCHIVE);
  });

  it("measures saved-phrase lookup cost and per-call normalisation", () => {
    localStorage.setItem(
      SAVED_KEY,
      JSON.stringify(Array.from({ length: SAVED_ROWS }, (_, i) => savedRow(i))),
    );
    resetSavedCache();
    expect(saved.list()).toHaveLength(SAVED_ROWS);

    // The last seeded row: a hit near the end forces the whole phrasebook scan.
    const query = `Phrase Nummer ${SAVED_ROWS - 1} Herzlichen`;
    const replaces = vi.spyOn(String.prototype, "replace");
    const ms = timeSync(`saved.find x500 (phrasebook ${SAVED_ROWS})`, () => {
      for (let i = 0; i < 500; i++) expect(saved.find(query, "ar")).not.toBeNull();
    });
    const calls = replaces.mock.calls.length;
    replaces.mockRestore();
    console.log(
      `BENCH saved.find: ${((ms / 500) * 1000).toFixed(1)} µs/call, ${calls} normalisations for 500 calls`,
    );
    expect(saved.find(query, "ar")).not.toBeNull();
  });

  it("measures statistics-preference reads (a JSON value read during render)", () => {
    localStorage.setItem(STATS_PREFS_KEY, JSON.stringify({ insightsHidden: false }));
    const parse = vi.spyOn(JSON, "parse");
    const prefReads = 2000;
    const ms = timeSync(`stats pref reads x${prefReads}`, () => {
      for (let i = 0; i < prefReads; i++) expect(readStatsPrefs().insightsHidden).toBe(false);
    });
    const parses = parse.mock.calls.length;
    parse.mockRestore();
    console.log(
      `BENCH stats prefs: ${((ms / prefReads) * 1000).toFixed(1)} µs/read, ${parses} JSON.parse for ${prefReads} reads`,
    );
    expect(readStatsPrefs()).toEqual({ insightsHidden: false });
  });

  it("measures archive-count drift over more rows than the archive limit", async () => {
    seedArchive(archive(ARCHIVE));
    expect(history.count()).toBe(ARCHIVE);
    for (let i = 0; i < 5; i++)
      await history.add({
        source: "de",
        target: "ar",
        original: `Überlauf ${i} ${"y".repeat(6)}`,
        translated: `تجاوز ${i}`,
      });
    console.log(
      `BENCH history.count after ${ARCHIVE}+5 unique rows: ${history.count()} (limit ${ARCHIVE}), list ${history.list().length}`,
    );
    expect(history.list()).toHaveLength(ARCHIVE);
  });
});
