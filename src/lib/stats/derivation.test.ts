import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../history";
import {
  INSIGHT_MIN,
  addDays,
  distribution,
  insights,
  rangeBounds,
  select,
  share,
  summarize,
  timeline,
  toRecords,
  type Bounds,
  type Insight,
  type StatRecord,
} from "./engine";
import { highlights, practiceProfile, rhythm } from "./moments";

/**
 * The statistics screen derives every number from the same archive array. These tests
 * pin the two costs that used to be paid repeatedly per screen:
 * - the same derivation (distribution, rhythm) over the same array is computed once;
 * - unchanged entries are not re-classified when one row was corrected.
 * Passes are counted through a Proxy over the array, so "memoised" is observable and a
 * regression fails even if the output is still correct.
 */

const HOUR = 3_600_000;
const BASE = Date.UTC(2026, 0, 1);

const TEXTS: [string, string][] = [
  ["Guten Morgen, wie geht es dir?", "صباح الخير، كيف حالك؟"],
  ["Kannst du mir bitte helfen?", "هل يمكنك مساعدتي من فضلك؟"],
  ["Danke für alles!", "شكراً على كل شيء!"],
  ["Der Termin beim Arzt ist morgen.", "الموعد عند الطبيب غداً."],
  ["بدي موعد بالبلدية", "Ich brauche einen Termin bei der Gemeinde."],
  ["Herzlichen Glückwunsch!", "تهانينا!"],
];

function entry(i: number, at = BASE + i * HOUR): HistoryEntry {
  const [de, ar] = TEXTS[i % TEXTS.length]!;
  const arabicSource = i % 5 === 0;
  return {
    id: `d-${i}`,
    source: arabicSource ? "ar" : "de",
    target: arabicSource ? "de" : "ar",
    original: arabicSource ? ar : de,
    translated: arabicSource ? de : ar,
    createdAt: at,
    updatedAt: at,
    v: 2,
    uses: 1 + (i % 3),
    style: i % 2 === 0 ? "natural" : "formal",
    formality: i % 2 === 0 ? "neutral" : "polite",
  };
}

function fixture(): HistoryEntry[] {
  const rows = Array.from({ length: 40 }, (_, i) => entry(i));
  // One row late in the UTC day, so a different viewing time zone really moves its day.
  rows.push(entry(40, Date.parse("2026-01-20T23:30:00Z")));
  return rows;
}

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

const records = (): StatRecord[] => toRecords(fixture());

describe("statistics derivation is memoised per archive version", () => {
  it("computes each dimension distribution once for one array", () => {
    const list = records();
    const c = counted(list);
    const first = distribution(c.proxy, "domain");
    const readsAfterFirst = c.reads();
    expect(readsAfterFirst).toBe(list.length);

    const second = distribution(c.proxy, "domain");
    expect(c.reads()).toBe(readsAfterFirst);
    expect(second).toBe(first);
    expect(second).toEqual(distribution(list, "domain"));

    distribution(c.proxy, "register");
    expect(c.reads()).toBe(readsAfterFirst + list.length);
    distribution(c.proxy, "register");
    expect(c.reads()).toBe(readsAfterFirst + list.length);
  });

  it("computes rhythm once for one array", () => {
    const list = records();
    const c = counted(list);
    const first = rhythm(c.proxy);
    const readsAfterFirst = c.reads();
    rhythm(c.proxy);
    expect(c.reads()).toBe(readsAfterFirst);
    expect(rhythm(list)).toEqual(first);
  });

  it("lets the records panel reuse the rhythm pass instead of repeating it", () => {
    const list = records();
    const c = counted(list);
    rhythm(c.proxy);
    const before = c.reads();
    highlights(c.proxy);
    // Only the panel's own single pass; the 24-hour formatting pass is reused.
    expect(c.reads() - before).toBeLessThan(list.length * 1.5);
  });

  it("runs insights in one pass after the route already built its distributions", () => {
    const list = records();
    const today = "2026-01-21";
    const bounds = rangeBounds("30d", today, list)!;
    const c = counted(list);
    distribution(c.proxy, "pair");
    distribution(c.proxy, "kind");
    distribution(c.proxy, "domain");
    const beforeInsights = c.reads();

    insights(c.proxy, bounds);

    expect(c.reads() - beforeInsights).toBeLessThan(list.length * 2);
  });

  it("reuses the practice profile's domain distribution", () => {
    const list = records();
    const today = "2026-01-21";
    const bounds = rangeBounds("30d", today, list)!;
    const c = counted(list);
    distribution(c.proxy, "domain");
    const before = c.reads();
    practiceProfile(c.proxy, bounds);
    expect(c.reads() - before).toBeLessThan(list.length * 1.5);
  });

  it("does not re-classify unchanged entries after one row was corrected", () => {
    const entries = fixture();
    const first = toRecords(entries);
    const byId = new Map(first.map((r) => [r.id, r]));

    const corrected = entries.map((e, i) =>
      i === 0 ? { ...e, fix: { domain: "services" as const } } : e,
    );
    const second = toRecords(corrected);
    const secondById = new Map(second.map((r) => [r.id, r]));

    expect(secondById.get("d-0")!.domain).toBe("services");
    expect(secondById.get("d-0")!.origin.domain).toBe("user");
    expect(secondById.get("d-1")).toBe(byId.get("d-1"));
    expect(secondById.get("d-40")).toBe(byId.get("d-40"));
  });

  it("keeps time zones separate in the memoised records", () => {
    const entries = fixture();
    const utc = toRecords(entries, "UTC");
    const kiritimati = toRecords(entries, "Pacific/Kiritimati");
    const utcDay = new Map(utc.map((r) => [r.id, r.day]));
    expect(kiritimati.find((r) => r.id === "d-40")!.day).not.toBe(utcDay.get("d-40"));
    // A second UTC read is the same memoised value, not the island's day.
    expect(toRecords(entries, "UTC").find((r) => r.id === "d-40")!.day).toBe(utcDay.get("d-40"));
  });

  it("matches the previous multi-pass insights algorithm on varied archives", () => {
    // The patterns are now derived in one pass; this reference keeps the old shape and
    // fails if the restructure changes any emitted insight, including tie-breaking order.
    const reference = (records: StatRecord[], b: Bounds | null): Insight[] => {
      const total = records.length;
      if (total < INSIGHT_MIN) return [];
      const out: Insight[] = [];
      const doms = distribution(records, "domain").filter((s) => s.id !== "none");
      if (
        doms[0] &&
        doms[0].count >= 3 &&
        doms[0].share >= 0.3 &&
        doms[0].count > (doms[1]?.count ?? 0)
      )
        out.push({ type: "topDomain", domain: doms[0].id, count: doms[0].count, total });
      const pairs = distribution(records, "pair");
      if (pairs.length > 1 && pairs[0]!.count > pairs[1]!.count)
        out.push({ type: "topPair", pair: pairs[0]!.id, count: pairs[0]!.count, total });
      const kinds = distribution(records, "kind");
      if (kinds[0] && kinds[0].share >= 0.4 && kinds[0].count > (kinds[1]?.count ?? 0))
        out.push({ type: "topKind", kind: kinds[0].id, count: kinds[0].count, total });
      const rep = new Map<string, { text: string; times: number }>();
      for (const r of records) {
        const k = r.original.trim().toLowerCase().replace(/\s+/g, " ");
        const cur = rep.get(k) ?? { text: r.original.trim(), times: 0 };
        cur.times += r.uses;
        rep.set(k, cur);
      }
      const repeated = [...rep.values()]
        .filter((x) => x.times >= 2)
        .sort((a, c) => c.times - a.times)
        .slice(0, 3);
      if (repeated.length) out.push({ type: "repeated", items: repeated });
      if (b && b.days >= 2) {
        const mid = addDays(b.from, Math.floor(b.days / 2) - 1);
        const first = records.filter((r) => r.day <= mid && r.intent !== "none");
        const second = records.filter((r) => r.day > mid && r.intent !== "none");
        if (first.length >= INSIGHT_MIN && second.length >= INSIGHT_MIN) {
          let best: Insight | null = null;
          let bestDelta = 0;
          const ids = new Set([...first, ...second].map((r) => r.intent));
          for (const id of ids) {
            const before = share(first.filter((r) => r.intent === id).length, first.length);
            const after = share(second.filter((r) => r.intent === id).length, second.length);
            if (Math.abs(after - before) >= 0.15 && Math.abs(after - before) > bestDelta) {
              bestDelta = Math.abs(after - before);
              best = { type: "intentShift", intent: id, before, after };
            }
          }
          if (best) out.push(best);
        }
      }
      const estimated = records.filter((r) => r.origin.domain === "local").length;
      if (estimated) out.push({ type: "estimated", count: estimated, total });
      return out;
    };

    // Deterministic pseudo-random archives: mixed direction, days, uses, intents and
    // duplicate texts, so the pattern thresholds and tie-breaks are exercised.
    let seed = 20261117;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 60; round++) {
      const rows: HistoryEntry[] = Array.from({ length: 6 + Math.floor(random() * 30) }, (_, i) => {
        const base = entry(i, BASE + Math.floor(random() * 20) * 86_400_000 + i * 60_000);
        return {
          ...base,
          uses: 1 + Math.floor(random() * 4),
          source: random() < 0.3 ? "ar" : "de",
          target: random() < 0.3 ? "de" : "ar",
        };
      });
      const data = toRecords(rows);
      const bounds = rangeBounds(round % 2 ? "7d" : "30d", "2026-01-21", data);
      expect(insights(data, bounds)).toEqual(reference(data, bounds));
    }
  });

  it("returns identical numbers when the same array is derived twice", () => {
    const list = records();
    const today = "2026-01-21";
    const bounds = rangeBounds("30d", today, list)!;
    const visible = select(list, bounds, {});
    const run = () => ({
      summary: summarize(visible),
      timeline: timeline(visible, bounds),
      domains: distribution(visible, "domain"),
      insights: insights(visible, bounds),
      rhythm: rhythm(visible),
      practice: practiceProfile(visible, bounds),
      highlights: highlights(visible),
    });
    expect(run()).toEqual(run());
  });
});
