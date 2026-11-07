# Technical Debt Register

Status: **Living** (opened 2026-11-07). Severity measures impact on correctness, privacy or the
product promise — not effort. Never mark an item resolved without evidence.

| ID | Severity | Area | Evidence | Impact | Remediation |
| --- | --- | --- | --- | --- | --- |
| TD1 | **P1** | Translation quality | no keys, no reviewed corpus; `docs/translation/evaluation.md` | Quality claims cannot be made; regressions in prompts/models are invisible | Build a versioned, human-reviewed corpus per direction/register; record baseline and reviewer |
| TD2 | P2 | SSR localization | `LOCALE_BOOT` sets dir/lang, but copy hydrates from storage | Arabic/German readers see English copy briefly; SEO/copy mismatch | Localize the shell per request (cookie/header) or accept and document; do not fake it with CSS |
| TD3 | P2 | E2E coverage | Python suite exists; not in CI; not run in audit | Navigation/voice/stats regressions rely on manual checks | Add a CI job with Playwright and a built preview; start with `navigation_stability.py` + smoke |
| TD4 | P2 | Visual regression | no screenshots/pixel diffs in gates | A colour/spacing regression can pass all gates | Add a small visual set (themes, result, stats) with a tolerant diff, or document manual review |
| TD5 | P2 | Rate limiting | process-local token buckets | A multi-instance deployment can exceed intended limits; no edge bot defence | Keep limits; add hosting-edge protection and document the boundary |
| TD6 | P2 | Dependency security | `npm audit` not run in this audit | Unknown advisories | Run the ecosystem audit in CI on a schedule; triage with the lockfile policy |
| TD7 | P3 | Route size | `src/routes/index.tsx` ~1,060 lines | Harder review and merge conflicts; boot/coordination logic concentrated | Extract boot restore and session persistence into a hook after a behaviour-preserving test exists |
| TD8 | P3 | Preview worker registration | ADR 0004; stale shell observed | Preview runs can mimic product bugs | Add ephemeral preview hosts to `refused()` or always test with `?sw=off`; document the escape hatch |
| TD9 | P3 | Performance evidence | no Lighthouse/profile/long-run memory measurement | Budgets are asserted from behaviour, not measured under load | Profile first load, typing, long translation and 10-minute memory; set budgets from data |
| TD11 | P3 | Lab route | `/lab` is development-only by intent | If shipped unguarded, it exposes experiments | Verify the route is excluded/guarded in production builds; add a build assertion |
| TD12 | P3 | Device matrix | one Chromium cloud browser; no physical devices | Keyboard, screen reader, iOS PWA and reduced motion are not proven | Test a small named matrix (Android Chrome, iOS Safari, desktop Firefox) and record results |
| TD13 | P3 | Preview-only transient | two isolated route boundaries after build/server/preview switches; 25 subsequent checks clean | Can mimic a navigation defect during verification and erode trust in test runs | Reproduce on a fresh worker-less origin in CI; capture the boundary error via telemetry before changing code |

## Closed in this audit

| ID | Finding | Evidence |
| --- | --- | --- |
| D1 | Restored translation lost / re-requested | `restore.test.ts`, carried-result test, browser |
| D2 | Remount painted empty translator | remembered values + initial state; ~64 ms return |
| D3 | Background flash during transitions | overlay backdrop, equal timing, frame sampling |
| D4 | Stale browser-chrome colour | `syncThemeColor`, root effect, dark `#12100f` + light `#f7f3ec` on `/stats` |
| D5 | LTR→RTL first paint | `LOCALE_BOOT` + tests |
| D6 | Deprecated validator API | `.validator()`, gates green |
| D7 | Dead font-CDN cache rule | removed, PWA check 37 files |

## Rules for this register

- Add an item when a limitation is discovered, even if it will not be fixed now.
- Include evidence and a concrete remediation; "improve quality" is not an item.
- Do not delete a closed item in the same release that closed it; move it to "Closed" with evidence.
- A P1 item blocks a quality claim, not necessarily a release; state that explicitly in release notes.
