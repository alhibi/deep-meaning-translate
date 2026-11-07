# ADR 0002 — The session owns its language pair on restore

Status: **Accepted** (verified 2026-11-07).

## Context

The app persists two related things: **preferences** (last-used defaults) and a **session** (the
current draft, its pair, style and last translation). Both can change independently. The
translation cache is keyed by text, source, target, style, dialect and brain.

## Problem

Boot restored the session text but primed the cache using the preference pair, while the visible
state kept the preference pair too. When a session had been written in `de → ar` and preferences
later said `auto → en`, the primed key could never match the request key: the draft came back, the
translation vanished, and the sentence was translated and paid for again.

## Decision

A restored session is authoritative for `source`, `target`, `style` and its cached result.
Preferences only fill the dialect and the effective brain. The decision is a pure function,
`restorePlan(session, prefs)` in `src/lib/translation/restore.ts`, used by the boot effect and
covered by regression tests. A strong writing-system mismatch is sent to the model as `auto` while
the language bar keeps showing the session's pair.

The restored result is passed to `useTranslator` as `restored`: the hook starts in `COMPLETE`, treats
the key as committed, seeds the visible text length, and neither re-requests nor shows a loading
state for it.

## Alternatives considered

- **Preferences win**: simpler, but silently changes the pair of a sentence the person already
  translated. Rejected.
- **Clear the session when preferences change**: loses the draft and the result. Rejected.
- **Prime both keys**: hides the mismatch but doubles stale state and does not fix the visible pair.

## Consequences

- The cache key and the visible pair cannot drift; a pure test enforces the rule.
- A returning route paints the translated sentence immediately with zero requests.
- Preferences still control a fresh translator with no session.

## Related

ADR 0001, `docs/architecture/state-and-persistence.md`,
`src/lib/translation/restore.test.ts`, `src/lib/translation/useTranslator.test.tsx`.
