# Deep Audit and Quality Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every finding must carry an
> evidence class from `docs/quality/testing.md`; never report an unrun check as a pass.

**Goal:** Produce a complete, evidence-backed register of defects, inconsistencies and unverified
claims in the translator, then repair them in severity waves so the app stays meaning-first,
private by design, and sustainable.

**Architecture:** Three layers of evidence. (1) Static review of nine subsystems, each with named
files and hypotheses. (2) Executable evidence: the Vitest suite with coverage enforced, the Python
Playwright suite, and a fault-injection matrix that forces the failure modes the app classifies.
(3) A single ranked register where every confirmed defect becomes a regression test **before** its
fix, and every claim in `docs/` is either matched to code or corrected.

**Tech Stack:** TanStack Start + TanStack Router, React 19, Vite 8, Vitest 5, Python Playwright,
Cloudflare Worker build output, `node scripts/*` gates.

**Spec:** `PROJECT_CONSTITUTION.md`, `DEFINITION_OF_DONE.md`, `docs/architecture/overview.md`,
`docs/quality/testing.md`, `docs/security/privacy-and-threat-model.md`,
`docs/translation/pipeline.md`.

**ملخص عربي:** هذه الخطة تُنتج سجلًّا مُصنَّفًا لكل عيب أو تناقض أو ادعاء غير مُقاس، بدليل من الكود أو
التشغيل، ثم تُصلحه على موجات حسب الشدة. تبدأ بتثبيت البوابات (التغطية + الوثائق في CI)، ولا تُغيّر
هوية المنتج ولا تضيف ميزات.

## Global Constraints

- Preserve the product identity: one screen, meaning-first Arabic ⇄ German, no feature work in this
  program. No new abstraction without a current, named consumer.
- Never weaken an assertion, skip a gate, or silence a linter to make a check pass.
- Evidence classes only: **VERIFIED**, **OBSERVED**, **SUSPECTED**, **NOT_VERIFIED**,
  **NOT_APPLICABLE**. A route that renders is not proof its behaviour works.
- No secret, user text, stack trace or provider body in logs, tests, documents or reports.
- No force-push, rebase or history rewrite. The branch stays working at every commit.
- Every fix: reproduce → root cause → failing test (RED) → minimal fix (GREEN) → narrow gate →
  `npm run verify` → documentation update → commit.
- `npm run build` is required whenever routing, bundling, headers, the service worker or server
  code changes; `npm run check:pwa` follows it.
- Any behaviour change needs a line in `docs/audits/technical-debt.md` (open) or its Closed table
  (fixed, with evidence). Never mark unverified work as fixed.

## Review Focus

These are the input classes the current tests do not exercise, most likely to reach a person first:

1. A provider reply whose `targetLanguage` disagrees with the requested target — does the screen
   ever leave a permanent pending state?
2. A deliberate server cancellation (`204`) and a truncated provider stream — are they classified
   as cancellation/retry, or as a provider failure?
3. Corrupted or older device rows (missing `confidence`, missing `known`, unindexed plan docs) —
   do they degrade gracefully or silently empty a store?
4. A model reply that drops a proper name, and a German noun that is not a name — does the verifier
   distinguish them in the two product directions?
5. A production preview origin (`*.style.dev`) — does a service worker register and serve a stale
   shell?

---

## Baseline (executed 2026-11-14)

Recorded from real runs in this worktree; full detail in `docs/audits/2026-11-14-baseline.md`.

| Gate | Command | Result |
| --- | --- | --- |
| Install | `npm ci` | **FAILED**: lockfile out of sync (`@lovable.dev/vite-tanstack-config` 2.26.5 vs 2.27.1) |
| Install (synced) | `npm install --no-audit --no-fund` | PASS, 624 packages, 4 insertions / 54 deletions in lockfile |
| Types | `npm run typecheck` | PASS, exit 0 |
| Lint | `npm run lint -- --max-warnings 0` | PASS, exit 0 |
| Tests | `npm run test` | PASS, **302 passed / 4 skipped, 51 files, 8.47 s** |
| Coverage | `npx vitest run --coverage` | PASS, **51.79 stmts / 41.86 branch / 42.92 funcs / 53.74 lines** |
| Contrast | `npm run check:contrast` | PASS, **51/51 pairs** |
| Docs | `npm run check:docs` | PASS, **28 documents, 8 relative links** |
| Build | `npm run build` | PASS |
| PWA | `npm run check:pwa` | PASS, **37 precached files, 35 hashed assets** |
| Bundle | `du -sh .output/public` | **1.6 MB total, 1.4 MB assets** |
| Audit (prod) | `npm audit --omit=dev` | **0 vulnerabilities** |
| Audit (all) | `npm audit` | **14 (2 low, 12 moderate), dev tree only** |

**Baseline blocker and repair:** `npm ci` could not install on a clean checkout, so every CI run
would have failed at the install step before reaching a gate. The lockfile was synced to the pinned
range with no dependency upgrade; `npm ci --dry-run` now exits 0.

**Gate defects fixed in Task 1, before any product change:**

- `package.json` ran Vitest without `--coverage`, and `vitest.config.ts` sets no
  `coverage.enabled`, so the 48/46/39/39 thresholds could never fire. Both README and
  `docs/quality/testing.md` claimed they were enforced.
- CI ran typecheck, lint, tests, contrast, build and PWA — but not `check:docs`, although
  `AGENTS.md` and the Definition of Done make it a gate.

---

## Pre-audit findings (static inspection, to be confirmed or refuted)

These are inputs to Task 2-9, not conclusions. Each must be reproduced and then either fixed with a
test or closed with a reason.

| ID | Sev | Location | Observation | Evidence | Direction |
| --- | --- | --- | --- | --- | --- |
| F1 | P1 | `src/routes/index.tsx:340-355` | A model reply whose `targetLanguage` differs from the requested target hides the result and leaves `pending` true forever; no request is in flight, so nothing self-heals. | VERIFIED (source) | Ignore the model's `targetLanguage` for routing; derive from the request, or recover explicitly. |
| F2 | P1 | `package.json:12`, `vitest.config.ts:22` | Coverage floors never executed. | VERIFIED (run + config) | Task 1. |
| F3 | P2 | `.github/workflows/ci.yml` | `check:docs` absent from CI. | VERIFIED (source) | Task 1. |
| F4 | P2 | `src/lib/translation/verify.ts:168` | Name check is skipped whenever either side is Arabic, i.e. both product directions; for other pairs every capitalised German noun is a false "dropped name". | VERIFIED (source) | Rebuild the check around capitalisation-independent, direction-aware evidence. |
| F5 | P2 | `src/lib/persist.ts:52` | `isResult` validates 4 of 10 result fields, unlike `ResultSchema`; corrupt rows reach the UI and translation memory. | VERIFIED (source) | Share one result validator between server and storage. |
| F6 | P2 | `src/lib/translation/stream.ts` | A bodiless `2xx` (the route's quiet `204` cancellation) is parsed as JSON, fails, and becomes `kind: "provider"`. | VERIFIED (source) | Classify `204`/no-body as cancellation, not failure. |
| F7 | P2 | `src/lib/pwa.ts` | `refused()` does not exclude `*.style.dev` preview origins; a production preview registers a service worker and can serve a stale shell. | VERIFIED (source) | Extend the ephemeral-host list and document `?sw=off`. |
| F8 | P2 | `src/routes/index.tsx:675`, `src/lib/saved.ts:113` | `saved.ofTheDay()` calls `Date.now()` during render, contradicting the `useTodayKey()` rule; the phrase cannot roll over at midnight. | VERIFIED (source) | Move the day into the existing external store. |
| F9 | P2 | `package.json`, repo root | `bun.lock` and `package-lock.json` both exist; CI uses npm only. | VERIFIED (tree) | Decide one lockfile; delete or regenerate the other with evidence. |
| F10 | P2 | `src/components/translator/ResultPanel.tsx` | After first user activation, every settled translation prefetches full cloud speech, spending a paid provider without an explicit Listen tap. | SUSPECTED (cost depends on keys) | Measure, then bound or gate prefetch. |
| F11 | P3 | `PROJECT_MAP.md` | Claims `persist.ts` depends on `src/lib/storage`, which does not exist (only `storage.test.ts`). | VERIFIED (tree) | Correct the map. |
| F12 | P3 | `src/lib/translation/engine.server.ts` | `runReview`/`shouldFallBack` are unreachable while `LUNA_ENABLED = false`. | VERIFIED (source) | Keep with an explicit paused-path test, or remove with an ADR. |
| F13 | P3 | `history.ts`, `saved.ts`, `useTranslator.ts`, `useShadow.ts` | Four whitespace-normalisation implementations and four copies of the 5,000-character cap. | VERIFIED (source) | One shared pure module, behaviour-preserving tests first. |
| F14 | P3 | `src/routes/index.tsx:340`, session save | A Sentence Shadow fix updates history/saved but the session snapshot stores the base translation; a reload reverts the text while the archive keeps the fix. | SUSPECTED (needs runtime repro) | Define one persisted truth for an applied fix. |
| F15 | **P0** | `vite.config.ts` (`navigateFallback: "/offline.html"`) | In the production build with the service worker active, every navigation/reload serves the offline document while online (textarea 1 → 0, title `Offline — today`, controller present). The SSR `/` document is not precached, so Workbox falls back for all navigations. | **FIXED 2026-11-14** (was VERIFIED, run) | `navigateFallback: null` (the plugin default also injected a non-precached `index.html` route); NetworkFirst documents + `PrecacheFallbackPlugin`; `tests/e2e/pwa_navigation.py` RED→GREEN on the production build. |
| F16 | P2 | `src/lib/persist.ts`, pagehide flush in `src/routes/index.tsx` | The flush saves the current snapshot; an empty draft removes the shared session key. Observed erasing a just-seeded session on reload; a second empty tab can therefore clear another tab's draft. | OBSERVED (mechanism), SUSPECTED (two tabs) | Stop deleting on empty by default; test two tabs. |
| F17 | P2 | `tests/e2e/*.py` | Scripts click before hydration on a cold dev server; no wait barrier. With `wait_until="networkidle"` smoke passes 25/25. | OBSERVED | Shared `open_app()` waiting on a hydration marker; see TD3. |

---

## Task 1: Gate integrity (do this first, alone)

**Files:**
- Modify: `package.json` (`test` script)
- Modify: `.github/workflows/ci.yml`
- Test: the existing suite, run through the changed command

**Interfaces:**
- Produces: `npm run test` collects coverage and fails below the configured thresholds; CI runs
  `check:docs` on every push and pull request.

- [x] **Step 1: Confirm the floors pass before enforcement**

Run: `npx vitest run --config vitest.config.ts --coverage`
Expected: exit 0; totals at or above 46 statements / 39 branches / 39 functions / 48 lines.
Recorded: 51.79 / 41.86 / 42.92 / 53.74.

- [x] **Step 2: Make `npm run test` collect coverage**

Change `"test": "vitest run --config vitest.config.ts --coverage"`. Do not lower a threshold.

- [x] **Step 3: Add the documentation gate to CI**

Add a step running `npm run check:docs` after lint and before tests.

- [x] **Step 3b: Exclude the generated coverage report from ESLint**

`coverage/*.js` (Istanbul's HTML assets) is not source. Run `npm run lint` **after** a coverage
run to prove the exclusion, not before.

- [x] **Step 4: Verify both changes**

Run: `npm run test` → expect PASS with a coverage table and exit 0.
Run: `npm run check:docs` → expect PASS.
Run: `npm ci --dry-run` → expect exit 0 (lockfile in sync).

---

## Task 2: Request lifecycle and stuck states

**Files:** `src/lib/translation/useTranslator.ts`, `stream.ts`, `scheduler.ts`, `restore.ts`,
`src/routes/index.tsx`, related tests.

**Focus:** request identity (`keyOf` vs exported `translationKey`), supersession tokens, lingering
streams, `shownLen` gating, retry timers, 204/abort classification, `staleTarget`, `quietRef`
normalisation, cache vs device-memory divergence.

- [x] Write failing tests for F1 and F6 first.
- [x] Prove each fix by re-running only those tests, then the whole suite.
- [x] Record any behaviour change in `docs/architecture/state-and-persistence.md`.

**Result (2026-11-14).** F1 and F6 reproduced with failing tests, then fixed: `parse.ts` takes the
request's target, `view.ts` owns `resultState`, `parseSession` drops a result for another target,
and `stream.ts` classifies `204` as `cancelled`. Targeted 25/25; full suite 311 passed / 4 skipped,
coverage 51.91/42.25/43.12/53.88. Playwright matrix and new findings F15 (P0 service worker) and
F16 (session wipe) are in `docs/audits/2026-11-14-task2-request-lifecycle.md`.

## Task 3: Server boundary and provider protocol

**Files:** `src/routes/api/*.ts`, `src/lib/requestSafety.ts`, `translation/throttle.ts`,
`translation/providers/*.server.ts`, `translation/*.functions.ts`.

**Focus:** token spent before validation, `sameOrigin` with no `Origin`, `clientAddress` trusting
`X-Forwarded-For`, completion-event enforcement in `textDeltas`, provider error bodies in messages,
per-purpose budgets, `Retry-After`, duplicate verification sites.

- [x] Probe each endpoint with malformed, oversized, cross-origin and replayed requests.
- [x] Confirm no text or key reaches a log or a client-visible error on the probed paths; live provider paths remain NOT_VERIFIED.

**Worked 2026-11-14.** F18: all three raw routes spent admission before parsing; fixed with
`parseAdmittedJson`, proven by probes (70 malformed → 70×400; valid next → 502, not 429). F19:
provider error messages carried the provider body; now status only, with a unit test. F20: the
dictation token endpoint had no budget; now `takeDictationToken`. F21: it also returned the raw
AssemblyAI error to the user; now a calm message and status-only log. Replay caps were measured
(60/10 for translation, 40/5 for both speech routes), and `verifyTranslation` was confirmed to have
one implementation with distinct call sites. Details in
`docs/audits/2026-11-14-task3-server-boundary.md`. Live-provider paths remain NOT_VERIFIED.

## Task 4: Local data integrity and migration

**Files:** `persist.ts`, `history.ts`, `saved.ts`, `translation/memory.ts`, `stats/*`.

**Focus:** F5, F8, F9, F13, F14; quota shedding surface (`lastEvicted`), cross-tab storage events,
`clearAll` completeness (theme/locale included), damaged-row matrices, older-schema rows.

**Worked 2026-11-14.** F5: `isResult` checked four of ten fields; now one full validator in
`src/lib/translation/result.ts`, shared by storage, memory and the repair server function. F8:
`saved.ofTheDay(dayKey)` is pure and driven by `useTodayKey`, so the phrase rolls over at midnight.
Clear-all: `clearDeviceData()` resets saved/history/memory caches before removing `lingua.*`, and
memory now drops its cache on another tab's clear. Quota shedding and cross-tab history/phrasebook
were already covered and stay green. F9 (two lockfiles), F13 (six normalisers, three caps) and F14
(shadow snapshot, SUSPECTED) remain open. Report: `docs/audits/2026-11-14-task4-local-data.md`.

## Task 5: Voice, dictation and read-along

**Files:** `tts.ts`, `voice/*`, `useAssemblySpeech.ts`, `VoiceButton.tsx`, `VoiceSheet.tsx`.

**Focus:** generation guards, fallback from cloud to device, `PcmPlayer` gaps and `finish()`,
circuit breakers (`rate` ignored), warm-up flags, dictation turn ordering and shutdown deadline,
prefetch cost (F10).

## Task 6: Shadow and lexicon

**Files:** `translation/shadow*.ts`, `useShadow.ts`, `useLexicon.ts`, `SentenceShadow.tsx`.

**Focus:** offset re-anchoring, applied overlay vs persisted stores (F14), dismissed-loss keys,
background queue cancellation, stale generation, duplicate rendering for assistive technology.

## Task 7: UI, state coherence and accessibility

**Files:** `src/routes/index.tsx`, `components/translator/*`, `components/FailureScreen.tsx`,
`useFocusTrap.ts`, `styles.css`.

**Focus:** keyboard journey, focus return, `aria-live` duplication, RTL, reduced motion, sheet
loading, intro gate, theme transitions, `inert` behaviour, phrase-of-the-day day rollover.

## Task 8: Routing, SSR, PWA, headers, SEO

**Files:** `routes/__root.tsx`, `sitemap[.]xml.ts`, `lib/pwa.ts`, `lib/intro.ts`, `scripts/*`.

**Focus:** F7, `_headers` replay in `serve-build.mjs`, sitemap exclusions (`/stats`, `/lab`),
`noindex` coverage, hardcoded `lang="en"` (TD2), `/lab` production guard, offline shell.

## Task 9: Performance and sustainability

**Files:** build output, `package.json`, `vite.config.ts`, `vitest.config.ts`, lockfiles.

**Focus:** F9, F13; measured LCP/INP/CLS on mobile emulation, entry-chunk composition, font
payload, long tasks while typing, memory over 10 minutes, request count per settled sentence,
`npm audit` in CI on a schedule, TypeScript/Vite/Vitest version coherence.

## Task 10: Consolidate and repair in waves

**Files:** `docs/audits/2026-11-14-findings.md`, `docs/audits/technical-debt.md`,
`DOCUMENTATION_INDEX.md`.

- [ ] Merge every confirmed finding into one register: ID, severity, evidence class, repro, root
      cause, test name, fix direction, owner.
- [ ] Wave 1: all P0/P1. Wave 2: P2. Wave 3: P3, performance and sustainability.
- [ ] Each wave ends with `npm run verify`, `npm run build`, `npm run check:pwa`, the Playwright
      suite, and an updated debt register.
- [ ] Do not start Wave 2 while Wave 1 has an open P1 or a red gate.

## Runtime matrix (Task 2-8 evidence)

| Axis | Values |
| --- | --- |
| Viewport | 320, 390, 768, 1280 |
| Theme | dark, light, vivid |
| Direction | LTR, RTL |
| Motion | normal, reduced |
| Network | online, offline, slow, aborted, truncated stream, 204, 429, 502 |
| Storage | empty, valid, corrupted JSON, partial rows, full quota, two tabs |
| Input | empty, 1 char, 5,000 chars, mixed script, paste, dictation, rapid typing |
| Navigation | route away/back, refresh, back/forward, PWA relaunch |

## Definition of Done for this program

- Every finding is closed with a test that failed before the fix, or marked
  `NOT_VERIFIED`/deferred with a reason in the register.
- `npm run verify`, `npm run build`, `npm run check:pwa` and the Playwright suite are green.
- `npm run check:docs` is green and runs in CI.
- No document claims a capability, measurement or gate that the code does not provide.
- `docs/audits/technical-debt.md` reflects reality; closed items carry evidence.
