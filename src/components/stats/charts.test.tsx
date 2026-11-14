import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalendarChart } from "./charts";
import { makeFormat } from "./format";
import { select, timeline, toRecords } from "@/lib/stats/engine";

const bounds = { from: "2026-11-12", to: "2026-11-14", days: 3 };
const records = toRecords([
  { id: "one", source: "de", target: "ar", original: "Guten Morgen", translated: "صباح الخير", createdAt: Date.parse("2026-11-12T12:00:00Z") },
  { id: "two", source: "ar", target: "de", original: "كيف حالك اليوم", translated: "Wie geht es dir heute", createdAt: Date.parse("2026-11-14T12:00:00Z") },
], "UTC");
const fmt = makeFormat("en");

describe("archive-based calendar selection", () => {
  it("opens the exact day selected, including a zero-activity day", () => {
    const onSelect = vi.fn();
    render(<CalendarChart buckets={timeline(records, bounds, "day")} metric="translations" selected={null} todayKey="2026-11-14" onSelect={onSelect} fmt={fmt} label="Calendar" less="Less" more="More" />);
    fireEvent.click(screen.getByRole("button", { name: `${fmt.dayLong("2026-11-13")}: 0` }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("2026-11-13");
  });

  it("uses filtered source-word totals without changing calendar identity", () => {
    const buckets = timeline(select(records, bounds, { pair: "ar>de" }), bounds, "day");
    expect(buckets.map(b => b.words)).toEqual([0, 0, 3]);
    const onSelect = vi.fn();
    render(<CalendarChart buckets={buckets} metric="words" selected={null} todayKey="2026-11-14" onSelect={onSelect} fmt={fmt} label="Calendar" less="Less" more="More" />);
    fireEvent.click(screen.getByRole("button", { name: `${fmt.dayLong("2026-11-14")}: 3` }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("2026-11-14");
  });
});