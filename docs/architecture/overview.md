# Architecture Overview

Status: **Verified** against the source on 2026-11-07. Diagrams are syntax-reviewed but were not
rendered in this environment (no Mermaid CLI).

## Shape

A TanStack Start application with one server-rendered document shell and client-side routing. The
translator is the root screen; secondary routes share the shell. Server functions and API routes
own every secret and every provider call.

```mermaid
flowchart TD
  B[Browser document] --> R[Root route: shell, pre-paint boot, providers, error screens]
  R --> I["/ translator: composer, result, sheets"]
  R --> S["/stats local archive"]
  R --> P["/privacy, /arabic-german-translation"]
  I --> T[lib/translation: scheduler, stream, verify, memory]
  I --> V[lib/voice + tts]
  I --> PS[lib/persist + history + saved]
  T -->|POST /api/translate-stream| W[Worker]
  T -->|server functions: translate, repair, lexicon, shadow| W
  V -->|/api/speak, /api/eleven-speak| W
  W --> D[DeepSeek]
  W --> L[OpenCode / Luna]
```

## Layers and dependency direction

1. **Routes / components** compose UI and own interaction state. They do not construct prompts or
   talk to providers.
2. **Domain libraries** (`lib/translation`, `lib/voice`, `lib/stats`) are framework-light and mostly
   pure. They may depend on types and validators, not on React routes.
3. **Persistence** (`lib/persist`, `history`, `saved`, memory) validates everything read from the
   device. Preferences, session, archive and saved phrases are separate concerns with separate
   keys.
4. **Server boundary** (`routes/api/*`, `*.functions.ts`, `engine.server.ts`, `providers/*`) reads
   environment secrets, enforces same-origin and bounded input, streams output, and classifies
   failures.

Dependency direction is inward: routes → domain → types/validators. The domain never imports a
route. Provider modules are server-only.

## Rendering and navigation

- The root route renders `<html>` (shell), the boot scripts, `HeadContent`, `<Outlet />` and the
  error/not-found screens.
- Internal links use the router; navigation does not request a new document. View transitions are
  progressive enhancement.
- Route components unmount on navigation. Continuity comes from (a) the persistent root shell and
  (b) `persist.remembered()` seeding the translator's first render, plus the session and its cached
  result.
- Details and measured evidence: `docs/architecture/navigation-and-lifecycle.md`.

### Phase II surfaces (under the translator)

`src/lib/weather/` (contract, provider adapter + server route, bounded cache, `useWeather`,
`useWeatherLocation`) and `src/lib/culture/` (contract, generated corpus under `data/`, loader,
search, discovery, saved/seen, production adapter) are **independent verticals** composed by
`BelowCanvas`. The route renders that one component; it owns the lazy + deferred composition
(`WeatherSection`, `CultureSection` behind `DeferredMount`), while the weather module owns its two hooks and its dialogs, the culture section owns
its adapter and scroll/dialog state. Both are below the canvas in the same scroll container, never
overlays over the composer, and neither can fail the translation: their failures are local calm
states. Server boundaries are `POST /api/weather`, `POST /api/weather/place` and their
`/api/native/v1/*` twins; the culture catalog is bundled (no runtime API).

In this release both are **switched off in the translator**: `src/lib/features.ts`
(`SHOW_WEATHER`, `SHOW_CULTURE`) makes the `BelowCanvas` composition render nothing, so the
route reaches neither the lazy chunks nor the weather routes. The verticals, routes, corpus and
tests remain in place — hiding is not deletion — and turning a switch on restores the composition.

## State ownership

| State | Owner | Lifetime |
| --- | --- | --- |
| Draft, pair, style, dialect, brain | `src/routes/index.tsx` | Route mount; mirrored to session/prefs |
| Translation phase/result/cache | `lib/translation/useTranslator` | Route mount; settled results also in device memory |
| Theme | `lib/theme` store | Tab + storage |
| Interface locale | `lib/i18n` store | Tab + storage |
| History / stats | `lib/history`, `lib/stats` | Device storage; stats derived |
| Saved phrases | `lib/saved` | Device storage |
| Voice preferences | `lib/voice` preferences | Device storage (versioned migration) |

## Error handling

- Route-level: `ErrorScreen` and `NotFoundScreen` are product surfaces; no stack traces to people.
- Translation-level: `useTranslator` maps error kinds to phases, preserves the last good result,
  makes one attempt on the selected model and shows a failure immediately.
- Server-level: same-origin rejection, rate limit, bounded JSON, provider error classification,
  cancellation treated as a quiet end rather than an error.
- Last resort: a standalone offline/error page generated for the service worker.

## External boundaries

- **DeepSeek** is the default writer and the analysis provider; it no longer reviews another
  model's answer. Active.
- **OpenCode / Luna** is a selectable writer. Selection is strict: the other model is never called
  for the same translation, never takes over and never rewrites it. Active; routing lives in
  `engine.server.ts` and the translate-stream route, and both keys stay server-side.
- **Speech providers** are called only by server routes; keys never reach the browser.
- **Google Fonts** are self-hosted; there is no font CDN in the critical path.

## Structural notes and debt

`src/routes/index.tsx` is large (~1,060 lines) because it composes the whole translator, boot
restore, voice, shadow and sheets. Behaviour is delegated to hooks and libraries, but the route is
still the main coordination point. Splitting it further is recorded as debt, not done speculatively;
see `docs/audits/technical-debt.md`.
