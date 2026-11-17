# Performance, stress and resource measurement (A14)

Deterministic measurement harness for the translator and the Phase II weather / cultural
discovery surfaces. It runs against the already-running dev server, fakes every provider
call inside the page, and reads its numbers back from the page or from the Chrome DevTools
Protocol. Nothing here is estimated, sampled from intuition, or taken from a paid provider.

## Quick start

```sh
# dev server already running on http://127.0.0.1:8080 (do not start a second one)
python3 scripts/perf/run_perf.py --suite baseline    # load, typing, stream, navigation, idle
python3 scripts/perf/run_perf.py --suite requests    # per-scenario provider request accounting
python3 scripts/perf/run_perf.py --suite stress      # bounded long-session (300 cycles + churn)
python3 scripts/perf/run_perf.py --suite media       # discovery images + weather refresh cadence
python3 scripts/perf/run_perf.py --suite bundle      # existing production build artefact sizes
python3 scripts/perf/run_perf.py --suite all --gate  # everything + apply the budgets
```

Requirements: Python 3.9+ and Playwright with Chromium installed (the repository's E2E
suite already depends on it). Override the target with `PERF_URL` only if needed; the
default is the dev server the project's docs use. Results are written to
`artifacts/phase2/perf/<suite>.json` (gitignored). The budget gate is
`tests/perf/check_budgets.py` with `scripts/perf/thresholds.json`:

```sh
python3 tests/perf/check_budgets.py                    # read the last measurements
python3 tests/perf/check_budgets.py --self-test        # prove the gate rejects breaches
```

## What is measured and how

| Area | Metric | Source of truth |
| --- | --- | --- |
| Cold load | FCP, LCP, connected DOM, listeners, heap, resource count/bytes | `PerformanceObserver` paint entries + CDP `Performance.getMetrics` (heap after `HeapProfiler.collectGarbage`) + `PerformanceResourceTiming` |
| Typing responsiveness | input event → next animation frame (p50/p95/max), Event Timing entries ≥16 ms, long tasks | instrumented capture listener inside the page; measured at 1x and 4x CPU throttle |
| Streaming | request → first streamed word, request → settled answer; live/full request counts | timestamps recorded at the fetch boundary and at the first `.result-text` paint / first enabled Copy action |
| Navigation | statistics round-trip (both legs), document count | click + visible-content waits; `performance.getEntriesByType('navigation').length` must stay 1 |
| Memory / activity | JS heap, connected DOM, renderer node count (includes detached), live listeners, pending timers/intervals, in-flight requests, localStorage bytes | CDP `Performance.getMetrics` after GC + page instrumentation |
| Request accounting | streams (live/full), aborts at the wire, enrichment calls, duplicate full requests, cache hits, reload memory hits | in-page `fetch` wrapper over the deterministic mock + the app's own `window.__lingua.metrics()` |
| Discovery media | image requests/bytes before scroll, on feed mount, after `More discoveries`, after scrolling; lazy/decoding attributes; failures | real request bytes fetched once by the harness through the same allowlisted museum host (`src/lib/culture/media-hosts.json`) and served to the page |
| Weather | requests before consent, on explicit consent, during a 20 s idle window, while typing, on manual refresh | Playwright routes for `/api/weather` and `/api/weather/place` with a validated snapshot |
| Bundle | precache JS/CSS/asset bytes and gzip bytes, missing files, entry/routes chunks | the existing `.output/public` build, read from the `sw.js` precache manifest — this harness never builds |

## Determinism and honesty rules

- **No provider traffic.** A single init script replaces `window.fetch`: translation
  streams become a deterministic fake stream, enrichment calls answer with a mocked
  status, and a Playwright route guard aborts anything outside the dev server. The run
  aborts (rather than silently falling through) if a provider endpoint is ever reached.
- **No paid model.** The fake Arabic answers are generated deterministically from the
  request text; they exist only to drive the paint path, never to judge quality.
- **No HMR during a run.** Other agents edit this tree concurrently; the harness closes the
  Vite websocket and records the document's `timeOrigin`, so a reload marks the run
  `contaminated` and the gate refuses to treat its numbers as a pass.
- **Dev server, not production.** Latencies are Vite-dev latencies (unbundled modules);
  bundle bytes come only from a real build artefact and are labelled with its timestamp and
  whether source files are newer. Production FCP on real hardware is NOT_VERIFIED here.
- **The lead owns the build.** `--suite bundle` reads whatever `.output/public` exists and
  marks it stale when `src/` is newer. It never runs `npm run build`.
- **Budgets are regression guards, not product targets.** `scripts/perf/thresholds.json`
  records the measured first run and sets each maximum at roughly 2–3x the noisy latency,
  a small delta for counts, and the product's own documented storage bounds. A missing
  suite or an absent metric is reported NOT_VERIFIED, never PASS.

## Bounded long-session loop

`--suite stress` compresses a 30–60 minute session into a bounded loop: 300 typed
translate cycles (unique, number-free German sentences), 200 language/style changes
(style toggles + language swaps), 50 detail-overlay open/close cycles (the cultural record
dialog once the section exists, otherwise the saved-phrases sheet) and periodic samples
(GC → CDP heap/nodes/listeners, page timers/fetches/storage). Defaults can be lowered for a
quick check, e.g. `--cycles 60 --changes 40 --sheets 10`. The growth budgets in
`thresholds.json` are expressed against the first `baseline-warm` sample and the final
quiesced sample.

## Reported environment

Each JSON records: Chromium version, viewport (default 390×844, DPR 2), CPU throttle,
colour scheme, mock timings, git HEAD and the working-tree file list at run time. The
reference measurements in this repository's report were taken with Playwright 1.55.0 /
Chromium 140.0.7339.16 on macOS (Apple Silicon), Node 26 host, dev server on
`http://127.0.0.1:8080`.

## Known limits (NOT_VERIFIED)

- Physical phones/tablets: battery, thermal throttling, real IME/keyboard latency and
  WebView-specific behaviour are not measurable in headless Chromium. The Android emulator
  is a software-GPU environment and does not replace device profiling.
- Production bundle load/FCP: needs the lead's `npm run build` + `npm run preview`; the
  budget checks only the existing artefact's size.
- iOS Safari and Firefox: only Chromium was measured.
- Real provider latency/token cost: the deterministic mock removes provider variance by
  design, so this harness measures the app, not the network.
- The renderer's total node count (CDP `Nodes`) includes detached nodes the browser keeps
  alive after client-side navigation; connected DOM is reported separately and is the DOM
  the person sees. The difference is recorded, not hidden.
