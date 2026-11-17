"""Rerunnable performance, stress and request-accounting harness.

Every provider call is faked in the page (deterministic stream, no network), the dev
server is the only reachable origin, and every number below is read back from the page
or from Chrome DevTools Protocol measurements. Nothing here starts or stops the dev
server and nothing calls a paid provider.

    python3 scripts/perf/run_perf.py --suite baseline
    python3 scripts/perf/run_perf.py --suite requests
    python3 scripts/perf/run_perf.py --suite stress          # bounded long-session loop
    python3 scripts/perf/run_perf.py --suite media
    python3 scripts/perf/run_perf.py --suite bundle
    python3 scripts/perf/run_perf.py --suite all --gate

Results are written to artifacts/phase2/perf/<suite>.json (gitignored). With --gate the
budgets in scripts/perf/thresholds.json are applied by tests/perf/check_budgets.py.
"""
import argparse
import asyncio
import gzip
import json
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import perf_lib  # noqa: E402

REPO_ROOT = perf_lib.REPO_ROOT
ARTIFACTS = perf_lib.ARTIFACTS
THRESHOLDS = HERE / "thresholds.json"
CHECKER = REPO_ROOT / "tests" / "perf" / "check_budgets.py"

ADJECTIVES = [
    "ruhige", "klare", "warme", "leise", "offene", "freundliche", "schnelle",
    "alte", "junge", "helle", "dunkle", "weite", "kleine", "grosse", "stille",
    "lebendige", "genaue", "einfache", "echte", "neue",
]
NOUNS = [
    "Morgen", "Abend", "Garten", "Stimme", "Weg", "Blick", "Wort", "Haus",
    "Licht", "Gespräch", "Frage", "Antwort", "Gedanke", "Buch", "Zeit",
]
VERBS = [
    "bleibt", "wirkt", "klingt", "wächst", "öffnet", "trägt", "zeigt",
    "sucht", "findet", "erzählt", "erklärt", "verbindet", "beginnt",
]


def corpus_sentence(i):
    """A unique, number-free German sentence for cycle i (no digits: verification-safe)."""
    adj = ADJECTIVES[i % len(ADJECTIVES)]
    noun = NOUNS[(i // len(ADJECTIVES)) % len(NOUNS)]
    verb = VERBS[(i // (len(ADJECTIVES) * len(NOUNS))) % len(VERBS)]
    tail = ["heute", "hier", "still", "weiter", "langsam"][i % 5]
    return "Der %s %s %s %s." % (adj, noun, verb, tail)


def _percent(values, p):
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    vals = sorted(vals)
    idx = min(len(vals) - 1, max(0, int(round((p / 100.0) * len(vals) + 0.5)) - 1))
    return round(vals[idx], 2)


def _dict_percentiles(values):
    clean = [v for v in values if v is not None]
    return {
        "n": len(clean),
        "p50": _percent(clean, 50),
        "p95": _percent(clean, 95),
        "max": round(max(clean), 2) if clean else None,
    }


# ---------------------------------------------------------------------------
# Bundle size from the existing build artefact (never built by this harness)
# ---------------------------------------------------------------------------


def measure_bundle():
    public = REPO_ROOT / ".output" / "public"
    sw = public / "sw.js"
    result = {
        "status": "NOT_VERIFIED",
        "reason": "no production build output (.output/public/sw.js) is present; the lead "
        "owns the production build, and this harness does not build",
    }
    if not sw.exists():
        return result
    text = sw.read_text(encoding="utf-8", errors="ignore")
    urls = re.findall('url:"([^"]+)"', text)
    if not urls:
        result["reason"] = "sw.js has no precache manifest"
        return result
    assets = []
    missing = []
    for url in urls:
        path = public / url
        if not path.exists():
            missing.append(url)
            continue
        data = path.read_bytes()
        compressed = gzip.compress(data, 9)
        assets.append({"url": url, "bytes": len(data), "gzipBytes": len(compressed)})
    by_kind = {}
    for asset in assets:
        ext = Path(asset["url"]).suffix or "other"
        bucket = by_kind.setdefault(ext, {"count": 0, "bytes": 0, "gzipBytes": 0})
        bucket["count"] += 1
        bucket["bytes"] += asset["bytes"]
        bucket["gzipBytes"] += asset["gzipBytes"]
    js = [a for a in assets if a["url"].endswith(".js")]
    css = [a for a in assets if a["url"].endswith(".css")]
    stat = sw.stat()
    newest_src = max(
        (p.stat().st_mtime for p in (REPO_ROOT / "src").rglob("*") if p.is_file()),
        default=0,
    )
    return {
        "status": "OBSERVED",
        "source": "existing .output/public build, precache manifest read from sw.js",
        "build_mtime": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(stat.st_mtime)),
        "newest_source_mtime": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(newest_src)),
        "may_exclude_uncommitted_work": newest_src > stat.st_mtime,
        "file_count": len(urls),
        "missing_files": missing,
        "js": {
            "count": len(js),
            "bytes": sum(a["bytes"] for a in js),
            "gzipBytes": sum(a["gzipBytes"] for a in js),
        },
        "css": {
            "count": len(css),
            "bytes": sum(a["bytes"] for a in css),
            "gzipBytes": sum(a["gzipBytes"] for a in css),
        },
        "all_assets": {
            "count": len(assets),
            "bytes": sum(a["bytes"] for a in assets),
            "gzipBytes": sum(a["gzipBytes"] for a in assets),
        },
        "by_kind": by_kind,
        "largest": sorted(assets, key=lambda a: a["bytes"], reverse=True)[:10],
        "note": "The lead rebuilds the production bundle for final gates; these sizes "
        "describe the build artefact that exists on disk, not a bundle this task made.",
    }


# ---------------------------------------------------------------------------
# Suites
# ---------------------------------------------------------------------------


async def suite_baseline(args):
    measurements = {"suite": "baseline", "environment": None, "bundle": measure_bundle()}
    h = await perf_lib.Harness.launch(cpu_throttle=1)
    try:
        measurements["environment"] = h.environment
        await h.goto()
        await h.ensure_target_ar()
        await h.page.wait_for_timeout(300)
        load = await h.sample("cold-load", gauge=True)
        resources = await h.resource_summary()
        measurements["cold_load"] = {
            "fcpMs": load["js"]["paint"]["fcp"],
            "lcpMs": load["js"]["paint"]["lcp"],
            "domNodes": load["js"]["paint"]["domNodes"],
            "cdpDomNodes": load["cdp"]["domNodes"],
            "jsEventListeners": load["cdp"]["jsEventListeners"],
            "jsHeapUsedBytes": load["cdp"]["jsHeapUsedBytes"],
            "jsHeapTotalBytes": load["cdp"]["jsHeapTotalBytes"],
            "documents": load["cdp"]["documents"],
            "activeTimers": load["js"]["timers"]["active"],
            "activeIntervals": load["js"]["timers"]["intervals"],
            "resourceCount": resources["total"]["count"],
            "resourceBytes": resources["total"]["transferSize"],
            "resourceDecodedBytes": resources["total"]["decodedBodySize"],
            "resourcesByInitiator": resources["byType"],
            "guardViolations": h.guard_violations[:5],
        }

        # Warm the app (module graph + fonts are dev-server transforms on the first visit).
        warmup_requests = []
        for i in range(2):
            await h.clear_draft()
            await h.reset_cycle()
            seq = (await h.snapshot())["fetch"]["seq"]
            await h.type_text(corpus_sentence(900 + i), delay_ms=5)
            try:
                await h.wait_settle(timeout_ms=15_000)
            except Exception:
                pass
            warmup_requests.extend(await h.fetch_since(seq))
        measurements["warmup"] = {"fetches": warmup_requests}

        # 1. Typing responsiveness: a ~44-character burst on a warm screen.
        typing = []
        for label, throttle, sentence in [
            ("typing-1x", 1, corpus_sentence(950)),
            ("typing-4x", 4, corpus_sentence(951)),
        ]:
            await h.cdp.send("Emulation.setCPUThrottlingRate", {"rate": throttle})
            await h.clear_draft()
            await h.reset_cycle()
            before = await h.snapshot()
            await h.type_text(sentence, delay_ms=10)
            after = await h.snapshot()
            typing.append(
                {
                    "label": label,
                    "cpuThrottle": throttle,
                    "inputEvents": after["input"]["count"] - before["input"]["count"],
                    "p50": after["input"]["p50"],
                    "p95": after["input"]["p95"],
                    "max": after["input"]["max"],
                    "eventTimingEntries": after["paint"]["eventTiming"],
                    "eventTimingMaxMs": after["paint"]["eventTimingMax"],
                    "longTasks": after["paint"]["longTasks"],
                    "longTaskMaxMs": after["paint"]["longTaskMax"],
                    "pendingPaintFrames": after["input"]["pendingFrames"],
                }
            )
            await h.page.wait_for_timeout(700)
        await h.cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
        measurements["typing"] = typing

        # 2. First streamed word and settled answer, request-relative.
        cycles = []
        for i in range(4):
            sentence = corpus_sentence(700 + i)
            await h.clear_draft()
            await h.reset_cycle()
            seq = (await h.snapshot())["fetch"]["seq"]
            # Type at a pace that lets live streams start (the real scheduler's starved path).
            await h.type_text(sentence[:-1], delay_ms=70)
            try:
                await h.wait_first_word(timeout_ms=8_000)
            except Exception:
                pass
            await h.type_text(sentence[-1], delay_ms=20)
            try:
                settled = await h.wait_settle(timeout_ms=15_000)
            except Exception:
                settled = None
            await h.page.wait_for_timeout(150)
            fetches = await h.fetch_since(seq)
            live = [f for f in fetches if f["kind"] == "stream" and f["mode"] == "live"]
            full = [f for f in fetches if f["kind"] == "stream" and f["mode"] == "full"]
            first_paint_source = next(
                (f for f in live if f["chunks"] > 0), live[0] if live else None
            )
            cycles.append(
                {
                    "sentence": sentence,
                    "firstWordMs": round(settled["firstWordAt"] - first_paint_source["startedAt"], 2)
                    if settled and settled.get("firstWordAt") and first_paint_source
                    else None,
                    "settleMs": round(settled["settledAt"] - full[0]["startedAt"], 2)
                    if settled and settled.get("settledAt") and full
                    else None,
                    "liveRequests": len(live),
                    "abortedLive": len([f for f in live if f["aborted"]]),
                    "fullRequests": len(full),
                    "settled": bool(settled),
                }
            )
        measurements["first_word_and_settle"] = {
            "cycles": cycles,
            "firstWordMs": _dict_percentiles([c["firstWordMs"] for c in cycles]),
            "settleMs": _dict_percentiles([c["settleMs"] for c in cycles]),
        }

        # 3. Navigation round-trip (SPA; must stay one document).
        navigation = await h.nav_roundtrip(rounds=5)
        measurements["navigation"] = {
            "rounds": navigation,
            "toStatsMs": _dict_percentiles([n["toStatsMs"] for n in navigation]),
            "backMs": _dict_percentiles([n["backMs"] for n in navigation]),
            "documents": sorted(set(n["documents"] for n in navigation)),
        }

        # 4. Settled idle sample: activity that remains after the screen settles.
        await h.clear_draft()
        await h.reset_cycle()
        await h.type_text(corpus_sentence(800), delay_ms=5)
        try:
            await h.wait_settle(timeout_ms=15_000)
        except Exception:
            pass
        await h.page.wait_for_timeout(2000)
        idle = await h.sample("settled-idle", gauge=True)
        measurements["settled_idle"] = {
            "cdp": idle["cdp"],
            "paintDomNodes": idle["js"]["paint"]["domNodes"],
            "rendererNodes": idle["cdp"]["domNodes"],
            "activeTimers": idle["js"]["timers"]["active"],
            "timersPeak": idle["js"]["timers"]["peak"],
            "activeIntervals": idle["js"]["timers"]["intervals"],
            "activeFetches": idle["js"]["fetch"]["active"],
            "inputCount": idle["js"]["input"]["count"],
            "metrics": idle["js"]["metrics"],
            "storage": idle["js"]["storage"],
            "errors": idle["js"]["errors"],
            "guardViolations": h.guard_violations[:5],
        }
        measurements["long_tasks_total"] = idle["js"]["paint"]["longTasks"]
        measurements["long_task_max_ms"] = idle["js"]["paint"]["longTaskMax"]
        measurements["event_timing_total"] = idle["js"]["paint"]["eventTiming"]
        measurements["contaminated"] = await h.reloaded_during_run()
        measurements["guardViolations"] = h.guard_violations[:10]
    finally:
        await h.close()
    return measurements


async def suite_requests(args):
    """Per-scenario request accounting: what leaves the page and what is abandoned."""
    measure = {"suite": "requests", "environment": None}
    h = await perf_lib.Harness.launch(mock={"enrichmentDelayMs": 800}, cpu_throttle=1)
    try:
        measure["environment"] = h.environment
        await h.goto()
        await h.ensure_target_ar()
        scenarios = []

        async def run_scenario(label, fn):
            await h.clear_draft()
            await h.page.wait_for_timeout(120)
            seq = (await h.snapshot())["fetch"]["seq"]
            metrics_before = (await h.snapshot())["metrics"]
            extra = await fn() or {}
            await h.page.wait_for_timeout(1100)
            fetches = await h.fetch_since(seq)
            metrics_after = (await h.snapshot())["metrics"]
            streams = [f for f in fetches if f["kind"] == "stream" and f["method"] == "POST"]
            enrichments = [f for f in fetches if f["kind"] == "serverFn"]
            delta = {}
            for key, value in (metrics_after or {}).items():
                if isinstance(value, (int, float)) and isinstance((metrics_before or {}).get(key), (int, float)):
                    delta[key] = value - metrics_before[key]
            if extra.get("reloaded"):
                # The counters are per document; a reload resets them, so a delta across
                # it is meaningless. The scenario reports the absolute after-state instead.
                delta = None
            scenario_record = {
                    "label": label,
                    "fetches": [
                        {k: f[k] for k in ("kind", "method", "mode", "startedAt", "endedAt", "chunks", "aborted", "duplicate")}
                        for f in fetches
                    ],
                    "streamPosts": len(streams),
                    "streamLive": len([f for f in streams if f["mode"] == "live"]),
                    "streamFull": len([f for f in streams if f["mode"] == "full"]),
                    "streamAborted": len([f for f in streams if f["aborted"]]),
                    "enrichmentRequests": len(enrichments),
                    "enrichmentAborted": len([f for f in enrichments if f["aborted"]]),
                    "warmGets": len([f for f in fetches if f["kind"] == "stream" and f["method"] == "GET"]),
                    "metricsDelta": delta,
                    "metricsAfter": {
                        key: metrics_after.get(key)
                        for key in ("requests", "cacheHits", "deduped")
                    }
                    if metrics_after
                    else None,
                    **extra,
                }
            scenarios.append(scenario_record)

        async def one_cycle():
            await h.reset_cycle()
            await h.type_text(corpus_sentence(500), delay_ms=5)
            try:
                await h.wait_settle(timeout_ms=15_000)
            except Exception:
                pass
            return {}

        await run_scenario("single-settled-sentence", one_cycle)

        async def burst():
            await h.reset_cycle()
            sentence = corpus_sentence(501)
            await h.type_text(sentence[:-1], delay_ms=8)
            await h.page.wait_for_timeout(80)
            await h.type_text(sentence[-1], delay_ms=10)
            try:
                await h.wait_settle(timeout_ms=15_000)
            except Exception:
                pass
            return {}

        await run_scenario("typing-burst-cancellation", burst)

        async def identical():
            await h.reset_cycle()
            await h.type_text(corpus_sentence(500), delay_ms=4)
            try:
                await h.wait_settle(timeout_ms=15_000)
            except Exception:
                pass
            return {}

        await run_scenario("identical-text-again", identical)

        async def memory_after_reload():
            await h.page.reload(wait_until="load")
            # This reload is intentional: re-anchor the contamination baseline so only an
            # unexpected second reload (HMR/another edit) is reported.
            h.environment["time_origin"] = await h.page.evaluate("() => performance.timeOrigin")
            await h.page.locator("textarea").first.wait_for(state="visible", timeout=30_000)
            await h.page.wait_for_function(
                "() => window.__perf && window.__perf.startedAt > 0", timeout=10_000
            )
            await h.ensure_target_ar()
            await h.clear_draft()
            await h.reset_cycle()
            await h.type_text(corpus_sentence(500), delay_ms=4)
            served = False
            try:
                await h.wait_settle(timeout_ms=15_000)
                served = True
            except Exception:
                pass
            return {"settledAfterReload": served, "reloaded": True}

        await run_scenario("device-memory-after-reload", memory_after_reload)

        async def abandoned_enrichment():
            await h.reset_cycle()
            await h.type_text(corpus_sentence(502), delay_ms=4)
            try:
                await h.wait_settle(timeout_ms=15_000)
            except Exception:
                pass
            # Wait until a quiet enrichment request has actually reached the mocked wire,
            # then replace the draft. The queue forwards the task signal to fetch (A01), so
            # the superseded request must be aborted at the wire instead of finishing.
            seq2 = (await h.snapshot())["fetch"]["seq"]
            started = False
            deadline = time.time() + 6
            while time.time() < deadline:
                recs = await h.fetch_since(seq2)
                if any(f["kind"] == "serverFn" for f in recs):
                    started = True
                    break
                await asyncio.sleep(0.05)
            await h.type_text("x", delay_ms=5)
            await h.page.wait_for_timeout(250)
            await h.clear_draft()
            await h.page.wait_for_timeout(200)
            return {"enrichmentReachedWire": started}

        await run_scenario("abandoned-enrichment", abandoned_enrichment)

        async def known_after_idle():
            await h.page.wait_for_timeout(900)
            await h.reset_cycle()
            await h.type_text(corpus_sentence(500), delay_ms=4)
            try:
                await h.wait_settle(timeout_ms=15_000)
            except Exception:
                pass
            return {}

        await run_scenario("known-sentence-after-idle", known_after_idle)

        measure["scenarios"] = scenarios
        snap = await h.snapshot()
        measure["totals"] = {
            "fetchByKind": snap["fetch"]["byKind"],
            "streamsStarted": snap["fetch"]["streamsStarted"],
            "streamsCompleted": snap["fetch"]["streamsCompleted"],
            "streamsAborted": snap["fetch"]["streamsAborted"],
            "abortedEnrichment": snap["fetch"]["abortedEnrichment"],
            "duplicateRequests": snap["fetch"]["duplicateRequests"],
            "metrics": snap["metrics"],
            "errors": snap["errors"],
            "guardViolations": h.guard_violations[:10],
        }
        measure["contaminated"] = await h.reloaded_during_run()
        measure["guardViolations"] = h.guard_violations[:10]
    finally:
        await h.close()
    return measure


async def suite_stress(args):
    """Bounded synthetic long-session: N translate cycles + language/style churn + sheets."""
    cycles = args.cycles
    measure = {
        "suite": "stress",
        "environment": None,
        "params": {"translateCycles": cycles, "languageStyleChanges": args.changes, "sheetOpens": args.sheets},
    }
    h = await perf_lib.Harness.launch(cpu_throttle=1)
    try:
        measure["environment"] = h.environment
        await h.goto()
        await h.ensure_target_ar()
        await h.page.wait_for_timeout(400)
        samples = []
        errors = []
        settle_misses = 0
        cycle_records = []
        started = time.time()
        samples.append(await h.sample("baseline-warm"))
        for i in range(cycles):
            await h.clear_draft()
            await h.reset_cycle()
            seq = (await h.snapshot())["fetch"]["seq"]
            sentence = corpus_sentence(i)
            await h.type_text(sentence, delay_ms=5)
            try:
                await h.wait_settle(timeout_ms=6_000)
            except Exception:
                settle_misses += 1
                if settle_misses >= 8:
                    errors.append({"fatal": "settle missed %d times" % settle_misses})
                    break
            if i % 25 == 24:
                fetches = await h.fetch_since(seq)
                cycle_records.append(
                    {
                        "cycle": i,
                        "fetches": [
                            {"kind": f["kind"], "mode": f["mode"], "aborted": f["aborted"]}
                            for f in fetches
                        ],
                    }
                )
                samples.append(await h.sample("cycle-%d" % (i + 1)))
            if i % 50 == 49:
                await h.page.wait_for_timeout(150)
        # Language/style churn: clicks with no wait, like a person flicking through options.
        for i in range(args.changes):
            if i % 2 == 0:
                style = ["Natural", "Formal", "Casual"][(i // 2) % 3]
                try:
                    await h.page.get_by_role("radio", name=style).first.click(timeout=3_000)
                except Exception:
                    pass
            else:
                try:
                    await h.page.locator("button[aria-label='Swap languages']").first.click(timeout=3_000)
                except Exception:
                    pass
            await h.page.wait_for_timeout(25)
            if i % 50 == 49:
                samples.append(await h.sample("language-style-%d" % (i + 1)))
        await h.page.wait_for_timeout(1200)
        samples.append(await h.sample("after-language-style"))
        # Overlay churn: the cultural discovery detail is the product's detail overlay now
        # that the section exists; the saved-phrases sheet is the fallback.
        opened = 0
        culture = h.page.locator("section").filter(has=h.page.get_by_text("Culture in context", exact=True)).first
        culture_present = (await culture.count()) > 0
        if culture_present:
            try:
                await culture.scroll_into_view_if_needed(timeout=15_000)
                await culture.locator("article button[aria-haspopup='dialog']").first.wait_for(timeout=40_000)
            except Exception:
                culture_present = False
            if culture_present:
                samples.append(await h.sample("culture-mounted"))
        for i in range(args.sheets):
            try:
                if culture_present:
                    opener = culture.locator("article button[aria-haspopup='dialog']").first
                    await opener.click(timeout=6_000)
                    dialog = h.page.locator("[role='dialog'][aria-modal='true']").last
                else:
                    saved = h.page.locator(
                        "header button[aria-label='Saved'], header button[aria-label='المحفوظة'], header button[aria-label='Gemerkt']"
                    ).first
                    await saved.click(timeout=6_000)
                    dialog = h.page.get_by_role("dialog").first
                await dialog.wait_for(state="visible", timeout=10_000)
                opened += 1
                await h.page.keyboard.press("Escape")
                await dialog.wait_for(state="detached", timeout=10_000)
            except Exception:
                try:
                    await h.page.keyboard.press("Escape")
                except Exception:
                    pass
            if i % 25 == 24:
                samples.append(await h.sample("sheets-%d" % (i + 1)))
            await h.page.wait_for_timeout(80)
        measure["cultureDetailPresent"] = culture_present
        # Quiesce: let every queued enrichment finish or time out.
        await h.page.wait_for_timeout(2500)
        final = await h.sample("final-quiesced", gauge=True)
        samples.append(final)
        snap = final["js"]
        measure["samples"] = samples
        measure["totals"] = {
            "elapsedSeconds": round(time.time() - started, 1),
            "settleMisses": settle_misses,
            "sheetOpens": opened,
            "fetchByKind": snap["fetch"]["byKind"],
            "duplicateRequests": snap["fetch"]["duplicateRequests"],
            "streamsStarted": snap["fetch"]["streamsStarted"],
            "streamsCompleted": snap["fetch"]["streamsCompleted"],
            "streamsAborted": snap["fetch"]["streamsAborted"],
            "abortedEnrichment": snap["fetch"]["abortedEnrichment"],
            "finalActiveFetches": snap["fetch"]["active"],
            "finalActiveTimers": snap["timers"]["active"],
            "finalActiveIntervals": snap["timers"]["intervals"],
            "metrics": snap["metrics"],
            "errors": snap["errors"],
            "guardViolations": h.guard_violations[:10],
            "storage": snap["storage"],
        }
        measure["errors"] = errors
        measure["cycle_records"] = cycle_records
        measure["contaminated"] = await h.reloaded_during_run()
        measure["guardViolations"] = h.guard_violations[:10]
    finally:
        await h.close()
    return measure


def _iso(epoch_ms):
    return time.strftime("%Y-%m-%dT%H:%M:%S+01:00", time.gmtime(epoch_ms // 1000))


def _weather_snapshot():
    now = int(time.time() * 1000)
    hours = [
        {
            "time": _iso(now + index * 3_600_000),
            "temperature": round(5.3 + index * 0.2, 1),
            "precipitationProbability": 30,
            "symbol": "rain",
        }
        for index in range(12)
    ]
    days = [
        {
            "date": time.strftime("%Y-%m-%d", time.gmtime((now + index * 86_400_000) // 1000)),
            "min": 3.0,
            "max": 8.5,
            "precipitationProbability": 60,
            "symbol": "rain",
        }
        for index in range(4)
    ]
    return {
        "version": 1,
        "provider": "open-meteo",
        "place": {
            "id": "open-meteo:52.52:13.40",
            "name": "",
            "latitude": 52.52,
            "longitude": 13.4,
            "timeZone": "Europe/Berlin",
        },
        "units": "metric",
        "fetchedAt": now,
        "current": {
            "time": _iso(now),
            "temperature": 5.3,
            "apparentTemperature": 2.1,
            "humidity": 81,
            "windSpeed": 14.8,
            "windDirection": 129,
            "symbol": "rain",
            "isDay": False,
        },
        "hourly": hours,
        "daily": days,
        "attribution": {
            "provider": "open-meteo",
            "text": "Weather data by Open-Meteo.com",
            "url": "https://open-meteo.com/",
            "license": "CC BY 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        },
    }


def _fetch_image_bytes(url):
    """Fetch a culture image once through the harness so its byte size is real, not invented."""
    import urllib.request

    request = urllib.request.Request(url, headers={"User-Agent": "today-perf-harness/1.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read(8_000_000)
        return data, response.headers.get("content-type", "image/jpeg")


async def suite_media(args):
    """Image/network budget for the discovery surface and the weather refresh cadence."""
    measure = {"suite": "media", "environment": None}
    h = await perf_lib.Harness.launch(mock={"allowApi": True}, geolocation=True)
    image_requests = []
    weather_requests = []
    place_requests = []
    image_cache = {}
    try:
        async def image_route(route):
            url = route.request.url
            entry = {"url": url, "at": time.time()}
            try:
                if url not in image_cache:
                    loop = asyncio.get_event_loop()
                    image_cache[url] = await loop.run_in_executor(None, _fetch_image_bytes, url)
                data, content_type = image_cache[url]
                entry["bytes"] = len(data)
                entry["ok"] = True
                image_requests.append(entry)
                await route.fulfill(status=200, content_type=content_type, body=data)
            except Exception as exc:
                entry["ok"] = False
                entry["error"] = type(exc).__name__
                image_requests.append(entry)
                await route.fulfill(status=404, body="")

        # The same allowlisted host set the app/CSP uses (src/lib/culture/media-hosts.json).
        for host in ("images.metmuseum.org",):
            await h.context.route("https://%s/**" % host, image_route)

        async def place_route(route):
            place_requests.append({"at": time.time()})
            place = {
                "id": "open-meteo:52.52:13.40",
                "name": "Berlin",
                "latitude": 52.52,
                "longitude": 13.4,
                "countryCode": "DE",
                "admin": "Berlin",
                "timeZone": "Europe/Berlin",
                "source": "geolocation",
                "placeCredit": "Place name © OpenStreetMap contributors",
            }
            await route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"ok": True, "places": [place]}),
            )

        async def weather_route(route):
            weather_requests.append({"at": time.time()})
            await route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"ok": True, "snapshot": _weather_snapshot()}),
            )

        await h.context.route("**/api/weather/place", place_route)
        await h.context.route("**/api/weather", weather_route)

        async def wait_images_stable(previous, settle_ms=700, timeout_ms=12_000):
            last = previous
            stable_since = time.monotonic()
            deadline = time.monotonic() + timeout_ms / 1000.0
            while time.monotonic() < deadline:
                if len(image_requests) != last:
                    last = len(image_requests)
                    stable_since = time.monotonic()
                elif (time.monotonic() - stable_since) * 1000 >= settle_ms:
                    return last
                await asyncio.sleep(0.1)
            return len(image_requests)

        measure["environment"] = h.environment
        await h.goto()
        await h.ensure_target_ar()
        await h.page.wait_for_timeout(900)
        initial = await h.snapshot()
        resources = await h.resource_summary()
        images_at_load = await wait_images_stable(0)
        weather_before_consent = len(weather_requests)
        viewport_info = await h.page.evaluate(
            """() => {
              const strip = document.querySelector('[data-weather-strip]');
              const rect = strip ? strip.getBoundingClientRect() : null;
              return {
                viewportHeight: window.innerHeight,
                pageHeight: document.body.scrollHeight,
                weatherTop: rect ? Math.round(rect.top) : null,
                weatherBottom: rect ? Math.round(rect.bottom) : null,
              };
            }"""
        )
        strip_present = await h.page.locator("[data-weather-strip]").count()

        # Scroll to the weather strip (the discovery section is deferred until approached).
        try:
            await h.page.locator("[data-weather-strip]").first.scroll_into_view_if_needed(timeout=15_000)
        except Exception:
            pass
        images_after_weather_scroll = await wait_images_stable(images_at_load)

        # Explicit location consent is the only path that may start weather traffic.
        enabled = False
        try:
            await h.page.get_by_role("button", name="Use my location").first.click(timeout=6_000)
            enabled = True
        except Exception:
            pass
        await h.page.wait_for_timeout(3000)
        weather_after_enable = len(weather_requests)
        place_after_enable = len(place_requests)

        # No polling: with a fresh snapshot nothing may refresh on its own.
        before_idle = len(weather_requests)
        await h.page.wait_for_timeout(20_000)
        weather_during_idle_20s = len(weather_requests) - before_idle

        # The composer being busy must not compete with a background refresh.
        await h.page.locator("#composer").scroll_into_view_if_needed(timeout=10_000)
        before_typing = len(weather_requests)
        await h.page.locator("#composer").click()
        await h.page.keyboard.type("Der ruhige Morgen bleibt hier.", delay=8)
        await h.page.wait_for_timeout(1500)
        weather_during_typing = len(weather_requests) - before_typing
        await h.page.locator("#composer").fill("")
        await h.page.wait_for_timeout(600)

        # One manual refresh is one request: the strip's visible refresh lives in its
        # forecast sheet (the strip row itself only opens that sheet).
        manual_refresh_clicked = False
        try:
            await h.page.locator("[data-weather-strip]").first.scroll_into_view_if_needed(timeout=10_000)
            await h.page.locator("[data-strip-main]").first.click(timeout=6_000)
            await h.page.locator("[data-sheet-refresh]").first.click(timeout=6_000)
            manual_refresh_clicked = True
        except Exception:
            pass
        await h.page.wait_for_timeout(2500)
        weather_after_manual_refresh = len(weather_requests)
        try:
            await h.page.keyboard.press("Escape")
            await h.page.wait_for_timeout(300)
        except Exception:
            pass

        # Cultural discovery: count image requests before/after the feed mounts and after
        # the catalog grows. Lazy decoding is asynchronous, so each phase waits until the
        # request count has been stable for a moment before it is recorded.

        culture = h.page.locator("section").filter(has=h.page.get_by_text("Culture in context", exact=True)).first
        culture_present = (await culture.count()) > 0
        images_before_culture_mount = len(image_requests)
        culture_info = {
            "present": culture_present,
            "imagesAtLoad": images_at_load,
            "imagesAfterWeatherScroll": images_after_weather_scroll,
            "imagesBeforeCultureScroll": images_before_culture_mount,
        }
        if culture_present:
            try:
                await culture.scroll_into_view_if_needed(timeout=15_000)
            except Exception:
                pass
            try:
                await culture.locator("article").first.wait_for(timeout=40_000)
            except Exception:
                pass
            await h.page.wait_for_timeout(1200)
            images_after_mount = await wait_images_stable(images_before_culture_mount)
            img_meta = await h.page.evaluate(
                """() => {
                  const section = Array.from(document.querySelectorAll('section'))
                    .find((s) => (s.textContent || '').includes('Culture in context'));
                  if (!section) return [];
                  return Array.from(section.querySelectorAll('img')).map((img) => ({
                    src: (img.currentSrc || img.src || '').slice(0, 120),
                    loading: img.getAttribute('loading'),
                    decoding: img.getAttribute('decoding'),
                    complete: img.complete,
                    naturalWidth: img.naturalWidth,
                    width: img.getAttribute('width'),
                    height: img.getAttribute('height'),
                  }));
                }"""
            )
            cards_before_scroll = await culture.locator("article").count()
            more_clicks = 0
            more_counts = []
            for _ in range(3):
                try:
                    more = h.page.get_by_role("button", name="More discoveries").last
                    if not (await more.count()) or not (await more.is_visible()):
                        break
                    await more.click(timeout=5_000)
                    more_clicks += 1
                    await h.page.wait_for_timeout(700)
                    images_stable = await wait_images_stable(len(image_requests), settle_ms=500)
                    more_counts.append(
                        {
                            "cards": await culture.locator("article").count(),
                            "imageRequests": images_stable,
                        }
                    )
                except Exception:
                    break
            images_after_more = len(image_requests)
            height = await h.page.evaluate("() => document.body.scrollHeight")
            for step in range(1, 9):
                await h.page.evaluate("(y) => window.scrollTo(0, y)", int(height * step / 8))
                await h.page.wait_for_timeout(500)
                height = await h.page.evaluate("() => document.body.scrollHeight")
            images_after_scroll = await wait_images_stable(images_after_more)
            cards_after_scroll = await culture.locator("article").count()

            def bytes_between(first, last):
                return sum(r.get("bytes", 0) for r in image_requests[first:last] if r.get("ok"))

            culture_info.update(
                {
                    "cardsBeforeScroll": cards_before_scroll,
                    "cardsAfterScroll": cards_after_scroll,
                    "moreClicks": more_clicks,
                    "moreCounts": more_counts,
                    "imageBytesAtLoad": sum(r.get("bytes", 0) for r in image_requests[:images_at_load] if r.get("ok")),
                    "imagesOnMount": images_after_mount - images_before_culture_mount,
                    "imagesAfterMore": images_after_more - images_after_mount,
                    "imagesAfterScroll": images_after_scroll - images_after_more,
                    "imageRequestsTotal": len(image_requests),
                    "imageBytesOnMount": bytes_between(images_before_culture_mount, images_after_mount),
                    "imageBytesAfterMore": bytes_between(images_after_mount, images_after_more),
                    "imageBytesAfterScroll": bytes_between(images_after_more, images_after_scroll),
                    "imageBytesTotal": sum(r.get("bytes", 0) for r in image_requests if r.get("ok")),
                    "failedImageFetches": len([r for r in image_requests if not r.get("ok")]),
                    "images": img_meta,
                    "viewport": viewport_info,
                    "imagesAtLoad": [
                        {"url": r["url"], "bytes": r.get("bytes"), "ok": r.get("ok")}
                        for r in image_requests[:images_at_load]
                    ],
                    "allLazy": all(i.get("loading") == "lazy" for i in img_meta) if img_meta else None,
                    "allDecoded": all(
                        i.get("complete") and (i.get("naturalWidth") or 0) > 0 for i in img_meta
                    )
                    if img_meta
                    else None,
                }
            )
        measure["discovery"] = culture_info
        measure["weather"] = {
            "stripPresent": strip_present > 0,
            "locationConsentGiven": enabled,
            "requestsBeforeConsent": weather_before_consent,
            "requestsAfterEnable": weather_after_enable,
            "placeRequestsAfterEnable": place_after_enable,
            "requestsDuring20sIdle": weather_during_idle_20s,
            "requestsDuringTyping": weather_during_typing,
            "manualRefreshClicked": manual_refresh_clicked,
            "requestsAfterManualRefresh": weather_after_manual_refresh - weather_after_enable,
            "freshWindowMs": 15 * 60 * 1000,
            "sourceNote": "refresh only on mount/manual/visibility/network recovery; no polling",
        }
        measure["translator_network"] = {
            "initial": resources,
            "viewport": viewport_info,
            "domNodes": initial["paint"]["domNodes"],
            "cultureImagesBeforeApproach": images_after_weather_scroll,
            "cultureImagesAtLoad": images_at_load,
        }
        measure["contaminated"] = await h.reloaded_during_run()
        measure["guardViolations"] = h.guard_violations[:10]
    finally:
        await h.close()
    return measure


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def print_baseline(m):
    print()
    print("BASELINE (dev server, headless Chromium %s)" % m["environment"]["chromium"])
    bundle = m.get("bundle") or {}
    if bundle.get("status") == "OBSERVED":
        print(
            "bundle   JS %d files %d B (%d gzip) | CSS %d B (%d gzip) | all assets %d B (%d gzip)"
            % (
                bundle["js"]["count"],
                bundle["js"]["bytes"],
                bundle["js"]["gzipBytes"],
                bundle["css"]["bytes"],
                bundle["css"]["gzipBytes"],
                bundle["all_assets"]["bytes"],
                bundle["all_assets"]["gzipBytes"],
            )
        )
    load = m["cold_load"]
    print(
        "cold     FCP %sms LCP %sms | DOM %s | listeners %s | heap %.1f MB | %s requests / %d B"
        % (
            load["fcpMs"],
            load["lcpMs"],
            load["domNodes"],
            load["jsEventListeners"],
            (load["jsHeapUsedBytes"] or 0) / 1e6,
            load["resourceCount"],
            load["resourceBytes"],
        )
    )
    for row in m["typing"]:
        print(
            "typing   %-10s throttle=%sx p50 %sms p95 %sms max %sms | long tasks %s max %sms"
            % (
                row["label"],
                row["cpuThrottle"],
                row["p50"],
                row["p95"],
                row["max"],
                row["longTasks"],
                row["longTaskMaxMs"],
            )
        )
    fw = m["first_word_and_settle"]
    print(
        "stream   first word p50 %sms p95 %sms | settle p50 %sms p95 %sms"
        % (fw["firstWordMs"]["p50"], fw["firstWordMs"]["p95"], fw["settleMs"]["p50"], fw["settleMs"]["p95"])
    )
    nav = m["navigation"]
    print(
        "nav      to stats p50 %sms p95 %sms | back p50 %sms | documents %s"
        % (nav["toStatsMs"]["p50"], nav["toStatsMs"]["p95"], nav["backMs"]["p50"], nav["documents"])
    )
    idle = m["settled_idle"]
    print(
        "idle     timers %s intervals %s fetches %s | DOM %s | listeners %s | heap %.1f MB"
        % (
            idle["activeTimers"],
            idle["activeIntervals"],
            idle["activeFetches"],
            idle["cdp"]["domNodes"],
            idle["cdp"]["jsEventListeners"],
            (idle["cdp"]["jsHeapUsedBytes"] or 0) / 1e6,
        )
    )


def print_requests(m):
    print()
    print("REQUEST ACCOUNTING (mocked provider; no network provider traffic)")
    rows = []
    for s in m["scenarios"]:
        rows.append(
            [
                s["label"],
                s["streamPosts"],
                s["streamLive"],
                s["streamFull"],
                s["streamAborted"],
                s["enrichmentRequests"],
                s["enrichmentAborted"],
                (s["metricsDelta"] or {}).get("cacheHits"),
                (s["metricsDelta"] or {}).get("deduped"),
                (s["metricsDelta"] or {}).get("cancelled"),
            ]
        )
    print(
        perf_lib.table(
            rows,
            ["scenario", "streams", "live", "full", "aborted", "enrich", "e-abort", "cacheHit", "dedupe", "cancel"],
        )
    )
    print("errors:", m["totals"]["errors"], "guard:", m["totals"]["guardViolations"])


def print_stress(m):
    print()
    print("STRESS (bounded synthetic session)")
    samples = m["samples"]
    rows = []
    for s in samples:
        rows.append(
            [
                s["label"],
                s["cdp"]["domNodes"],
                s["cdp"]["jsEventListeners"],
                round((s["cdp"]["jsHeapUsedBytes"] or 0) / 1e6, 2),
                s["cdp"]["documents"],
                s["js"]["timers"]["active"],
                s["js"]["timers"]["intervals"],
                s["js"]["fetch"]["active"],
                s["js"]["storage"]["bytes"],
                s["js"]["storage"].get("memoryRows"),
            ]
        )
    print(
        perf_lib.table(
            rows,
            ["sample", "domNodes", "listeners", "heapMB", "docs", "timers", "intervals", "fetches", "storageB", "memRows"],
        )
    )
    print("totals:", json.dumps(m["totals"], ensure_ascii=False, default=str))
    if m["errors"]:
        print("ERRORS:", m["errors"])


def print_media(m):
    print()
    print("MEDIA / DISCOVERY")
    weather = m["weather"]
    print(
        "weather   strip %s consent %s | requests before %s, enable %s (+place %s), idle20s %s, typing %s, manual %s"
        % (
            weather["stripPresent"],
            weather["locationConsentGiven"],
            weather["requestsBeforeConsent"],
            weather["requestsAfterEnable"],
            weather["placeRequestsAfterEnable"],
            weather["requestsDuring20sIdle"],
            weather["requestsDuringTyping"],
            weather["requestsAfterManualRefresh"],
        )
    )
    discovery = m["discovery"]
    if not discovery.get("present"):
        print("discovery NOT_PRESENT:", discovery)
        return
    print(
        "discovery cards %s -> %s (more clicks %s) | image requests: load %d (%d B), after weather scroll %d, on culture mount %d, after more %d, after scroll %d"
        % (
            discovery["cardsBeforeScroll"],
            discovery["cardsAfterScroll"],
            discovery["moreClicks"],
            len(discovery["imagesAtLoad"]),
            discovery["imageBytesAtLoad"],
            discovery["imagesAfterWeatherScroll"],
            discovery["imagesOnMount"],
            discovery["imagesAfterMore"],
            discovery["imagesAfterScroll"],
        )
    )
    print(
        "images    bytes on mount %d, after more %d, after scroll %d, total %d | lazy %s decoded %s failed %s"
        % (
            discovery["imageBytesOnMount"],
            discovery["imageBytesAfterMore"],
            discovery["imageBytesAfterScroll"],
            discovery["imageBytesTotal"],
            discovery["allLazy"],
            discovery["allDecoded"],
            discovery["failedImageFetches"],
        )
    )


async def run_suite(name, args):
    if name == "baseline":
        data = await suite_baseline(args)
        print_baseline(data)
    elif name == "requests":
        data = await suite_requests(args)
        print_requests(data)
    elif name == "stress":
        data = await suite_stress(args)
        print_stress(data)
    elif name == "media":
        data = await suite_media(args)
        print_media(data)
    elif name == "bundle":
        data = {"suite": "bundle", "environment": {"note": "no browser"}, "bundle": measure_bundle()}
        print(json.dumps(data["bundle"], indent=2, ensure_ascii=False))
    else:
        raise SystemExit("unknown suite: %s" % name)
    out = ARTIFACTS / ("%s.json" % name)
    perf_lib.write_json(out, data)
    print()
    print("wrote", out)
    return data


async def main_async(args):
    names = ["baseline", "requests", "stress", "media", "bundle"] if args.suite == "all" else [args.suite]
    for name in names:
        print()
        print("=" * 70)
        print("suite:", name)
        print("=" * 70)
        await run_suite(name, args)
    if args.gate:
        check = subprocess.run(
            [sys.executable, str(CHECKER), "--dir", str(ARTIFACTS), "--thresholds", str(THRESHOLDS)],
            cwd=str(REPO_ROOT),
        )
        return check.returncode
    return 0


def main():
    parser = argparse.ArgumentParser(description="Deterministic performance/stress harness")
    parser.add_argument("--suite", default="baseline", choices=["baseline", "requests", "stress", "media", "bundle", "all"])
    parser.add_argument("--cycles", type=int, default=300)
    parser.add_argument("--changes", type=int, default=200)
    parser.add_argument("--sheets", type=int, default=50)
    parser.add_argument("--gate", action="store_true", help="apply scripts/perf/thresholds.json")
    args = parser.parse_args()
    sys.exit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()