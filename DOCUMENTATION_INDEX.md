# Documentation Index

Status: **Verified** on 2026-11-07. Every authoritative document is listed here; a document that
is not listed is not authoritative. `npm run check:docs` enforces that every file in `docs/` is
indexed and that relative links resolve.

## Governance (root)

| Document | Scope | Source of truth | Status |
| --- | --- | --- | --- |
| `AGENTS.md` | Operating contract for humans and AI agents: sources of truth, commands, workflow, hard rules | this repository | Verified |
| `README.md` | Product introduction, setup, gates, layout, limits | package.json, scripts, source | Verified |
| `PROJECT_CONSTITUTION.md` | Permanent product and engineering principles | verified implementation + approved decisions | Verified |
| `PROJECT_MAP.md` | Repository/runtime map and dependency direction | source tree | Verified |
| `DEFINITION_OF_DONE.md` | Objective completion criteria | gates and process | Verified |
| `DOCUMENTATION_INDEX.md` | This index and authority order | all documents | Verified |

## Product

| Document | Scope | Consult when |
| --- | --- | --- |
| `docs/product/vision-and-scope.md` | Identity, users, principles, non-goals, terminology | deciding whether a change belongs in the product |
| `docs/product/capabilities-and-journeys.md` | Verified capabilities and the three-stage journeys (initial → execution → final), including navigation/return | changing a user-facing flow |

## Architecture

| Document | Scope | Consult when |
| --- | --- | --- |
| `docs/architecture/overview.md` | Rendering, routing, layers, data flow, provider boundaries | starting any structural change |
| `docs/architecture/navigation-and-lifecycle.md` | Root shell, pre-paint boot, view transitions, session continuity, measured navigation evidence | touching routing, theme, locale, boot or persistence-on-navigation |
| `docs/architecture/state-and-persistence.md` | Stores, storage keys, validators, remembered values, history/saved/memory | changing state, storage or restore |
| `docs/architecture/api-and-providers.md` | Server functions, streaming, speech, provider selection, failure classification | changing an endpoint or provider |
| `docs/architecture/decisions/0001-single-document-shell.md` | Why the app is one client-rendered document inside an SSR shell | questioning the router/rendering model |
| `docs/architecture/decisions/0002-session-owns-restore-pair.md` | Why the session pair wins over preferences on restore | touching restore, prefs or translation keys |
| `docs/architecture/decisions/0003-palette-before-paint.md` | Why the document owns the canvas and theme colour is synced after mount | touching themes, transitions or backgrounds |
| `docs/architecture/decisions/0004-service-worker-and-offline-shell.md` | Single registrar, precache, offline fallback, preview escape hatch | touching PWA, caching or deployment |

## Translation

| Document | Scope | Consult when |
| --- | --- | --- |
| `docs/translation/pipeline.md` | End-to-end request path: normalize → schedule → stream → parse → verify → repair/review → shadow → memory | changing translation behaviour |
| `docs/translation/registers-and-languages.md` | Register semantics, dialects, source resolution, direction-specific rules | changing prompts or language handling |
| `docs/translation/evaluation.md` | Evaluation corpus, deterministic checks, lab route, what is and is not verified | claiming quality or changing the model/prompt |

## Design

| Document | Scope | Consult when |
| --- | --- | --- |
| `docs/design/system.md` | Tokens, typography, surfaces, components, UI states | changing visual language or a component |
| `docs/design/motion-and-accessibility.md` | Motion principles, view transitions, reduced motion, focus, contrast, RTL | adding motion or an interactive control |

## Quality, security, operations

| Document | Scope | Consult when |
| --- | --- | --- |
| `docs/quality/testing.md` | Gate inventory, test architecture, evidence classifications, coverage limits | writing tests or reporting results |
| `docs/quality/navigation-regression.md` | The navigation/theme acceptance criteria and the automated e2e scenario | changing navigation, boot or transitions |
| `docs/security/privacy-and-threat-model.md` | Trust boundaries, secrets, input handling, LLM boundaries, logging, retention | touching server code, prompts, logs or storage |
| `docs/operations/development-and-release.md` | Local setup, build, preview, deployment assumptions, incident and dependency policy | building, releasing or diagnosing an environment |

## Audits and debt

| Document | Scope | Status |
| --- | --- | --- |
| `docs/audits/2026-11-07-baseline-and-repairs.md` | Baseline evidence, findings, repairs, verification matrix | Verified |
| `docs/audits/technical-debt.md` | Open debt with severity, location, impact and remediation | Living register |
| `docs/audits/final-report-ar.md` | Arabic final report: maturity, defects, navigation, architecture, inventory, limits | Verified |

## Historical (not authoritative)

| Document | Why it is kept |
| --- | --- |
| `AUDIT.md` | Record of the 2026-10-24 reliability pass |
| `تقرير-الترقية.md`, `تقرير-الترقية-٢.md`, `تقييم-التطبيق.md` | Earlier Arabic reports and scores; superseded by `docs/audits/` |
| `roadmap.md` (if present) | Earlier planning notes; not a commitment |

Historical documents may describe behaviour that no longer exists. Never use them to justify a
change; verify against source and current specifications.
