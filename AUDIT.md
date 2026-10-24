# Reliability audit — 2026-10-24

## Verified repairs and hardening in this pass

### Gates (the reason this file can be trusted)

- `tsc --noEmit`: **0 errors**.
- `eslint . --max-warnings 0`: **0 errors, 0 warnings** (was 514 errors / 45 warnings). Real defects fixed: an impure `Date.now()` during render, render-phase `setState` in effects, a memoisation gap that recreated five callbacks every render, useless escapes in the prompt literals, and a dead assignment. The remaining 35 React Compiler diagnostics were converted to explicit, reasoned `eslint-disable-next-line` comments — never silenced silently.
- `vitest`: **225 passed, 4 skipped**, 39 files, ~4s (was 26s: the suite now shares one jsdom per worker).
- `vite build` + `scripts/check-pwa.mjs`: precache **32 entries**, 12 self-hosted font files, no source maps shipped.
- CI added (`.github/workflows/ci.yml`): install → types → lint(0 warnings) → tests → build → PWA integrity on every push and pull request.

### Product fixes

- **PWA**: the worker wrote to `dist/client` while the server serves `.output/public`, so `precache` was **0 entries** — an installed app had no offline shell. It now precaches the shell and falls back to a new translated `/offline.html` for a first visit without a connection.
- **Fonts**: three Google Fonts families were loaded from a third-party origin in the critical path; they are now self-hosted (`@fontsource`), 12 woff2 files, zero external requests, precached for offline.
- **Rate limiting** was one shared bucket: a hidden repair pass, a dictionary lookup and the sentence being typed competed for the same tokens. Now four purpose-scoped buckets, and a throttled _live_ request no longer interrupts typing with a rate message. `/api/eleven-speak` — the most expensive endpoint — had **no limiter at all** and now uses the speech budget. `429` responses carry `Retry-After`.
- **Security headers** are generated into `_headers`: CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, COOP, `Permissions-Policy` (microphone only for self).
- **Accessibility**: every dialog (all five sheets) now traps focus, returns it to the opener, and blocks interaction behind it; `--faint` was raised from 3.5:1 to 5.1:1 (dark) and 5.4:1 (light), clearing WCAG AA; a keyboard skip-link reaches the text field.
- **Failure surfaces**: the 404, the error boundary and the last-resort server page are translated (ar/en/de), on-brand and calm; the last-resort page loads nothing from the network.
- **Statistics**: the day is now an external store (`useTodayKey`) instead of `Date.now()` during render — the page rolls over at midnight without a reload and stays pure; URL state parsing moved to a tested module.
- **SEO/social**: a generated 1200×630 `og.png` in the product's own fonts and palette, `og:image`/`twitter:image`, `WebApplication` JSON-LD, `og:locale`, and a public `/privacy` page in the sitemap.
- **Verification** (`verify.ts`) now also covers Arabic-Indic digits, dropped names, lost question marks, Arabic punctuation in the wrong output and invented explanations — with no false alarm when Arabic transliterates a name.
- **Preview**: `npm run preview` runs the real production bundle on Node (the build targets a worker), replaying `_headers`. Previously `vite preview` returned **500** on every route.

## Evidence

- Unit suite: **225 passed, 4 skipped**, 39 files. New coverage for the focus trap, per-purpose limiting, the statistics URL parser, the day store, the fallback pages and the PWA registrar.
- Production preview: `/` 200 · `/privacy` 200 · `/arabic-german-translation` 200 · `/sitemap.xml` 200 (3 URLs) · `/offline.html` 200 · unknown path 404.
- API probes against the built server: no key → `502 auth`; `Origin: https://evil.example` → `403`; 20,000 characters → `400`; the 31st request in a burst → `429`.

## Limits — what is still not proven

- **No live translation, speech or dictation was executed in this pass**: the environment has no provider keys. Prompt, parsing, verification and routing are reviewed and unit-tested; their linguistic quality is **not** measured here. `tests/eval/shadow_eval.ts` plus a 20-sentence manual set (dialect, pun, proper name, number, joke) in both directions is the required next evidence.
- **No browser rendering, touch or keyboard testing** was possible here (no browser binary): contrast, focus behaviour and layouts are verified by computation and unit tests, not by eye.
- The Python e2e suite (814 lines) still needs a local Playwright install and is **not** wired into CI; only the unit/build gates are continuous.
- Admission remains **process-local**: it is not a distributed guarantee, and clients behind the same proxy-reported address share a bucket. Hosting-edge abuse control is still required for public paid endpoints.
- CSP allows inline scripts (`unsafe-inline`) because TanStack streams per-route hydration data; a nonce would need per-response server middleware.
- No deployment-wide load test, no real concurrent paid-provider test, no physical-phone check.

## Repeatable checks

```sh
npm run verify && npm run build && node scripts/check-pwa.mjs
npm run build && npm run preview    # then: tests/e2e/*.py against it
```
