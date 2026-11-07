# Definition of Done

Status: **Verified** (applies from 2026-11-07). "Done" is evidence, not confidence.

## A bug fix

- [ ] The defect was reproduced, or its conditions are recorded and the fix is justified by a
      traced cause.
- [ ] The root cause is identified in the change description (not only the symptom).
- [ ] The smallest coherent fix is implemented; no unrelated behaviour changed.
- [ ] A regression test fails on the old behaviour and passes on the new one (unit, integration or
      e2e, whichever covers the path).
- [ ] The relevant gate was run and its output inspected: `typecheck`, `lint`, `test`, and
      `check:contrast` when colour is involved.
- [ ] If routing, bundling, headers, the service worker or server code changed, `npm run build`
      and `npm run check:pwa` were run.
- [ ] Affected documentation was updated; new debt was recorded, not hidden.
- [ ] No secret, personal text or stack trace was added to logs, tests or documents.

## A feature

- [ ] Its product purpose and non-goals are written in `docs/product/` before or with the change.
- [ ] Initial, loading, success, empty, error, disabled and cancellation states are defined and
      implemented where the feature can reach them.
- [ ] The user journey is documented through initial state → execution → final state, including
      what happens on navigation, refresh and return.
- [ ] Data is validated on read and bounded on write; nothing trusts storage or the network.
- [ ] Keyboard, screen-reader label, focus return, reduced motion, RTL and contrast were checked
      where applicable.
- [ ] Server boundaries keep secrets server-side; inputs are same-origin checked and bounded.
- [ ] Tests cover the behaviour and the edge cases that can be tested deterministically.
- [ ] All gates are green, including the build and PWA check.
- [ ] `DOCUMENTATION_INDEX.md` lists any new authoritative document.

## A refactor

- [ ] It has a concrete current justification (defect, measured cost, or verified maintenance
      hazard) — not a hypothetical future.
- [ ] Behaviour is unchanged unless explicitly specified; existing tests pass without weakened
      assertions.
- [ ] Public contracts (schemas, storage keys, routes, env names) are preserved or migrated with a
      validator and a rollback path.
- [ ] The change reduces or holds complexity; no new abstraction without a named consumer.
- [ ] Documentation that names moved files is updated; links pass `npm run check:docs`.

## A release

- [ ] `npm run verify` is green: typecheck, lint with zero warnings, tests, contrast.
- [ ] `npm run check:docs` is green.
- [ ] `npm run build` succeeds; `npm run check:pwa` reports a non-empty precache.
- [ ] The production bundle was served with `npm run preview` and the primary journeys were
      exercised: translate (mocked or real), navigate away and back, refresh, theme switch, stats,
      offline shell.
- [ ] Navigation regression checks pass: one document, no background change, draft and translation
      restored without a new request.
- [ ] Security headers are present in the built output and no secret appears in client assets.
- [ ] Remaining risks and unverified areas are stated in the release notes.
- [ ] The connected branch is left in a working state; published history was not rewritten.
