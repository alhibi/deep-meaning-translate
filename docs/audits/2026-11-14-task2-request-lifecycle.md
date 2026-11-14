# Task 2 — Request Lifecycle and Stuck States (2026-11-14)

Status: **F1, F6 and F15 fixed, with a failing test recorded before each fix.** The Python Playwright suite
was executed in this worktree; its real results are below. Parts of it could not be completed because
the bundled headless browser closed mid-run, and those are marked **NOT_VERIFIED**, never as passes.
No provider key was available, so translation quality remains **NOT_VERIFIED**.

Plan: `docs/superpowers/plans/2026-11-14-deep-audit.md` (Task 2).
Baseline: `docs/audits/2026-11-14-baseline.md`.

## Scope

Request identity and target-language authority, the 204 cancellation path, and the stuck-pending
symptom described as F1. Browser evidence was collected on the dev server (`vite dev`, port 8080)
and, for the service-worker finding, on `npm run preview` (production build).

## F1 — a model `targetLanguage` could strand the screen on a skeleton

**Symptom.** A full reply whose `targetLanguage` disagreed with the requested target produced a
result that the screen refused to render while `pending` stayed true with no request in flight. The
skeleton could not self-heal.

**Root cause.** Three components claimed authority over the target:

1. `parse.ts` copied `targetLanguage` from the model payload into the result.
2. `routes/index.tsx` compared that echoed value with the requested target to decide whether the
   result was stale, and folded "stale" into `pending`.
3. `persist.parseSession` accepted a cached result without checking it against the session's target.

A model echo therefore controlled routing, and a mismatch left the UI permanently pending.

**RED (before the fix).**

- `src/lib/translation/parse.test.ts` — "keeps the requested target when the model echoes another
  language": failed; the parsed result carried the model's value.
- `src/lib/storage.test.ts` — "drops a cached result written into a different target language":
  failed; `parseSession` returned the mismatched result.
- `src/lib/translation/view.test.ts` — "does not stay pending when the settled result was written
  for another target": failed; `resultState` did not exist, and the inline rule returned pending.

**Fix.**

- `parse.ts` now sets `targetLanguage: req.target`; the request is the authority, and the model's
  echo is not trusted for routing.
- New pure module `src/lib/translation/view.ts`:
  - `matchesTarget(result, target)` — one comparison used by the screen and by storage restore;
  - `resultState({ result, target, pending, error, cancelled })` — `pending` means a request is
    actually in flight; a settled result for another target is not pending.
- `persist.parseSession` drops a cached result whose `targetLanguage` does not match `s.target`.
- `routes/index.tsx` derives the displayed result and `pending` from `resultState`, and the old
  `staleTarget` term is gone from `pending`.

**GREEN.** The three tests above pass, together with the rest of the targeted set (25/25). Full
suite: **311 passed, 4 skipped, 53 files**, coverage **51.91 statements / 42.25 branches / 43.12
functions / 53.88 lines**. `typecheck` and `lint --max-warnings 0` exit 0.

A browser confirmation of the same path (intercepted full reply with a wrong `targetLanguage`
echo) was attempted but the headless browser closed before the assertion; see the Playwright
section. The unit tests are the evidence for F1; the browser path remains **NOT_VERIFIED**.

## F6 — a quiet 204 was classified as a provider failure

**Symptom.** The route uses a bodiless `204` to mean "cancelled quietly". The client parsed every
`2xx` as JSON, the parse failed, and the failure surfaced as `kind: "provider"`, which the UI treats
as an error and retries.

**RED.** `src/lib/translation/stream.test.ts` — "treats a 204 as a quiet cancellation": expected
`{ ok: false, cancelled: true }`, received `{ ok: false, kind: "provider" }`.

**Fix.** `stream.ts` adds `cancelled?: true` to `StreamResponse` and returns it for `status === 204`
before any body parsing; `useTranslator` handles `res.cancelled` as a silent cancellation, without
an error surface or a retry.

**GREEN.** The new test passes; the full suite and gates above are green.

## Behaviour change recorded

`docs/architecture/state-and-persistence.md` now states that a cached session result whose
`targetLanguage` disagrees with the session's target is dropped, and that the request's target — not
the model's echo — is authoritative.

## Playwright suite — real results

Environment: Python Playwright installed in `/tmp/pwvenv`, Chromium headless shell, Ubuntu 24.04
runtime libraries staged under `/tmp/pwlibs` (no root in this VM). The suite's twelve scripts were
run against `vite dev` on `http://localhost:8080`; `?sw=off` is honoured where the script asks for
it.

Scripts assume a hydrated page but call `page.goto` without waiting for hydration, so on a cold dev
server the first click can hit an unhydrated document. For this run only, an external
`sitecustomize` shim made `Page.goto` default to `wait_until="networkidle"` with a 90 s timeout. No
script, assertion or product file was changed for the run.

| Script | Exit | Observed result | Class |
| --- | --- | --- | --- |
| `smoke.py` | 0 | **25 PASS, 0 failures** (intro, translation, copy, saved sheet, statistics, archive, zero page errors) | PASS |
| `seo_navigation.py` | 0 | PASS (public guide returns to the usable translator) | PASS |
| `navigation_stability.py` | 1 | **FAIL** draft restored, **FAIL** translation restored; then strict-mode violation: `a[href="/"]` matched 2 elements | Harness + F16 |
| `stats.py` | 1 | PASS for empty state, 7-day totals, words, 3 pairs; then `Locator.click` timeout at line 65 | NOT_VERIFIED |
| `themes.py` | 1 | Browser closed during `Locator.wait_for` after reload | NOT_VERIFIED (environment) |
| `grow_box.py` | 1 | Browser closed during `wait_for_timeout` after reload | NOT_VERIFIED (environment) |
| `adversarial.py` | 1 | Browser closed mid-run | NOT_VERIFIED (environment) |
| `language_voice.py` | 1 | Browser closed during `Page.goto` | NOT_VERIFIED (environment) |
| `shadow.py` | 1 | Browser closed during `wait_for_load_state` | NOT_VERIFIED (environment) |
| `voice_sync.py` | 1 | Browser closed mid-run | NOT_VERIFIED (environment) |
| `gemini_voice.py` | 1 | Browser closed during `Page.goto` | NOT_VERIFIED (environment) |
| `eleven_voice.py` | 1 | Browser closed mid-run | NOT_VERIFIED (environment) |

**Why the closures are not reported as product failures.** A bare page navigated three times in a
row with `networkidle` and stayed alive; `smoke.py` passed twice in the same environment after the failures
(24 and 25 checks, zero failures each). The closures cluster in flows that reload with route interception or
media. They are consistent with an incomplete headless-shell dependency set in this VM, but I did not
isolate the exact trigger, so the affected journeys are **NOT_VERIFIED**; nothing is claimed fixed or
broken on their evidence.

### `navigation_stability.py` failure explained

The script seeds `localStorage` **after** the first load, then reloads. The app flushes its session
on `pagehide`; at that moment its in-memory draft is empty, and `saveSession` removes the key for an
empty draft. The seeded session is therefore erased by the reload that is supposed to restore it.
The two restore checks assert on that erased state, so they fail. This is a harness ordering defect,
but it also exposes F16 below. The later strict-mode violation is a separate selector drift: two
elements now match `a[href="/"]`.

## New findings from this task

### F15 — P0 — the service worker serves the offline page for normal navigation

**Evidence (OBSERVED, production preview).** With `npm run preview` (built output, service worker
active), the first load rendered the translator (`textarea` count 1). A second navigation to `/`
rendered the offline document: `textarea` count 0, title `Offline — today`,
`navigator.serviceWorker.controller` present. Reproduced on every reload/navigation while online.

**Root cause.** `vite.config.ts` sets `navigateFallback: "/offline.html"`. The SSR document for `/`
is not precached, so Workbox answers every navigation with the offline fallback — online or not.
`?sw=off` avoids it, which is why the e2e suite can look green while a returning PWA user is stuck.

**Impact.** A returning installed user lands on the offline shell and cannot reach the draft or
translator. This is a release blocker, not a preview artefact.

**Fix (2026-11-14, follow-up).** `navigateFallback` is now `null`; leaving it unset is not enough,
because `vite-plugin-pwa` defaults it to `"index.html"`, which is not precached — that route throws
at registration and silently drops the routes after it. The worker now registers only the
NetworkFirst document route (with `PrecacheFallbackPlugin`) and the CacheFirst asset route.
`tests/e2e/pwa_navigation.py` failed against the old build (5 failures: reload, `/stats` and `/` all
served `Offline — today`) and passes against the new production build (19 checks): two online
navigations render the app, the document is present in `lingua-shell`, and, after deleting that
cache and going offline, the navigation still reaches `/offline.html`.

### F16 — P2 — an empty tab can clear the shared session

**Evidence (mechanism OBSERVED, two-tab impact SUSPECTED).** `pagehide`/`visibilitychange` flush the
current snapshot through `saveSession`, and `saveSession` removes `lingua.session.v1` when the draft
is empty. In `navigation_stability.py`, the flush on reload erased a session written moments earlier.
The same path means a second tab with an empty draft that is closed or hidden can delete the session
another tab is using, because the key is shared.

**Direction.** Remove the automatic delete-on-empty, or only clear when the user explicitly clears
the draft, and add a two-tab test. Not fixed in Task 2.

### F17 — P2 — e2e scripts do not wait for hydration

**Evidence (OBSERVED).** On a cold dev server, the first interaction in `smoke.py` failed until
navigation waited for `networkidle`; with the wait it passed 25/25. The scripts have no hydration
barrier and no shared helper.

**Direction.** Add a boot/hydration marker and a shared `open_app()` that waits for it; then remove
the external shim from the run instructions. Tracked with TD3.

## Commands actually run

```
npx vitest run src/lib/translation/parse.test.ts src/lib/storage.test.ts \
  src/lib/translation/stream.test.ts src/lib/translation/view.test.ts   # 25 passed
npm run test          # 311 passed / 4 skipped, 53 files, coverage 51.91/42.25/43.12/53.88
npm run typecheck     # exit 0
npm run lint -- --max-warnings 0   # exit 0
npm run build         # exit 0 (production build used for F15)
npm run preview       # served http://localhost:8080 (F15 probe)
python tests/e2e/*.py # matrix above, dev server, hydration shim
```

## Limits

- No provider credentials: real translation quality, latency and cost are **NOT_VERIFIED**.
- Theme, stats, shadow, voice and grow-box journeys are **NOT_VERIFIED** in this VM because the
  headless browser closed; they need a runner with the full Playwright dependency set.
- F15 was repaired in the immediate follow-up; the fix and its browser test are recorded above.
