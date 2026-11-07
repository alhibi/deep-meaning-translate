# Project Constitution

Status: **Verified** against the implementation on 2026-11-07. Changes to these rules require an
ADR in `docs/architecture/decisions/` and an update to this file.

## 1. Identity

Deep Meaning Translate ("today") is a **meaning-first Arabic ⇄ German translator**. It is not a
dictionary, a language course, a chatbot, or a general translation dashboard. One screen, one job:
understand what the person means, then say it as a fluent native would.

The product's promise is semantic fidelity and natural expression. Anything that trades either for
decoration, feature count or a demo is a regression.

## 2. Non-negotiable product principles

1. **Meaning over words.** Idioms are rendered idiomatically; literal structure is not preserved
   at the cost of naturalness.
2. **The register is audible.** Natural, Formal and Casual must produce visibly different wording,
   not different labels over one voice.
3. **Facts survive.** Names, numbers, dates, URLs, emoji, paragraph breaks, negation, question
   marks and Arabic punctuation are preserved. The verification layer enforces what it can.
4. **No invention.** The model must not add explanations, soften certainty, or invent context.
   Genuine ambiguity is surfaced, not silently resolved.
5. **The interface is quiet.** The translator is the product. No dashboards, hero sections,
   decorative gradients, glassmorphism or AI-slop visuals.
6. **The app is one continuous space.** Navigation must not reconstruct the shell, flash a
   different background, reset the draft, or replay a translation request unnecessarily.
7. **Privacy is a feature.** Translation text is not logged, not used for metrics, and not stored
   off-device by the app. Device caches are validated and bounded.
8. **Failure is a product surface.** Errors are calm, translated, preserve the draft, and offer a
   retry. No status codes or stack traces in front of a person.
9. **Correctness beats spectacle.** No animation, cache or optimistic state may hide a rendering
   or data defect.

## 3. Architectural commitments

- **One document, one shell.** TanStack Start renders the shell; internal navigation is client-side.
  The root layout, theme, locale and providers stay mounted across routes.
- **One source of truth per concern.** Persistence is `src/lib/persist.ts` with validators mirroring
  the server schema. Translation request identity is defined once in `useTranslator.ts`. Prompts
  live only in `src/lib/translation/prompt.ts`. Stats are derived from history, not stored twice.
- **Server owns secrets and providers.** Provider keys are read only inside server handlers. The
  browser never receives a key, and no provider fallback is invented while Luna is paused.
- **Palette before paint.** `THEME_BOOT`, `LOCALE_BOOT` and `INTRO_BOOT` run before the app hydrates.
  The document owns its canvas colour. A route transition may not reveal the browser's default.
- **The session owns its pair.** A restored draft is translated with the pair it was written in;
  preferences only fill gaps. This is enforced by the pure `restorePlan()` and its tests.
- **Small, justified abstractions.** A new layer needs a concrete current requirement. Hypothetical
  future needs are not architecture.

## 4. Engineering rules

- Evidence before claims: trace the execution path; run the gate; inspect the output.
- The smallest coherent fix wins. No broad rewrites without a reproduced defect and a written
  rationale.
- Every defect fix carries a regression test. Tests are never weakened to make a build pass.
- Documentation describes the final verified implementation. Historical reports stay historical.
- No destructive Git operations, no force pushes, no rewriting published history.
- No secret in source, logs, client bundles, storage, documentation or error messages.
- Accessibility is part of correctness: keyboard focus, labels, contrast, reduced motion, RTL.
- The service worker never becomes a way to hide a broken deploy; `?sw=off` exists for diagnosis.

## 5. What must never happen

- Replacing the translator with a chat interface or a feature dashboard.
- Adding a second, competing persistence store or prompt definition.
- Registering a service worker in an ephemeral preview and mistaking its stale shell for product
  behaviour.
- Claiming translation quality, device coverage or performance that was not measured.
- Using an animation to cover a blank frame, a remount or a data refetch.
