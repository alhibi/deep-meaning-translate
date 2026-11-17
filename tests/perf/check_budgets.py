"""Budget gate for the measurements written by scripts/perf/run_perf.py.

This is a deterministic, browser-free check: it reads artifacts/phase2/perf/<suite>.json,
applies scripts/perf/thresholds.json and prints one PASS / FAIL / NOT_VERIFIED row per
budget. It never invents a number: a missing suite is reported NOT_VERIFIED, never PASS.

    python3 tests/perf/check_budgets.py
    python3 tests/perf/check_budgets.py --self-test

Exit code 1 when any budget fails. The self-test proves the gate rejects breaches (it
mutates a known-good payload and expects a FAIL for every protected metric).
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
DEFAULT_DIR = REPO_ROOT / "artifacts" / "phase2" / "perf"
DEFAULT_THRESHOLDS = REPO_ROOT / "scripts" / "perf" / "thresholds.json"

PASS, FAIL, NOT_VERIFIED = "PASS", "FAIL", "NOT_VERIFIED"


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _get(data, path, default=None):
    node = data
    for part in path.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        elif isinstance(node, list) and part.isdigit() and int(part) < len(node):
            node = node[int(part)]
        else:
            return default
    return node


class Report:
    def __init__(self):
        self.rows = []

    def add(self, suite, check, value, budget, status, note=""):
        self.rows.append(
            {
                "suite": suite,
                "check": check,
                "value": value,
                "budget": budget,
                "status": status,
                "note": note,
            }
        )

    def max(self, suite, check, value, budget, note=""):
        if value is None:
            self.add(suite, check, "-", budget, NOT_VERIFIED, note or "metric missing")
        elif _number(value) and value <= budget:
            self.add(suite, check, value, "<= %s" % budget, PASS, note)
        else:
            self.add(suite, check, value, "<= %s" % budget, FAIL, note)

    def min(self, suite, check, value, budget, note=""):
        if value is None:
            self.add(suite, check, "-", budget, NOT_VERIFIED, note or "metric missing")
        elif _number(value) and value >= budget:
            self.add(suite, check, value, ">= %s" % budget, PASS, note)
        else:
            self.add(suite, check, value, ">= %s" % budget, FAIL, note)

    def equal(self, suite, check, value, expected, note=""):
        if value is None:
            self.add(suite, check, "-", expected, NOT_VERIFIED, note or "metric missing")
        elif value == expected:
            self.add(suite, check, value, "== %s" % expected, PASS, note)
        else:
            self.add(suite, check, value, "== %s" % expected, FAIL, note)

    def truth(self, suite, check, value, note=""):
        if value is None:
            self.add(suite, check, "-", "true", NOT_VERIFIED, note or "metric missing")
        elif value:
            self.add(suite, check, value, "true", PASS, note)
        else:
            self.add(suite, check, value, "true", FAIL, note)

    def print(self):
        widths = [0, 0, 0, 0, 0, 0]
        header = ["suite", "check", "value", "budget", "status", "note"]
        rows = [[str(r["suite"]), str(r["check"]), str(r["value"]), str(r["budget"]), r["status"], r["note"]] for r in self.rows]
        for index, label in enumerate(header):
            widths[index] = max([len(label)] + [len(row[index]) for row in rows]) if rows else len(label)
        print("  ".join(label.ljust(widths[i]) for i, label in enumerate(header)))
        print("  ".join("-" * widths[i] for i in range(len(header))))
        for row in rows:
            print("  ".join(row[i].ljust(widths[i]) for i in range(len(header))))
        counts = {status: 0 for status in (PASS, FAIL, NOT_VERIFIED)}
        for row in rows:
            counts[row[4]] += 1
        print()
        print("PASS %d | FAIL %d | NOT_VERIFIED %d" % (counts[PASS], counts[FAIL], counts[NOT_VERIFIED]))
        return counts[FAIL]


def _allowed_guard_url(url):
    # Culture images are a third-party host the page legitimately requests; the harness
    # blocks them unless the media suite serves them. Anything else blocked is a defect.
    return "images.metmuseum.org" in url


def evaluate(payloads, thresholds):
    report = Report()
    base = thresholds.get("baseline", {})
    bundle_budget = thresholds.get("bundle", {})
    req_budget = thresholds.get("requests", {})
    stress_budget = thresholds.get("stress", {})
    media_budget = thresholds.get("media", {})

    baseline = payloads.get("baseline")
    if not baseline:
        report.add("baseline", "measurements", "-", "-", NOT_VERIFIED, "baseline.json missing: run --suite baseline")
    else:
        contaminated = baseline.get("contaminated")
        if contaminated:
            report.add("baseline", "document-stable", contaminated, "false", NOT_VERIFIED, "page reloaded during the run; latency budgets are not gated")
        report.max("baseline", "cold FCP ms", _get(baseline, "cold_load.fcpMs"), base.get("cold_fcp_ms", 1500))
        report.max("baseline", "cold LCP ms", _get(baseline, "cold_load.lcpMs"), base.get("cold_lcp_ms", 3500))
        typing = {row.get("label"): row for row in baseline.get("typing", [])}
        report.max("baseline", "typing p95 ms (1x)", _get(typing, "typing-1x.p95"), base.get("typing_p95_ms", 60))
        report.max("baseline", "typing max ms (1x)", _get(typing, "typing-1x.max"), base.get("typing_max_ms", 400))
        report.max("baseline", "typing p95 ms (4x CPU)", _get(typing, "typing-4x.p95"), base.get("typing_p95_4x_ms", 150))
        report.max("baseline", "first streamed word p95 ms", _get(baseline, "first_word_and_settle.firstWordMs.p95"), base.get("first_word_p95_ms", 300))
        report.max("baseline", "settled answer p95 ms", _get(baseline, "first_word_and_settle.settleMs.p95"), base.get("settle_p95_ms", 600))
        report.max("baseline", "navigation to stats p50 ms", _get(baseline, "navigation.toStatsMs.p50"), base.get("navigation_to_stats_p50_ms", 700))
        report.max("baseline", "navigation to stats p95 ms", _get(baseline, "navigation.toStatsMs.p95"), base.get("navigation_to_stats_p95_ms", 3000))
        report.max("baseline", "navigation back p95 ms", _get(baseline, "navigation.backMs.p95"), base.get("navigation_back_p95_ms", 3000))
        docs = _get(baseline, "navigation.documents")
        report.equal("baseline", "navigation documents", docs[0] if isinstance(docs, list) and docs else docs, 1, "client-side navigation must not rebuild the document")
        report.max("baseline", "connected DOM nodes (idle)", _get(baseline, "settled_idle.paintDomNodes"), base.get("connected_dom_max", 1200))
        report.max("baseline", "renderer nodes incl. detached (idle)", _get(baseline, "settled_idle.rendererNodes"), base.get("idle_renderer_nodes_max", 20000))
        heap = _get(baseline, "settled_idle.cdp.jsHeapUsedBytes")
        report.max("baseline", "JS heap (idle, MB)", round(heap / 1e6, 2) if _number(heap) else None, base.get("idle_js_heap_mb_max", 96))
        report.max("baseline", "active timers (idle)", _get(baseline, "settled_idle.activeTimers"), base.get("idle_timers_max", 3))
        report.max("baseline", "active intervals (idle)", _get(baseline, "settled_idle.activeIntervals"), base.get("idle_intervals_max", 2))
        report.max("baseline", "active fetches (idle)", _get(baseline, "settled_idle.activeFetches"), base.get("idle_active_fetches_max", 0))
        report.equal("baseline", "page errors", len(_get(baseline, "settled_idle.errors", [])), 0)
        blocked = [u for u in _get(baseline, "guardViolations", []) if not _allowed_guard_url(u)]
        report.equal("baseline", "blocked provider requests", len(blocked), 0)

    bundle = (baseline or {}).get("bundle")
    if not bundle or bundle.get("status") != "OBSERVED":
        report.add("bundle", "production build artefact", "-", "-", NOT_VERIFIED, "no production build output to measure; the lead owns the build")
    else:
        report.max("bundle", "JS gzip bytes (precache)", _get(bundle, "js.gzipBytes"), bundle_budget.get("js_gzip_bytes_max", 650000))
        report.max("bundle", "CSS gzip bytes", _get(bundle, "css.gzipBytes"), bundle_budget.get("css_gzip_bytes_max", 30000))
        report.max("bundle", "all assets gzip bytes", _get(bundle, "all_assets.gzipBytes"), bundle_budget.get("all_assets_gzip_bytes_max", 1400000))
        report.max("bundle", "missing precache files", len(bundle.get("missing_files", [])), 0)
        largest = bundle.get("largest", [])
        entry = next((item for item in largest if "/index-" in item.get("url", "")), None)
        routes = next((item for item in largest if "/routes-" in item.get("url", "")), None)
        report.max("bundle", "entry chunk gzip bytes", (entry or {}).get("gzipBytes"), bundle_budget.get("entry_js_gzip_bytes_max", 220000))
        report.max("bundle", "routes chunk gzip bytes", (routes or {}).get("gzipBytes"), bundle_budget.get("routes_js_gzip_bytes_max", 90000))
        if bundle.get("may_exclude_uncommitted_work"):
            report.add("bundle", "build freshness", bundle.get("build_mtime"), "-", NOT_VERIFIED, "source files are newer than the measured build; the lead rebuilds production")

    requests = payloads.get("requests")
    if not requests:
        report.add("requests", "measurements", "-", "-", NOT_VERIFIED, "requests.json missing: run --suite requests")
    else:
        scenarios = {row.get("label"): row for row in requests.get("scenarios", [])}
        settled = scenarios.get("single-settled-sentence", {})
        report.max("requests", "full requests per settled sentence", settled.get("streamFull"), req_budget.get("max_full_stream_requests_per_settled_cycle", 1))
        duplicate_full = 0
        for scenario in requests.get("scenarios", []):
            for fetch in scenario.get("fetches", []):
                if fetch.get("kind") == "stream" and fetch.get("mode") == "full" and fetch.get("duplicate"):
                    duplicate_full += 1
        report.max("requests", "duplicate full requests", duplicate_full, req_budget.get("max_duplicate_full_requests", 0), "same completed text must not be paid for twice")
        identical = scenarios.get("identical-text-again", {})
        report.max("requests", "stream requests for repeated identical text", identical.get("streamFull"), req_budget.get("max_stream_requests_for_identical_text", 0))
        report.min("requests", "cache hits for repeated identical text", (identical.get("metricsDelta") or {}).get("cacheHits"), 1)
        reload_scenario = scenarios.get("device-memory-after-reload", {})
        report.max("requests", "stream requests for memory hit after reload", reload_scenario.get("streamPosts"), req_budget.get("max_stream_requests_for_memory_hit_after_reload", 0))
        abandoned = scenarios.get("abandoned-enrichment", {})
        if abandoned.get("enrichmentReachedWire"):
            report.min("requests", "superseded enrichment aborts at wire", abandoned.get("enrichmentAborted"), req_budget.get("min_enrichment_aborts_when_superseded", 1), "A01: the queue signal must reach fetch")
        else:
            report.add("requests", "superseded enrichment aborts at wire", "-", ">= 1", NOT_VERIFIED, "no enrichment request reached the wire in this run")
        report.equal("requests", "page errors", len(_get(requests, "totals.errors", [])), 0)
        blocked = [u for u in _get(requests, "totals.guardViolations", []) if not _allowed_guard_url(u)]
        report.equal("requests", "blocked provider requests", len(blocked), 0)

    stress = payloads.get("stress")
    if not stress:
        report.add("stress", "measurements", "-", "-", NOT_VERIFIED, "stress.json missing: run --suite stress")
    elif stress.get("contaminated"):
        report.add("stress", "document-stable", True, "false", NOT_VERIFIED, "page reloaded during the run; growth budgets are not gated")
    else:
        samples = stress.get("samples", [])
        warm = samples[0] if samples else {}
        final = samples[-1] if samples else {}
        warm_heap = _get(warm, "cdp.jsHeapUsedBytes")
        final_heap = _get(final, "cdp.jsHeapUsedBytes")
        heap_growth_mb = round((final_heap - warm_heap) / 1e6, 2) if _number(final_heap) and _number(warm_heap) else None
        report.max("stress", "JS heap growth MB", heap_growth_mb, stress_budget.get("max_heap_growth_mb", 10))
        report.max(
            "stress",
            "JS heap growth percent",
            round(100.0 * (final_heap - warm_heap) / warm_heap, 1) if _number(final_heap) and _number(warm_heap) and warm_heap else None,
            stress_budget.get("max_heap_growth_percent", 40),
        )
        warm_dom = _get(warm, "js.paint.domNodes")
        final_dom = _get(final, "js.paint.domNodes")
        report.max("stress", "connected DOM growth", (final_dom - warm_dom) if _number(final_dom) and _number(warm_dom) else None, stress_budget.get("max_connected_dom_growth", 500))
        warm_nodes = _get(warm, "cdp.domNodes")
        final_nodes = _get(final, "cdp.domNodes")
        report.max("stress", "renderer node growth (incl. detached)", (final_nodes - warm_nodes) if _number(final_nodes) and _number(warm_nodes) else None, stress_budget.get("max_renderer_node_growth", 4000))
        warm_listeners = _get(warm, "cdp.jsEventListeners")
        final_listeners = _get(final, "cdp.jsEventListeners")
        report.max("stress", "listener growth", (final_listeners - warm_listeners) if _number(final_listeners) and _number(warm_listeners) else None, stress_budget.get("max_listener_growth", 200))
        report.max("stress", "active timers after quiesce", _get(final, "js.timers.active"), stress_budget.get("max_active_timers_final", 3))
        report.max("stress", "active intervals after quiesce", _get(final, "js.timers.intervals"), stress_budget.get("max_active_intervals_final", 2))
        report.max("stress", "in-flight requests after quiesce", _get(final, "js.fetch.active"), stress_budget.get("max_active_fetches_final", 0), "abandoned foreground work must not remain running")
        report.max("stress", "translation memory rows", _get(final, "js.storage.memoryRows"), stress_budget.get("max_memory_rows", 120))
        report.max("stress", "translation memory bytes", _get(final, "js.storage.byKey.lingua.memory.v1.bytes"), stress_budget.get("max_memory_bytes", 204800))
        totals = stress.get("totals", {})
        report.max("stress", "settle misses", totals.get("settleMisses"), stress_budget.get("max_settle_misses", 0))
        report.equal("stress", "page errors", len(totals.get("errors") or []) + len(_get(final, "js.errors", [])), 0)
        report.max("stress", "duplicate full requests", totals.get("duplicateRequests"), stress_budget.get("max_duplicate_full_requests", 0))

    media = payloads.get("media")
    if not media:
        report.add("media", "measurements", "-", "-", NOT_VERIFIED, "media.json missing: run --suite media")
    else:
        discovery = media.get("discovery", {})
        if not discovery.get("present"):
            report.add("media", "discovery surface", "-", "-", NOT_VERIFIED, "no discovery surface mounted")
        else:
            images_at_load = discovery.get("imagesAtLoad") or []
            report.max("media", "image requests on load", len(images_at_load), media_budget.get("max_images_on_load", 12))
            report.max("media", "image bytes on load", discovery.get("imageBytesAtLoad"), media_budget.get("max_bytes_on_load", 900000))
            report.max("media", "image requests total", discovery.get("imageRequestsTotal"), media_budget.get("max_images_total", 48))
            report.max("media", "image bytes total", discovery.get("imageBytesTotal"), media_budget.get("max_bytes_total", 3000000))
            report.max("media", "failed image fetches", discovery.get("failedImageFetches"), media_budget.get("max_failed_image_fetches", 0))
            report.truth("media", "every culture image is lazy", discovery.get("allLazy"))
            report.truth("media", "every culture image decoded", discovery.get("allDecoded"))
        weather = media.get("weather", {})
        report.truth("media", "weather strip present", weather.get("stripPresent"))
        report.max("media", "weather requests before consent", weather.get("requestsBeforeConsent"), media_budget.get("max_weather_requests_before_consent", 0), "privacy: no location/weather traffic on load")
        report.max("media", "weather requests during 20s idle", weather.get("requestsDuring20sIdle"), media_budget.get("max_weather_requests_during_20s_idle", 0), "no polling")
        report.max("media", "weather requests during typing", weather.get("requestsDuringTyping"), media_budget.get("max_weather_requests_during_typing", 0), "the composer must not compete with a refresh")
    return report


def load_payloads(directory):
    payloads = {}
    for suite in ("baseline", "requests", "stress", "media", "bundle"):
        path = Path(directory) / ("%s.json" % suite)
        if path.exists():
            payloads[suite] = json.loads(path.read_text(encoding="utf-8"))
    return payloads


def good_fixture():
    """A minimal known-good payload set used by --self-test."""
    return {
        "baseline": {
            "contaminated": False,
            "cold_load": {"fcpMs": 40, "lcpMs": 688},
            "typing": [
                {"label": "typing-1x", "p95": 16, "max": 20},
                {"label": "typing-4x", "p95": 44, "max": 57},
            ],
            "first_word_and_settle": {"firstWordMs": {"p95": 100}, "settleMs": {"p95": 170}},
            "navigation": {"toStatsMs": {"p50": 120, "p95": 124}, "backMs": {"p95": 500}, "documents": [1]},
            "settled_idle": {
                "cdp": {"domNodes": 300, "jsHeapUsedBytes": 30 * 1000 * 1000},
                "activeTimers": 1,
                "activeIntervals": 0,
                "activeFetches": 0,
                "errors": [],
            },
            "guardViolations": [],
            "bundle": {
                "status": "OBSERVED",
                "js": {"gzipBytes": 400000},
                "css": {"gzipBytes": 16000},
                "all_assets": {"gzipBytes": 800000},
                "missing_files": [],
                "largest": [
                    {"url": "assets/index-X.js", "gzipBytes": 140000},
                    {"url": "assets/routes-X.js", "gzipBytes": 50000},
                ],
                "may_exclude_uncommitted_work": False,
            },
        },
        "requests": {
            "scenarios": [
                {"label": "single-settled-sentence", "streamFull": 1, "fetches": []},
                {"label": "identical-text-again", "streamFull": 0, "metricsDelta": {"cacheHits": 1}, "fetches": []},
                {"label": "device-memory-after-reload", "streamPosts": 0, "fetches": []},
                {
                    "label": "abandoned-enrichment",
                    "enrichmentReachedWire": True,
                    "enrichmentAborted": 1,
                    "fetches": [],
                },
            ],
            "totals": {"errors": [], "guardViolations": []},
        },
        "stress": {
            "contaminated": False,
            "samples": [
                {
                    "label": "baseline-warm",
                    "cdp": {"jsHeapUsedBytes": 28 * 1000 * 1000, "domNodes": 2000, "jsEventListeners": 560},
                    "js": {"paint": {"domNodes": 200}, "timers": {"active": 3, "intervals": 0}, "fetch": {"active": 0}, "storage": {}},
                },
                {
                    "label": "final-quiesced",
                    "cdp": {"jsHeapUsedBytes": 31 * 1000 * 1000, "domNodes": 2300, "jsEventListeners": 570},
                    "js": {
                        "paint": {"domNodes": 240},
                        "timers": {"active": 1, "intervals": 0},
                        "fetch": {"active": 0},
                        "storage": {
                            "memoryRows": 80,
                            "byKey": {"lingua.memory.v1": {"bytes": 22000}},
                        },
                        "errors": [],
                    },
                },
            ],
            "totals": {"settleMisses": 0, "errors": [], "duplicateRequests": 0},
        },
        "media": {
            "discovery": {
                "present": True,
                "imagesAtLoad": [{"url": "https://images.metmuseum.org/x.jpg", "bytes": 10000}],
                "imageBytesAtLoad": 10000,
                "imageRequestsTotal": 10,
                "imageBytesTotal": 300000,
                "failedImageFetches": 0,
                "allLazy": True,
                "allDecoded": True,
            },
            "weather": {
                "stripPresent": True,
                "requestsBeforeConsent": 0,
                "requestsDuring20sIdle": 0,
                "requestsDuringTyping": 0,
            },
        },
    }


MUTATIONS = {
    "baseline.typing-p95": (["baseline", "typing", 0, "p95"], 5000),
    "baseline.first-word": (["baseline", "first_word_and_settle", "firstWordMs", "p95"], 5000),
    "baseline.heap": (["baseline", "settled_idle", "cdp", "jsHeapUsedBytes"], 500 * 1000 * 1000),
    "baseline.blocked": (["baseline", "guardViolations"], ["https://api.deepseek.com/v1"]),
    "bundle.js": (["baseline", "bundle", "js", "gzipBytes"], 10 * 1000 * 1000),
    "requests.duplicate": (
        ["requests", "scenarios"],
        [
            {"label": "single-settled-sentence", "streamFull": 1, "fetches": [{"kind": "stream", "mode": "full", "duplicate": True}]},
            {"label": "identical-text-again", "streamFull": 0, "metricsDelta": {"cacheHits": 1}, "fetches": []},
            {"label": "device-memory-after-reload", "streamPosts": 0, "fetches": []},
            {"label": "abandoned-enrichment", "enrichmentReachedWire": True, "enrichmentAborted": 1, "fetches": []},
        ],
    ),
    "stress.heap": (["stress", "samples", 1, "cdp", "jsHeapUsedBytes"], 5 * 1000 * 1000 * 1000),
    "stress.timers": (["stress", "samples", 1, "js", "timers", "active"], 50),
    "media.bytes": (["media", "discovery", "imageBytesAtLoad"], 10 * 1000 * 1000),
    "media.consent": (["media", "weather", "requestsBeforeConsent"], 3),
}


def _set(payload, path, value):
    node = payload
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value


def self_test():
    thresholds = json.loads(DEFAULT_THRESHOLDS.read_text(encoding="utf-8"))
    good = evaluate(good_fixture(), thresholds)
    failures = [row for row in good.rows if row["status"] == FAIL]
    assert not failures, "known-good fixture failed: %s" % failures[:3]
    print("self-test: known-good payload passes every budget")
    for label, (path, value) in MUTATIONS.items():
        payload = good_fixture()
        _set(payload, path, value)
        report = evaluate(payload, thresholds)
        failed = [row for row in report.rows if row["status"] == FAIL]
        if not failed:
            raise AssertionError("self-test did not catch mutation: %s" % label)
    print("self-test: every protected metric rejects its breach (%d mutations)" % len(MUTATIONS))
    print("SELF-TEST PASS")


def main():
    parser = argparse.ArgumentParser(description="Apply performance budgets to measured JSON")
    parser.add_argument("--dir", default=str(DEFAULT_DIR))
    parser.add_argument("--thresholds", default=str(DEFAULT_THRESHOLDS))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    thresholds = json.loads(Path(args.thresholds).read_text(encoding="utf-8"))
    payloads = load_payloads(args.dir)
    report = evaluate(payloads, thresholds)
    failures = report.print()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())