# Project Map

Status: **Verified** against the repository on 2026-11-17 (after the upgrade recorded in
`docs/audits/2026-11-17-upgrade.md`). This is a map, not a specification; behaviour is documented
in the linked files.

## Runtime shape

```text
Browser
  └─ TanStack Start document (SSR shell + hydration)
       ├─ root route: theme/locale/intro boot scripts, providers, error screens
       ├─ "/" translator route: composer, language bar, style, result, sheets
       ├─ "/about" the one public page: philosophy, how translation works, data, controls
       │    (sections #meaning, #translation, #privacy, #sent, #third-parties, #controls)
       ├─ "/privacy" → 301 /about#privacy, "/arabic-german-translation" → 301 /about#translation
       ├─ "/stats" local statistics (private, noindex)
       └─ "/lab" development-only experiments

Worker (Cloudflare target; Node adapter locally)
  ├─ server functions: translate, repair, lexicon, shadow
  ├─ /api/translate-stream  streaming text (GET warms the provider)
  ├─ /api/speak, /api/eleven-speak  cloud voice (server-held keys)
  └─ static assets + generated _headers + sw.js + offline.html
```

## Android shell

```text
today.fluently.app (Capacitor 8, minSdk 24, targetSdk 36)
  └─ WebView: bundled SPA from android-web/ (origin https://localhost)
       ├─ PersistencePort → LinguaStore bridge → Room lingua.db + DataStore
       ├─ LinguaFiles: SAF export/import of backups
       └─ LinguaTts: device voice when WebView has no speechSynthesis
  └─ Network: /api/native/v1/* on the Worker, exact origin allowlist
```

## Source layout

| Path                                                      | Responsibility                                                                                                                                        | Depends on                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `src/routes/__root.tsx`                                   | Document shell, pre-paint scripts, root error/not-found                                                                                               | theme, i18n, intro, FailureScreen               |
| `src/routes/index.tsx`                                    | Translator composition, boot restore, session/prefs writes, voice/shadow wiring                                                                       | lib/translation, persist, components/translator |
| `src/routes/stats.tsx`                                    | Statistics from the local archive; opens a record in the translator                                                                                   | lib/stats, history                              |
| `src/routes/about.tsx`                                     | The one public page: product explanation, translation philosophy, data disclosure, third parties, controls                                     | i18n, DataControls, ProviderKey, DiagnosticsPanel |
| `src/routes/privacy.tsx`, `arabic-german-translation.tsx` | Permanent (301) redirects into `/about` sections; keep old URLs and search results alive                                                          | TanStack `redirect`                            |
| `src/routes/api/*`                                        | Streaming, speech endpoints; same-origin, bounded JSON, per-purpose throttles                                                                         | lib/translation, lib/voice, requestSafety       |
| `src/lib/translation/`                                    | Scheduler (NFC identity), frame-coalesced stream client, prompt, providers (strict model selection, capability profiles per task class, protocol completion, corrected OpenCode session routing), parse, verify, memory, salvage, bounded priority enrichment queue, lexicon, shadow | types, requestSafety                            |
| `src/lib/translation/providers/capabilities.ts`            | The one table of what the active model can do, per task class (thinking/effort/temperature/JSON/output ceiling) and the context-fit guard             | budget, types                                   |
| `src/lib/translation/engine.server.ts`                     | Provider routing: translation, repair, review, and `runAnalysis` for dictionary/shadow; no feature imports a provider                               | providers, verify                               |
| `src/lib/persist.ts`                                      | Validated prefs/session, session recency (stale-write refusal), cross-tab subscription, module-level remembered snapshot, durable-storage request     | types, persistence                              |
| `src/lib/history.ts`, `saved.ts`, `stats/`                | Local archive, saved phrases, pure statistics                                                                                                         | persist-style validation                        |
| `src/lib/theme.ts`                                        | Three themes, pre-paint boot, `syncThemeColor`, view-transition reveal                                                                                | CSS tokens                                      |
| `src/lib/i18n.ts`                                         | Locale store, `LOCALE_BOOT`, RTL, document lang/dir                                                                                                   | React store                                     |
| `src/lib/intro.ts`                                        | First-run gate, pre-paint decision                                                                                                                    | storage                                         |
| `src/lib/voice/`, `tts.ts`                                | Device/cloud speech, PCM player, timing, fallbacks                                                                                                    | speech APIs                                     |
| `src/lib/feel/`                                           | Haptics/audio feedback façade                                                                                                                         | settings, device limits                         |
| `src/lib/persistence/`                                    | `PersistencePort`, web/native adapters, session envelope, storage-health derivation, backup envelope and import                                       | contracts, storage keys                         |
| `src/lib/features.ts`                                     | Product-surface switches (`SHOW_WEATHER`, `SHOW_CULTURE`, both false in this release); hiding is a switch, never a deletion                           | —                                               |
| `src/components/BelowCanvas.tsx`                          | Lazy/deferred composition of the weather and cultural-library sections; renders nothing while both switches are off                                   | features, DeferredMount, weather/culture        |
| `src/lib/native/`                                         | Transport, native URL config, bridge DTOs, streaming and voice URLs                                                                                   | persistence, speech                             |
| `src/lib/weather/`                                        | Phase II weather contract, Open-Meteo adapter + server route handler, versioned device cache, stale-while-revalidate hook, location/geocode/consent layer; **surface switched off in the translator** | requestSafety, persistence/settings, types      |
| `src/lib/culture/`                                        | Written cultural-library contract (CultureArticle v2), lazy validated corpus modules (`data/`, lazy modules), validating loader, search, discovery/ranking, saved+seen stores, production adapter; **surface switched off in the translator** | culture types, persistence/settings             |
| `src/components/weather/`, `src/components/culture/`      | Weather strip/dialog/picker; text-first cultural library with six editorial compositions, featured/feed/detail/filters/saved/states (no images)          | lib weather/culture, design tokens              |
| `src/routes/api/native/v1/`                               | Versioned native endpoints reusing the web handlers                                                                                                   | translation, voice, requestSafety               |
| `android/app/src/main/java/today/fluently/app/data/`      | Room entities/DAOs/database, DataStore, mapping, repository                                                                                           | Room, DataStore                                 |
| `android/app/src/main/java/today/fluently/app/bridge/`    | `LinguaStore`, `LinguaFiles`, `LinguaTts` plugins                                                                                                     | repository, SAF, TextToSpeech                   |
| `android/app/src/test/`                                   | Repository and migration tests (Robolectric)                                                                                                          | Room testing                                    |
| `docs/android/`                                           | Architecture, persistence, import/export, network, compatibility, build                                                                               | —                                               |
| `src/components/translator/`                              | ComposerField (native editing/IME), DictationText, language bar, style, result (whirlwind arrival), sheets, header, wordmark                          | lib + design tokens                             |
| `src/components/stats/`                                   | Practice map, rhythm, records, language flow, charts, record/filter sheets                                                                            | lib/stats, design tokens                        |
| `src/lib/composer.ts`                                     | Safe draft limit/direction and paragraph-preserving dictation joins                                                                                   | persistence text limit                          |
| `src/lib/pwa.ts`, `src/components/UpdateNotice.tsx`       | The only service-worker registrar and the dismissible update pill                                                                                     | build output, i18n                              |
| `src/styles.css`                                          | Tokens, themes, base layer, transitions, utilities                                                                                                    | —                                               |
| `scripts/`                                                | Headers (incl. img-src/Permissions-Policy), PWA integrity, contrast, docs, OG card, production preview, `scripts/culture/` research-seed pipeline, model-assisted article generation, validation, chunk build and corpus report | build output                                    |
| `tests/security/`                                        | CSP image-host equality gate + Permissions-Policy guard (`npm run check:security`)                                                                     | scripts, corpus media manifest                  |
| `tests/perf/`                                             | Phase II measurement harnesses (bundle, typing, long-session, request counts); reproducible, no paid traffic                                           | built output / dev server                       |
| `tests/e2e/`                                              | Playwright phone-sized checks (not in CI)                                                                                                             | running app                                     |

## Build and deployment

- `vite build` emits a Worker bundle under `.output/`; `scripts/build-headers.mjs` writes security
  headers after the platform's own rewrites; `vite-plugin-pwa` emits `sw.js` into `.output/public`
  with NetworkFirst documents and an offline fallback used only when a fetch fails.
- `scripts/check-pwa.mjs` fails if the precache stops containing the shell.
- `scripts/serve-build.mjs` runs the production bundle on Node for local verification.
- The connected Lovable project builds from the repository; a release is a normal fast-forward
  push to the connected branch (never a rewrite).
- Android is a separate target: `npm run build:native:web` → `android-web/`, then
  `npx cap sync android` and Gradle. It does not touch `vite.config.ts` or `wrangler.jsonc`,
  so a web deploy is unaffected. See `docs/android/build-and-release.md`.

## Generated and historical files

- `src/routeTree.gen.ts` is generated by the router plugin; never edit by hand.
- `.output/`, `dist/`, `node_modules/` are build artifacts and are not sources of truth.
- `AUDIT.md` and the root Arabic reports are historical records. Current knowledge lives in
  `docs/` and is indexed by `DOCUMENTATION_INDEX.md`.
