# Web Upgrade Audit — 2026-11-16

Status: **Verified** for every command and measurement listed here. Device, iOS Safari and
provider-diversity limits are stated as **NOT_VERIFIED** rather than implied. This audit covers the
web app only; the Android shell was not changed.

## Starting point

- Clone was 3 commits behind `origin/main` (Codebuff web work: still composer, persistence polish,
  statistics landscape); it was fast-forwarded to `9c66735` before any change.
- Baseline gates were green: `npm run verify` (types, lint, tests, contrast, docs) and
  `npm run build` both exited 0 before edits.
- The user's brief: upgrade the web project and site (no APK), find and fix engineering,
  architectural and design gaps, make the experience feel native and smooth, improve local storage,
  harden model paths/prompts/responses/accuracy without throttling the models, beautify the
  "خريطة ممارستك" section of Translation Statistics, restore the lost translation-generation effect,
  then commit, push and merge.

## Defects found and closed

| ID  | Finding                                                                                                                                                                               | Evidence before                                                          | Fix and evidence after                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W1  | The signature streamed-word "whirlwind" effect had been deleted; the replaced effect was a 240 ms slide and the old one promoted every settled word layer / animated `letter-spacing` | git history of `styles.css` and the 2026-11-16 persistence commit        | Restored as a paint-only, RTL-mirrored whirlwind (`stream-word-in`): blur + warm signal trail + skew/spin, 360 ms, capped to 28 fresh words, classes retained across chunks, `will-change` only under `data-streaming`, fade under reduced motion, decorative live caret. Screenshot: `evidence/.../streaming-whirlwind.jpg`. Tests: `StreamingText.test.tsx` (4).                                                                                                                                                       |
| W2  | Provider deltas committed one React render each; under load this is jank while an answer streams                                                                                      | `useTranslator` called `setResult` per chunk                             | Deltas are buffered and painted once per animation frame; a settled answer is always committed from the response text, never from a scheduled paint; frames are cancelled on error/supersede/unmount. Composer stayed 122.4 px and never overlapped the result (below).                                                                                                                                                                                                                                                  |
| W3  | A 5,000-character full translation was silently cut: `max_tokens` capped at 4,096, so the JSON ended mid-string and became a provider error after retry                               | live reproduction: HTTP 200, 13,061 bytes, `Unterminated string in JSON` | Structured ceiling 16,384 / live 8,192 (provider accepts 16,384, probed); `finish_reason: "length"`, `content_filter`, unknown reasons and `response.incomplete` are provider errors; one plain-text salvage runs through the verifier and is never stored in memory; prompt mirrors length/repetition. Same input after: valid JSON, 7,016 translated characters, 6.53 s.                                                                                                                                               |
| W4  | A stale/empty tab could clear another tab's draft (TD14)                                                                                                                              | code reading: empty session deleted the storage key on `pagehide`        | Web session envelope with `at`/`origin`; stale whole-session writes return `"refused-stale"`; empty drafts are empty records; legacy bare sessions still read; `clearAll()` resets the epoch; cross-tab `storage` subscription with a stable snapshot. Two-tab Chromium run: both stale saves refused, newer draft kept, prefs event observed with no reload. Tests: `persistence.test.ts` (21), `storage.test.ts` (18).                                                                                                 |
| W5  | No storage-health surface; "make storage durable" was invisible and failures/trims were only in memory                                                                                | privacy page reading                                                     | The privacy page now shows archive/saved rows, `storage.estimate()` used/quota with a bar, persisted state and a durable-storage action, plus last-write/trim warnings, in en/ar/de. Screenshot: `evidence/.../storage-privacy-ar.jpg`. Tests: `health.test.ts` (7), `DataControls.test.tsx` (3).                                                                                                                                                                                                                        |
| W6  | No update signal on the web; auto-update swapped the worker silently while the open document ran old chunks                                                                           | `pwa.ts` registered only                                                 | A dismissible update pill appears only after a handover on a page that already had a controller (first install is not an update) and never reloads on its own. `shouldAnnounceUpdate` tests + `UpdateNotice.test.tsx`.                                                                                                                                                                                                                                                                                                   |
| W7  | The "practice landscape" was four metric cards plus a pill row; the user called it ugly                                                                                               | before screenshot                                                        | New SVG practice map: center focus domain, up to 9 ranked orbit satellites sized/ribboned by frequency, 42-day trail ring, domain colours, always-visible labels and percentages, integrated typographic readout, keyboard buttons with `aria-pressed`, focus ring, reduced-motion-safe mount transitions, i18n summary/legend. Before/after: `evidence/.../practice-map-before.jpg`, `practice-map-after-mobile.jpg`, `practice-map-after-desktop.jpg`. Pure `practiceTrail()` + 4 new tests, 4 rewritten render tests. |

## Additional hardening

- **Provider retries:** one pre-stream retry for 429/500/502/503/504 or a network failure, with
  `Retry-After` clamped to 2.5 s and 200–600 ms jitter otherwise; cancelled, unauthorised, paid
  and already-handed-off streams are never retried. Shared helper: `providers/retry.server.ts`.
- **Prompts:** explicit layout/list/heading preservation, code/URLs/emails/handles/placeholders
  byte-for-byte, no markup translation, consistent recurring terms, no labels/quotes/fences,
  return unchanged when already in the target language, mirror length and repetition, never answer
  the source. Prompt sizes stay under the latency budget (3,793 / 1,801 chars).
- **Admission:** live typing 120 burst / 4 s⁻¹, settled 90 / 2 s⁻¹, warm-up, repair and enrichment
  widened; these are admission ceilings above human writing speed, not model throttles.
- **Touch/selection polish:** press controls are not selectable / do not show a touch callout; the
  update pill and practice map respect safe areas and the three themes.

## Executed evidence

All commands ran from the project root on 2026-11-16.

| Check                | Command                                                  | Result                                                                                                                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full gate            | `npm run verify`                                         | **exit 0** — tsc clean, eslint `--max-warnings 0` clean, **75 test files / 461 passed / 4 skipped**, contrast **51/51** pairs, docs **52 documents / 18 links** indexed                                                                                                                           |
| Production build     | `npm run build`                                          | **exit 0** — rolldown build, security headers written                                                                                                                                                                                                                                             |
| PWA integrity        | `node scripts/check-pwa.mjs`                             | **PWA ok — 56 precached files, 54 hashed assets**                                                                                                                                                                                                                                                 |
| Production preview   | `PORT=8090 npm run preview` + Chromium                   | **LCP 108 ms / DOMContentLoaded 65 ms / load 88 ms** (localhost), composer present, service worker `ready` and controlling; CSP/HSTS/X-Frame-Options/Permissions-Policy present                                                                                                                   |
| Offline relaunch     | kill the preview server, reload                          | **loaded from the precached shell**, composer present, only the expected `ERR_CONNECTION_REFUSED` console line; screenshot `evidence/.../offline-relaunch.jpg`                                                                                                                                    |
| Streaming smoothness | Playwright rAF sampling at 390×844, real DeepSeek stream | unthrottled **60 fps, 0 long tasks, max frame gap 17 ms**; 6× CPU throttle avg **22–23 ms (~44 fps)**, 10–13 long tasks ≤73 ms, max gap 100–117 ms; disabling the whirlwind gave the same long-task count (React + text layout dominate, not the blur); reduced-motion emulation rendered cleanly |
| Layout stillness     | same run                                                 | composer **122.4 px** in every sample, no overlap with the result, result text streamed visibly                                                                                                                                                                                                   |
| Long translation     | `POST /api/translate-stream`, mode=full, 5,000 chars     | before: 13,061 bytes, invalid JSON; after: **valid JSON, 7,016 chars, 6.53 s**; a 2,926-char varied text → valid 4,297-char JSON in 5.37 s                                                                                                                                                        |
| Live latency         | same endpoint, real key                                  | first byte **0.29–0.36 s**, complete **0.68–0.90 s**; formal German→Arabic full reply 1.34 s                                                                                                                                                                                                      |
| Statistics page      | Playwright, 6× CPU throttle, 240 rows                    | map ready **550 ms**, scroll **60 fps / 0 long tasks**, 9 topics, 30 trail dots                                                                                                                                                                                                                   |
| Map resilience       | 3 locales × 3 themes × 320 & 390 px                      | 18/18 combinations: **no horizontal overflow, no label outside the viewport, no page errors**, 9 topic buttons and 30 trail marks each                                                                                                                                                            |
| Browser smoke        | mobile + desktop Chromium, seeded archive                | **0 page errors, 0 console errors** on home, statistics and privacy (first visit with data)                                                                                                                                                                                                       |

Measured classifications: all of the above are **VERIFIED** on this machine/browser unless a row says
otherwise. The offline and production numbers are from a local preview process, not a deployed edge.

## Not verified (stated, not implied)

- Physical Android/iOS hardware, Safari, Firefox and low-end GPU frame pacing.
- The update pill across two real deployments (the decision rule is unit-tested; the browser event
  order was not reproduced end-to-end).
- Luna/OpenCode, Gemini, ElevenLabs and AssemblyAI paths: no keys in this environment.
- The native Android adapter for the new web session envelope/cross-tab rules; the native path is
  deliberately unchanged and only unit-tested against the existing port.
- Long-run memory, battery and thermal behaviour.

## Documents updated

`AGENTS.md`, `PROJECT_MAP.md`, `docs/architecture/api-and-providers.md`,
`docs/architecture/state-and-persistence.md`, `docs/translation/pipeline.md`,
`docs/design/system.md`, `docs/design/motion-and-accessibility.md`,
`docs/audits/technical-debt.md` (TD14 closed as D45; W3/W6/W7 recorded as D46/D47; new residual
TD33–TD37), and `DOCUMENTATION_INDEX.md`.
