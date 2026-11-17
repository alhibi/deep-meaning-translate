"""Deterministic in-browser performance measurement for the translator.

The harness launches headless Chromium against the running dev server, installs one
init script that (a) fakes every translation/enrichment provider call with a
controllable stream, (b) guards the network so no real provider can ever be reached,
and (c) instruments DOM arrival, timers, fetch accounting and event timing. Every
number a suite reports is read back from the page or from the CDP performance domain;
nothing is estimated.

Run from the repository root:
    python3 scripts/perf/run_perf.py --suite baseline

Requires: Python 3 Playwright installed (as the repository's E2E suite already does)
and the dev server on http://127.0.0.1:8080.
"""
import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from playwright.async_api import async_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = REPO_ROOT / "artifacts" / "phase2" / "perf"
APP_URL = os.environ.get("PERF_URL", "http://127.0.0.1:8080").rstrip("/")
INTRO_KEY = "lingua.intro.seen.v1"

DEFAULT_MOCK = {
    # Milliseconds before the first byte of a streamed answer.
    "liveFirstMs": 60,
    "fullFirstMs": 90,
    # Delay between streamed chunks.
    "liveChunkMs": 18,
    "fullChunkMs": 10,
    # Characters per chunk for the structured (full) reply.
    "fullChunkChars": 64,
    # Quiet enrichment calls (dictionary/shadow/review) answer after this delay.
    "enrichmentDelayMs": 120,
    "enrichmentStatus": 500,
}

# ---------------------------------------------------------------------------
# The init script
# ---------------------------------------------------------------------------

INIT_JS = r"""
(() => {
  "use strict";
  if (window.__perf) return;
  const cfg = __CFG_JSON__;
  const skip = cfg.skip || {};
  const now = () => performance.now();
  const perf = window.__perf = {
    startedAt: now(),
    timeOrigin: performance.timeOrigin,
    cfg: cfg,
    cycle: 0,
    fetches: [],
    fetchSeq: 0,
    activeFetches: 0,
    aborts: 0,
    abortedEnrichment: 0,
    chunks: 0,
    bytesIn: 0,
    byKind: {},
    streamsStarted: 0,
    streamsCompleted: 0,
    streamsAborted: 0,
    duplicateTexts: {},
    dom: {
      startedAt: now(),
      firstWordAt: null,
      settledAt: null,
      settledText: null,
      prevText: null,
      inputAtReset: 0,
      streamingSeen: false,
    },
    timers: { active: new Set(), intervals: new Set(), peak: 0, intervalPeak: 0 },
    input: { count: 0, lastAt: null, latencies: [], pendingFrames: 0 },
    events: { eventTiming: [], longTasks: [], fcp: null, lcp: null },
    errors: [],
  };

  // ---- deterministic fake model output -----------------------------------
  const AR_WORDS = [
    "هذا", "المعنى", "الواضح", "للجملة", "في", "اليوم", "جميل", "وهادئ",
    "والكلام", "يحمل", "إحساساً", "دقيقاً", "دون", "أن", "يضيف", "شيئاً",
    "جديداً", "ويبقى", "قريباً", "من", "الروح", "الأصلية",
  ];
  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function answerFor(text) {
    const len = Math.max(1, Array.from(text).length);
    const target = Math.max(12, Math.round(len * (0.55 + (hash(text) % 25) / 100)));
    const shift = hash(text) % AR_WORDS.length;
    let out = "";
    for (let i = 0; out.length < target; i++) {
      out += (i ? " " : "") + AR_WORDS[(shift + i) % AR_WORDS.length];
    }
    return out;
  }
  function fullPayload(text) {
    return JSON.stringify({
      translation: answerFor(text),
      sourceLanguage: "de",
      targetLanguage: "ar",
      tone: "neutral",
      formality: "neutral",
      confidence: 0.92,
      isAmbiguous: false,
      alternativeTranslations: [],
      notes: "",
      situation: "general",
    });
  }
  function splitWords(text) {
    const parts = [];
    const re = /\S+\s*/gu;
    let m;
    while ((m = re.exec(text))) parts.push(m[0]);
    return parts.length ? parts : [text];
  }
  function chunkString(text, size) {
    const out = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out.length ? out : [text];
  }

  // ---- fetch accounting + fake provider ----------------------------------
  const enc = new TextEncoder();
  function classify(url) {
    if (url.indexOf("/api/translate-stream") >= 0) return "stream";
    if (url.indexOf("/_serverFn/") >= 0) return "serverFn";
    if (url.indexOf("/api/native/") >= 0) return "native";
    if (url.indexOf("/api/") >= 0) return "api";
    return "other";
  }
  function record(url, kind, method, init) {
    const rec = {
      i: ++perf.fetchSeq,
      kind: kind,
      method: method,
      url: url,
      startedAt: now(),
      endedAt: null,
      chunks: 0,
      aborted: false,
      mode: null,
      text: null,
      duplicate: false,
      cycle: perf.cycle,
    };
    try {
      if (init && typeof init.body === "string") {
        const body = JSON.parse(init.body);
        rec.body = body;
        rec.text = typeof body.text === "string" ? body.text : null;
        rec.mode = typeof body.mode === "string" ? body.mode : body.partial ? "live" : "full";
      }
    } catch (e) {
      /* not JSON; fine */
    }
    if (rec.text) {
      // Only a finished-sentence (full) request for the same complete identity is a
      // duplicate paid request; live prefix requests repeat by nature while typing, and the
      // same text in another style/dialect/brain pair is a different, legitimate request.
      const body = rec.body || {};
      const identity = [
        rec.text,
        body.source || "",
        body.target || "",
        body.style || "",
        body.dialect || "",
        body.brain || "",
      ].join("\u0001");
      const seen = perf.duplicateTexts[identity] || 0;
      rec.duplicate = rec.mode === "full" && seen > 0;
      perf.duplicateTexts[identity] = seen + 1;
    }
    perf.fetches.push(rec);
    perf.activeFetches++;
    perf.byKind[kind] = (perf.byKind[kind] || 0) + 1;
    return rec;
  }
  function finishRecord(rec) {
    if (rec.endedAt === null) {
      rec.endedAt = now();
      perf.activeFetches--;
    }
  }
  function mockServerFn(rec, init) {
    const signal = init && init.signal;
    return new Promise((resolve, reject) => {
      let done = false;
      const settle = (aborted) => {
        if (done) return;
        done = true;
        finishRecord(rec);
        if (aborted) {
          rec.aborted = true;
          perf.aborts++;
          perf.abortedEnrichment++;
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        resolve(
          new Response('{"mock":"enrichment"}', {
            status: cfg.enrichmentStatus,
            headers: { "content-type": "application/json" },
          })
        );
      };
      const timer = setTimeout(() => settle(false), cfg.enrichmentDelayMs);
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          settle(true);
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            settle(true);
          },
          { once: true }
        );
      }
    });
  }
  function mockStream(rec, init) {
    const signal = init && init.signal;
    return new Promise((resolve) => {
      const body = rec.body || {};
      const live = rec.mode === "live" || body.partial === true;
      const payload = live ? answerFor(rec.text || "") : fullPayload(rec.text || "");
      const chunks = live ? splitWords(payload) : chunkString(payload, cfg.fullChunkChars);
      const firstMs = live ? cfg.liveFirstMs : cfg.fullFirstMs;
      const gapMs = live ? cfg.liveChunkMs : cfg.fullChunkMs;
      perf.streamsStarted++;
      let closed = false;
      let timer = null;
      let doneChunks = 0;
      let controllerRef = null;
      const stop = (aborted) => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          if (controllerRef) controllerRef.close();
        } catch (e) {}
        if (aborted && !rec.aborted) {
          rec.aborted = true;
          perf.aborts++;
          perf.streamsAborted++;
        }
        finishRecord(rec);
      };
      const push = () => {
        if (closed) return;
        if (rec.aborted || signal.aborted) {
          stop(true);
          return;
        }
        if (doneChunks >= chunks.length) {
          closed = true;
          try {
            controllerRef.close();
          } catch (e) {}
          perf.streamsCompleted++;
          finishRecord(rec);
          return;
        }
        const piece = chunks[doneChunks++];
        const bytes = enc.encode(piece);
        try {
          controllerRef.enqueue(bytes);
        } catch (e) {
          stop(false);
          return;
        }
        rec.chunks++;
        perf.chunks++;
        perf.bytesIn += bytes.byteLength;
        timer = setTimeout(push, gapMs);
      };
      const stream = new ReadableStream({
        start(controller) {
          controllerRef = controller;
          timer = setTimeout(push, firstMs);
        },
        cancel() {
          // The app cancelled the body (reader.cancel / abort). That is a cancellation
          // that reached the mocked wire, exactly what we want to count.
          stop(true);
        },
      });
      if (signal) {
        if (signal.aborted) stop(true);
        else signal.addEventListener("abort", () => stop(true), { once: true });
      }
      resolve(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      );
    });
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const kind = classify(url);
    if (kind === "serverFn") {
      const rec = record(url, kind, method, init);
      return mockServerFn(rec, init);
    }
    if (kind === "stream") {
      const rec = record(url, kind, method, init);
      if (method === "GET") {
        finishRecord(rec);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return mockStream(rec, init);
    }
    if (kind === "native" || kind === "api") {
      const rec = record(url, kind, method, init);
      if (cfg.allowApi) {
        // Weather (and any other app API) measured on purpose: let the Playwright route
        // layer answer it; the record still counts the call.
        return origFetch(input, init).then(
          (response) => {
            finishRecord(rec);
            return response;
          },
          (error) => {
            finishRecord(rec);
            throw error;
          }
        );
      }
      finishRecord(rec);
      return Promise.resolve(new Response('{"mock":"blocked"}', { status: 503 }));
    }
    return origFetch(input, init);
  };

  // ---- timer accounting ---------------------------------------------------
  if (!skip.timers) {
  const rawSetTimeout = window.setTimeout.bind(window);
  const rawClearTimeout = window.clearTimeout.bind(window);
  const rawSetInterval = window.setInterval.bind(window);
  const rawClearInterval = window.clearInterval.bind(window);
  window.setTimeout = function (fn, ms) {
    const args = Array.prototype.slice.call(arguments, 2);
    let id;
    const wrapped =
      typeof fn === "function"
        ? function () {
            perf.timers.active.delete(id);
            return fn.apply(this, args);
          }
        : fn;
    id = rawSetTimeout(wrapped, ms);
    perf.timers.active.add(id);
    if (perf.timers.active.size > perf.timers.peak) perf.timers.peak = perf.timers.active.size;
    return id;
  };
  window.clearTimeout = function (id) {
    perf.timers.active.delete(id);
    return rawClearTimeout(id);
  };
  window.setInterval = function (fn, ms) {
    const args = Array.prototype.slice.call(arguments, 2);
    const id = rawSetInterval(fn, ms);
    perf.timers.intervals.add(id);
    if (perf.timers.intervals.size > perf.timers.intervalPeak)
      perf.timers.intervalPeak = perf.timers.intervals.size;
    return id;
  };
  window.clearInterval = function (id) {
    perf.timers.intervals.delete(id);
    return rawClearInterval(id);
  };

  }

  // ---- listener accounting -------------------------------------------------
  // Counts registrations the app adds and removes on any EventTarget. This distinguishes a
  // real live-listener leak from listeners that only sit on detached DOM retained by the
  // renderer (the CDP JSEventListeners metric cannot tell those apart). Listeners added with
  // { once: true } are counted separately: the browser removes them itself, so they must not
  // look like an app leak.
  const listenerStats = {
    added: 0,
    removed: 0,
    active: 0,
    onceAdded: 0,
    windowAdded: 0,
    windowRemoved: 0,
    documentAdded: 0,
    documentRemoved: 0,
    byType: {},
  };
  if (!skip.listeners) {
  const rawAdd = EventTarget.prototype.addEventListener;
  const rawRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    const once = !!(options && typeof options === "object" && options.once);
    listenerStats.added++;
    if (once) listenerStats.onceAdded++;
    listenerStats.active++;
    listenerStats.byType[type] = (listenerStats.byType[type] || 0) + 1;
    if (this === window) listenerStats.windowAdded++;
    if (this === document) listenerStats.documentAdded++;
    return rawAdd.apply(this, arguments);
  };
  EventTarget.prototype.removeEventListener = function (type) {
    listenerStats.removed++;
    listenerStats.active = Math.max(0, listenerStats.active - 1);
    listenerStats.byType[type] = (listenerStats.byType[type] || 0) - 1;
    if (this === window) listenerStats.windowRemoved++;
    if (this === document) listenerStats.documentRemoved++;
    return rawRemove.apply(this, arguments);
  };

  }

  // ---- input responsiveness ----------------------------------------------
  if (!skip.input) {
  document.addEventListener(
    "input",
    (event) => {
      perf.input.count++;
      perf.input.lastAt = event.timeStamp;
      const start = event.timeStamp;
      perf.input.pendingFrames++;
      requestAnimationFrame(() => {
        perf.input.pendingFrames--;
        const dt = performance.now() - start;
        perf.input.latencies.push(+dt.toFixed(2));
        if (perf.input.latencies.length > 600) perf.input.latencies.shift();
      });
    },
    false
  );

  }

  // ---- DOM arrival (first word / settle) ---------------------------------
  if (!skip.dom) {
  let domScheduled = false;
  const COPY_LABELS = ["Copy translation", "Copy", "نسخ", "Kopieren"];
  const copyReady = () => {
    const buttons = document.querySelectorAll("button[aria-label]");
    for (const b of buttons) {
      const label = b.getAttribute("aria-label");
      if (COPY_LABELS.indexOf(label) < 0) continue;
      return b.disabled === false;
    }
    return false;
  };
  const evaluateDom = () => {
    domScheduled = false;
    const el = document.querySelector(".result-text");
    if (!el) return;
    const text = (el.textContent || "").trim();
    if (!text) return;
    const streaming = el.getAttribute("data-streaming") === "true";
    const dom = perf.dom;
    // Nothing counts before the draft for this cycle changed: the previous answer is
    // still on screen for a moment, and a cached answer settles without any stream.
    if (perf.input.count <= dom.inputAtReset) return;
    if (streaming) {
      dom.streamingSeen = true;
      if (dom.firstWordAt === null) dom.firstWordAt = now();
      return;
    }
    // A non-streaming reading is not necessarily settled: a provisional (live) answer
    // also paints without the streaming attribute and keeps its actions disabled. The
    // Copy action becomes enabled only for a settled, non-provisional result.
    if (dom.settledAt === null && copyReady()) {
      dom.settledAt = now();
      dom.settledText = text;
    }
  };
  const scheduleDom = () => {
    if (domScheduled) return;
    domScheduled = true;
    requestAnimationFrame(evaluateDom);
  };
  const observer = new MutationObserver(scheduleDom);
  const startObserver = () => {
    if (!document.body) return;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-streaming"],
    });
  };
  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver, { once: true });

  }

  // ---- paint/long-task/event timing --------------------------------------
  if (!skip.paint) {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name === "first-contentful-paint") perf.events.fcp = e.startTime;
      }
    }).observe({ type: "paint", buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.events.lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        perf.events.longTasks.push({ start: e.startTime, duration: e.duration });
        if (perf.events.longTasks.length > 500) perf.events.longTasks.shift();
      }
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        perf.events.eventTiming.push({
          name: e.name,
          duration: e.duration,
          start: e.startTime,
          interactionId: e.interactionId || 0,
        });
        if (perf.events.eventTiming.length > 500) perf.events.eventTiming.shift();
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  } catch (e) {}
  window.addEventListener("error", (e) => {
    perf.errors.push({ message: String(e.message), at: now() });
  });
  window.addEventListener("unhandledrejection", (e) => {
    perf.errors.push({ message: "unhandledrejection: " + String(e.reason), at: now() });
  });

  }

  // ---- cycle / snapshot API ----------------------------------------------
  function quantile(values, p) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(2);
  }
  function storageSummary() {
    const out = { keys: 0, bytes: 0, byKey: {} };
    try {
      const e = new TextEncoder();
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key === null) continue;
        if (key.indexOf("lingua.") !== 0) continue;
        const value = localStorage.getItem(key) || "";
        const bytes = e.encode(key).length + e.encode(value).length;
        out.keys++;
        out.bytes += bytes;
        out.byKey[key] = { bytes: bytes, chars: value.length };
      }
      const mem = JSON.parse(localStorage.getItem("lingua.memory.v1") || "[]");
      out.memoryRows = Array.isArray(mem) ? mem.length : null;
      const hist = JSON.parse(localStorage.getItem("lingua.history.v1") || "[]");
      out.historyRows = Array.isArray(hist) ? hist.length : null;
      const saved = JSON.parse(localStorage.getItem("lingua.saved.v1") || "[]");
      out.savedRows = Array.isArray(saved) ? saved.length : null;
    } catch (e) {
      out.error = String(e);
    }
    return out;
  }
  perf.resetCycle = function () {
    perf.dom.prevText = perf.dom.settledText !== null ? perf.dom.settledText : perf.dom.prevText;
    perf.dom.firstWordAt = null;
    perf.dom.settledAt = null;
    perf.dom.settledText = null;
    perf.dom.streamingSeen = false;
    perf.dom.startedAt = now();
    perf.dom.inputAtReset = perf.input.count;
    perf.cycle++;
    return { cycle: perf.cycle };
  };
  perf.fetchSince = function (seq) {
    return perf.fetches.slice(seq).map((r) => ({
      i: r.i,
      kind: r.kind,
      method: r.method,
      mode: r.mode,
      startedAt: +r.startedAt.toFixed(2),
      endedAt: r.endedAt === null ? null : +r.endedAt.toFixed(2),
      chunks: r.chunks,
      aborted: r.aborted,
      duplicate: r.duplicate,
      cycle: r.cycle,
      chars: r.text ? Array.from(r.text).length : 0,
    }));
  };
  perf.snapshot = function () {
    const lat = perf.input.latencies;
    const lts = perf.events.longTasks;
    const et = perf.events.eventTiming;
    return {
      t: +now().toFixed(2),
      timeOrigin: perf.timeOrigin,
      cycle: perf.cycle,
      dom: {
        firstWordAt: perf.dom.firstWordAt,
        settledAt: perf.dom.settledAt,
        startedAt: perf.dom.startedAt,
        streamingSeen: perf.dom.streamingSeen,
        settledChars: perf.dom.settledText ? Array.from(perf.dom.settledText).length : null,
      },
      fetch: {
        seq: perf.fetchSeq,
        total: perf.fetches.length,
        active: perf.activeFetches,
        aborts: perf.aborts,
        abortedEnrichment: perf.abortedEnrichment,
        byKind: Object.assign({}, perf.byKind),
        streamsStarted: perf.streamsStarted,
        streamsCompleted: perf.streamsCompleted,
        streamsAborted: perf.streamsAborted,
        chunks: perf.chunks,
        bytesIn: perf.bytesIn,
        duplicateRequests: perf.fetches.filter((r) => r.duplicate).length,
      },
      listeners: {
        added: listenerStats.added,
        removed: listenerStats.removed,
        active: listenerStats.active,
        onceAdded: listenerStats.onceAdded,
        persistent: listenerStats.active - listenerStats.onceAdded,
        windowActive: listenerStats.windowAdded - listenerStats.windowRemoved,
        documentActive: listenerStats.documentAdded - listenerStats.documentRemoved,
        byType: Object.assign({}, listenerStats.byType),
      },
      timers: {
        active: perf.timers.active.size,
        intervals: perf.timers.intervals.size,
        peak: perf.timers.peak,
        intervalPeak: perf.timers.intervalPeak,
      },
      input: {
        count: perf.input.count,
        pendingFrames: perf.input.pendingFrames,
        p50: quantile(lat, 50),
        p95: quantile(lat, 95),
        max: lat.length ? Math.max.apply(null, lat) : null,
        lastAt: perf.input.lastAt,
      },
      paint: {
        fcp: perf.events.fcp,
        lcp: perf.events.lcp,
        domNodes: document.getElementsByTagName("*").length,
        longTasks: lts.length,
        longTaskTotal: +lts.reduce((a, b) => a + b.duration, 0).toFixed(2),
        longTaskMax: lts.length ? +Math.max.apply(null, lts.map((x) => x.duration)).toFixed(2) : null,
        eventTiming: et.length,
        eventTimingMax: et.length ? +Math.max.apply(null, et.map((x) => x.duration)).toFixed(2) : null,
      },
      storage: storageSummary(),
      metrics: window.__lingua && window.__lingua.metrics ? window.__lingua.metrics() : null,
      errors: perf.errors.slice(-10),
    };
  };
  perf.resourceSummary = function () {
    const entries = performance.getEntriesByType("resource");
    const byType = {};
    const total = { count: 0, transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 };
    for (const e of entries) {
      const t = e.initiatorType || "other";
      if (!byType[t]) byType[t] = { count: 0, transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 };
      byType[t].count++;
      for (const k of ["transferSize", "encodedBodySize", "decodedBodySize"]) {
        byType[t][k] += e[k] || 0;
        total[k] += e[k] || 0;
      }
      total.count++;
    }
    return { byType: byType, total: total };
  };
})();
"""


def _repo_git_state():
    def run(args):
        try:
            return subprocess.run(
                ["git"] + args,
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
                check=False,
                timeout=20,
            ).stdout.strip()
        except Exception as exc:  # pragma: no cover - environment only
            return "error: %s" % exc

    return {
        "head": run(["rev-parse", "HEAD"]),
        "branch": run(["rev-parse", "--abbrev-ref", "HEAD"]),
        "dirty": run(["status", "--porcelain"]) != "",
        "porcelain": run(["status", "--porcelain"]).splitlines(),
    }


class Harness:
    """One browser + one page with the deterministic provider and instrumented DOM."""

    def __init__(self, playwright, browser, context, page, cdp, mock_cfg, environment):
        self.playwright = playwright
        self.browser = browser
        self.context = context
        self.page = page
        self.cdp = cdp
        self.mock = mock_cfg
        self.environment = environment

    @classmethod
    async def launch(cls, mock=None, viewport=(390, 844), cpu_throttle=1, mobile=True, geolocation=False):
        cfg = dict(DEFAULT_MOCK)
        if mock:
            cfg.update(mock)
        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--enable-precise-memory-info", "--disable-dev-shm-usage"],
        )
        context_kwargs = {
            "viewport": {"width": viewport[0], "height": viewport[1]},
            "device_scale_factor": 2 if mobile else 1,
            "has_touch": True,
            "color_scheme": "dark",
            "locale": "en-US",
            "timezone_id": "Europe/Berlin",
            "reduced_motion": "no-preference",
        }
        if geolocation:
            context_kwargs["permissions"] = ["geolocation"]
            context_kwargs["geolocation"] = {"latitude": 52.520008, "longitude": 13.404954}
        context = await browser.new_context(**context_kwargs)
        # Belt and braces: even if the in-page fetch mock ever failed, no provider endpoint
        # may be reached. Anything outside the local dev server is aborted too.
        guard = {"blocked": []}

        async def route_handler(route):
            url = route.request.url
            path = url.split("?", 1)[0]
            # Only the real endpoints, never the Vite dev module graph: the source files
            # under /src/routes/api/ are modules the dev server must be allowed to serve.
            provider = (
                path.startswith("/api/translate-stream")
                or path.startswith("/_serverFn/")
                or path.startswith("/api/speak")
                or path.startswith("/api/eleven-speak")
                or path.startswith("/api/native/")
            )
            host_ok = url.startswith(APP_URL + "/") or url == APP_URL
            if provider or not host_ok:
                guard["blocked"].append(url)
                await route.abort()
            else:
                await route.continue_()

        await context.route("**/*", route_handler)
        # Other agents edit this tree while measurements run; a Vite HMR update would reload
        # the page in the middle of a session. Close the dev-server websocket so no update can
        # be applied, and record the document's time origin so a reload is still detected.
        try:

            async def ws_handler(websocket):
                await websocket.close()

            await context.route_web_socket("**/*", ws_handler)
        except Exception as exc:  # pragma: no cover - older Playwright
            print("WARN: cannot block HMR websocket: %s" % exc, file=sys.stderr)
        await context.add_init_script(
            "try{localStorage.setItem('%s','1')}catch(e){}" % INTRO_KEY
        )
        await context.add_init_script(INIT_JS.replace("__CFG_JSON__", json.dumps(cfg)))
        page = await context.new_page()
        env = {
            "url": APP_URL,
            "chromium": browser.version,
            "viewport": list(viewport),
            "device_scale_factor": 2 if mobile else 1,
            "cpu_throttle": cpu_throttle,
            "mock": cfg,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "git": _repo_git_state(),
        }
        cdp = await context.new_cdp_session(page)
        await cdp.send("Performance.enable")
        if cpu_throttle and cpu_throttle != 1:
            await cdp.send("Emulation.setCPUThrottlingRate", {"rate": cpu_throttle})
        harness = cls(playwright, browser, context, page, cdp, cfg, env)
        harness.guard_violations = guard["blocked"]
        return harness

    # -- lifecycle ---------------------------------------------------------
    async def close(self):
        try:
            await self.context.close()
        finally:
            await self.browser.close()
            await self.playwright.stop()

    async def goto(self, wait_composer=True):
        await self.page.goto(APP_URL + "/", wait_until="load", timeout=60_000)
        self.environment["time_origin"] = await self.page.evaluate("() => performance.timeOrigin")
        if wait_composer:
            await self.page.locator("textarea").first.wait_for(state="visible", timeout=30_000)
            try:
                await self.page.wait_for_function(
                    "() => !document.querySelector('[data-testid=first-intro]')", timeout=8_000
                )
            except Exception:
                pass
            await self.page.wait_for_function(
                "() => window.__perf && window.__perf.startedAt > 0", timeout=10_000
            )
            # The app's own JS has evaluated (i18n store/metrics module) — a stronger
            # hydration signal than the server-rendered composer being present.
            await self.page.wait_for_function("() => !!window.__lingua", timeout=20_000)

    # -- interaction -------------------------------------------------------
    async def clear_draft(self):
        # fill("") is one input event, works on every host keyboard layout and cannot
        # leave a selection behind (Control+A is "move to line start" on macOS browsers).
        box = self.page.locator("#composer")
        await box.fill("")
        await self.page.wait_for_function(
            "() => document.querySelector('#composer').value === ''", timeout=5_000
        )
        await self.page.wait_for_timeout(40)

    async def type_text(self, text, delay_ms=8):
        box = self.page.locator("#composer")
        await box.click()
        await self.page.keyboard.type(text, delay=delay_ms)

    async def set_draft(self, text):
        """One input event instead of a keystroke burst (stress cycles)."""
        await self.page.locator("#composer").fill(text)

    async def reset_cycle(self):
        return await self.page.evaluate("() => window.__perf.resetCycle()")

    async def wait_first_word(self, timeout_ms=10_000):
        await self.page.wait_for_function(
            "() => window.__perf.dom.firstWordAt !== null", timeout=timeout_ms
        )
        return await self.page.evaluate(
            "() => ({firstWordAt: window.__perf.dom.firstWordAt, lastInputAt: window.__perf.input.lastAt})"
        )

    async def wait_settle(self, timeout_ms=15_000):
        await self.page.wait_for_function(
            "() => window.__perf.dom.settledAt !== null", timeout=timeout_ms
        )
        return await self.page.evaluate(
            "() => ({settledAt: window.__perf.dom.settledAt, firstWordAt: window.__perf.dom.firstWordAt, settledChars: window.__perf.dom.settledText ? Array.from(window.__perf.dom.settledText).length : null})"
        )

    async def fetch_since(self, seq):
        return await self.page.evaluate("(seq) => window.__perf.fetchSince(seq)", seq)

    async def snapshot(self):
        return await self.page.evaluate("() => window.__perf.snapshot()")

    async def reloaded_during_run(self):
        """True when the document reloaded (HMR/another agent's edit) during this run."""
        try:
            current = await self.page.evaluate("() => performance.timeOrigin")
        except Exception:
            return True
        return abs(current - self.environment.get("time_origin", current)) > 1

    async def resource_summary(self):
        return await self.page.evaluate("() => window.__perf.resourceSummary()")

    async def collect_garbage(self):
        try:
            await self.cdp.send("HeapProfiler.collectGarbage")
        except Exception:
            pass

    async def cdp_metrics(self):
        raw = await self.cdp.send("Performance.getMetrics")
        return {m["name"]: m["value"] for m in raw.get("metrics", [])}

    async def sample(self, label, gauge=True):
        """CDP heap/node/listener metrics plus the page-side snapshot."""
        if gauge:
            await self.collect_garbage()
        cdp = await self.cdp_metrics()
        js = await self.snapshot()
        return {
            "label": label,
            "at": time.time(),
            "cdp": {
                "jsHeapUsedBytes": cdp.get("JSHeapUsedSize"),
                "jsHeapTotalBytes": cdp.get("JSHeapTotalSize"),
                "domNodes": cdp.get("Nodes"),
                "documents": cdp.get("Documents"),
                "jsEventListeners": cdp.get("JSEventListeners"),
                "layoutCount": cdp.get("LayoutCount"),
                "recalcStyleCount": cdp.get("RecalcStyleCount"),
                "scriptDurationMs": round(cdp.get("ScriptDuration", 0) * 1000, 2),
                "taskDurationMs": round(cdp.get("TaskDuration", 0) * 1000, 2),
            },
            "js": js,
        }

    async def nav_roundtrip(self, rounds=5):
        """Click the Statistics link and return; measure both legs."""
        out = []
        for _ in range(rounds):
            await self.page.wait_for_timeout(150)
            t0 = time.perf_counter()
            await self.page.locator("header a[href='/stats']").first.click()
            await self.page.locator("main").first.wait_for(state="visible", timeout=15_000)
            await self.page.wait_for_function(
                "() => document.querySelectorAll('main ul li button').length > 0",
                timeout=20_000,
            )
            t1 = time.perf_counter()
            await self.page.locator("a[href='/']").first.click()
            await self.page.locator("#composer").wait_for(state="visible", timeout=15_000)
            t2 = time.perf_counter()
            doc_count = await self.page.evaluate(
                "() => performance.getEntriesByType('navigation').length"
            )
            out.append(
                {
                    "toStatsMs": round((t1 - t0) * 1000, 2),
                    "backMs": round((t2 - t1) * 1000, 2),
                    "documents": doc_count,
                }
            )
        return out

    async def ensure_target_ar(self):
        """Switch the target language to Arabic through the real UI (once)."""
        button = self.page.locator("button[aria-label='Target language']").first
        for attempt in range(3):
            try:
                label = (await button.inner_text()).strip()
                if "العربية" in label:
                    return True
                await button.click()
                dialog = self.page.get_by_role("dialog").first
                await dialog.wait_for(state="visible", timeout=8_000)
                await dialog.get_by_text("العربية", exact=True).first.click()
                await self.page.wait_for_timeout(250)
                if "العربية" in (await button.inner_text()):
                    return True
            except Exception as exc:
                if attempt == 2:
                    print(
                        "WARN: could not switch target language to Arabic: %s" % exc,
                        file=sys.stderr,
                    )
                await self.page.wait_for_timeout(300)
        return False


# ---------------------------------------------------------------------------
# Reporting helpers
# ---------------------------------------------------------------------------


def pct(values, p):
    if not values:
        return None
    s = sorted(values)
    idx = min(len(s) - 1, max(0, int(round((p / 100.0) * len(s) + 0.5)) - 1))
    return s[idx]


def summarize(values):
    values = [v for v in values if v is not None]
    if not values:
        return {"n": 0}
    return {
        "n": len(values),
        "min": round(min(values), 2),
        "p50": round(pct(values, 50), 2),
        "p95": round(pct(values, 95), 2),
        "max": round(max(values), 2),
    }


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def table(rows, headers):
    widths = []
    for i, h in enumerate(headers):
        widths.append(
            max(len(str(h)), *(len(str(r[i])) for r in rows)) if rows else len(str(h))
        )
    lines = ["  ".join(str(h).ljust(widths[i]) for i, h in enumerate(headers))]
    lines.append("  ".join("-" * widths[i] for i in range(len(headers))))
    for row in rows:
        lines.append("  ".join(str(c).ljust(widths[i]) for i, c in enumerate(row)))
    return "\n".join(lines)
