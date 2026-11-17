import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const thresholds = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/perf/thresholds.json"), "utf8"),
);

/**
 * The performance gate is only as good as its budget file. These tests keep the contract
 * between scripts/perf/run_perf.py, scripts/perf/thresholds.json and
 * tests/perf/check_budgets.py from silently drifting: every protected metric must exist,
 * every budget must be a positive finite number, and no budget may be tighter than the
 * measurement it was derived from (a gate that fails on its own baseline is not a gate).
 */
const REQUIRED = {
  baseline: [
    "cold_fcp_ms",
    "cold_lcp_ms",
    "typing_p95_ms",
    "typing_p95_4x_ms",
    "typing_max_ms",
    "first_word_p95_ms",
    "settle_p95_ms",
    "navigation_to_stats_p50_ms",
    "navigation_to_stats_p95_ms",
    "navigation_back_p95_ms",
    "connected_dom_max",
    "idle_js_heap_mb_max",
    "idle_timers_max",
    "idle_intervals_max",
    "idle_active_fetches_max",
    "idle_page_errors_max",
  ],
  bundle: [
    "js_gzip_bytes_max",
    "css_gzip_bytes_max",
    "all_assets_gzip_bytes_max",
    "entry_js_gzip_bytes_max",
    "routes_js_gzip_bytes_max",
    "missing_files_max",
  ],
  requests: [
    "max_full_stream_requests_per_settled_cycle",
    "max_duplicate_full_requests",
    "max_stream_requests_for_identical_text",
    "max_stream_requests_for_memory_hit_after_reload",
    "min_enrichment_aborts_when_superseded",
    "max_page_errors",
  ],
  stress: [
    "max_heap_growth_mb",
    "max_heap_growth_percent",
    "max_connected_dom_growth",
    "max_renderer_node_growth",
    "max_listener_growth",
    "max_active_timers_final",
    "max_active_intervals_final",
    "max_active_fetches_final",
    "max_memory_rows",
    "max_memory_bytes",
    "max_settle_misses",
    "max_page_errors",
    "max_duplicate_full_requests",
  ],
  media: [
    "max_images_on_load",
    "max_bytes_on_load",
    "max_images_total",
    "max_bytes_total",
    "max_failed_image_fetches",
    "max_weather_requests_before_consent",
    "max_weather_requests_during_20s_idle",
    "max_weather_requests_during_typing",
  ],
};

describe("performance budgets", () => {
  it("documents a version and an environment", () => {
    expect(thresholds.version).toBe(1);
    expect(typeof thresholds.measuredAt).toBe("string");
    expect(thresholds.environment.provider).toMatch(/mock/i);
  });

  for (const [suite, keys] of Object.entries(REQUIRED)) {
    it("defines every " + suite + " budget as a positive finite number", () => {
      for (const key of keys) {
        const value = thresholds[suite][key];
        expect(Number.isFinite(value), suite + "." + key).toBe(true);
        expect(value, suite + "." + key).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("never sets a maximum budget below the measured baseline", () => {
    const measured = thresholds.measured;
    expect(measured).toBeTruthy();
    const pairs: Array<[string, string, number]> = [];
    for (const field of [
      "cold_fcp_ms",
      "cold_lcp_ms",
      "typing_p95_ms",
      "typing_p95_4x_ms",
      "first_word_p95_ms",
      "settle_p95_ms",
      "navigation_to_stats_p50_ms",
      "navigation_to_stats_p95_ms",
      "navigation_back_p95_ms",
      "idle_js_heap_mb_max",
    ]) {
      pairs.push(["baseline", field, measured.baseline[field]]);
    }
    for (const [suite, field, value] of pairs) {
      expect(Number.isFinite(value), "measured " + suite + "." + field).toBe(true);
      expect(thresholds[suite][field], "budget for " + suite + "." + field).toBeGreaterThanOrEqual(
        value,
      );
    }
  });

  it("keeps the stress storage budgets inside the product's documented bounds", () => {
    // persistence/contracts.ts: MEMORY_MAX_ENTRIES = 120, MEMORY_MAX_BYTES = 200 KB.
    expect(thresholds.stress.max_memory_rows).toBeLessThanOrEqual(120);
    expect(thresholds.stress.max_memory_bytes).toBeLessThanOrEqual(204800);
  });
});
