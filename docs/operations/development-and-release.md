# Development and Release

Status: **Verified** on 2026-11-07. Deployment infrastructure was not exercised; this document
describes what the repository actually contains, not an imagined pipeline.

## Requirements

- Node.js **22.12+** (see `package.json` engines).
- `npm ci` with the committed `package-lock.json` (do not upgrade dependencies to restore a build).
- `.env` copied from `.env.example`. At least `DEEPSEEK_API_KEY` is needed for real translations;
  speech providers have their own keys. Never commit `.env`.

## Local development

```sh
npm ci
cp .env.example .env
npm run dev        # http://localhost:8080
```

The UI runs without keys; translation fails with a calm state. The dev server does not register a
service worker (`src/lib/pwa.ts` refuses outside production). If a production preview was visited on
the same origin, unregister the worker or use `?sw=off`; a stale shell can otherwise masquerade as an
app error.

## Gates

```sh
npm run verify           # typecheck + lint + tests + contrast
npm run check:docs       # links + documentation inventory
npm run build            # Worker bundle, headers, PWA precache
npm run check:pwa
```

## Production build and preview

```sh
npm run build
npm run preview          # Node adapter for the exact Worker bundle, default :8080
PORT=3002 npm run preview
```

`vite preview` cannot serve the Worker output. `scripts/serve-build.mjs` imports the built handler,
serves static assets with the generated headers, and streams responses. Use it for pre-deploy checks.

## Deployment assumptions

- The build targets a Cloudflare Worker with static assets; Lovable builds from the connected
  repository.
- `scripts/build-headers.mjs` writes security headers after the platform's own rewrite step.
- `vite-plugin-pwa` writes `sw.js` and the precache into `.output/public`; the worker serves
  `/offline.html` only when a navigation fetch fails and no document is cached.
- Environment secrets are configured in the hosting environment, never in the repository.
- The audit did **not** deploy, push, or verify the live hosting configuration.

## Diagnostics

| Symptom | First checks |
| --- | --- |
| App shows a calm error after switching builds | a service worker may be serving an old shell; unregister it, clear caches, retry with `?sw=off` |
| Translation fails immediately | provider key present? provider status? server logs show outcome/kind, never text |
| 403 on a preview host | host allowlist / preview authentication; a `.style.dev` preview rejects requests without the owner's session |
| No offline page | `check:pwa` output, `sw.js` in `.output/public`, `_headers` |
| Theme/background wrong on one route | `theme-color` sync, `html` background, `--color-background` token |
| Draft lost after navigation | `persist.remembered()`, session write/flush, restore plan tests |

The production adapter logs request errors to its own output; provider logs are structured JSON with
metrics only. Do not add text to them while debugging.

## Incidents

1. Reproduce with the production bundle, not only the dev server.
2. Rule out a stale service worker/preview shell before changing code.
3. Check the gates; a red gate is evidence, not noise.
4. Preserve user data: storage keys are versioned and read through validators. Do not "fix" a
   migration by deleting user keys.
5. Record the cause and the missing test in `docs/audits/technical-debt.md`.

## Dependency policy

- Keep the lockfile; no opportunistic upgrades during a defect fix.
- A dependency update is a change with its own build, tests and a note in the release summary.
- Security advisories should be checked with the ecosystem's audit tool; this audit did not run one,
  so no vulnerability-free claim is made.
- Prefer the platform's existing libraries (router, query, Tailwind) over adding a new abstraction.

## Release checklist

- [ ] `npm run verify` green.
- [ ] `npm run check:docs` green.
- [ ] `npm run build` + `check:pwa` green.
- [ ] Production preview exercised: translate (mocked or real), navigate away/back, refresh, theme,
      stats, offline shell.
- [ ] No secret in built assets; headers present.
- [ ] Remaining risks and unverified areas stated.
- [ ] Connected branch left working; published history not rewritten.
