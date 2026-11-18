# Translation evaluation (Arabic ⇄ German)

This directory holds the versioned evaluation corpus, the deterministic scorer, and the live
controlled comparison between the production full profile and the deeper reasoning profiles.
It is the executable half of `docs/translation/evaluation.md`; the linguistic half remains
human review, which is **NOT_VERIFIED** in this environment (plan below).

## What is here

| Path | Role |
| --- | --- |
| `corpus/v1.ts` | Frozen corpus v1.0.0: 44 hand-authored rows (22 ar→de, 22 de→ar) covering everyday chat, German workplace, official correspondence, formal/casual register, Levantine and MSA, idioms/culture, sarcasm/implied meaning, negation/ambiguity, technical terms, names/amounts/dates/units and long paragraphs. |
| `corpus/types.ts` | Row/invariant types; every row carries a `humanReview` slot (`NOT_VERIFIED` until a native reviewer fills it). |
| `corpus/index.ts` | Corpus loader + structural validation (`validateCorpus`). |
| `scoring.ts` | Deterministic checks: production `verifyTranslation`, date/number/unit canon, terminology, negation, question mark, paragraph mirroring, URL/emoji, extra-number heuristic. |
| `run.ts` | Runner: 3 configurations × corpus, latency/token usage from provider responses, independent judge, live capability + budget probes, artefacts + committed baseline fixture. |
| `providers.ts` | Request layer: production prompts and `capabilityRequest` profiles, 60 s production safety deadline, streaming live path, judge model. |
| `probes.ts` | Live checks of the documented contract and the token budgets (max output, 5,000-char structured answer, repair, analysis). |
| `fixtures/baseline-v1.json` | Committed snapshot of one real run (summary + per-case deterministic results + judge scores; **no raw translation text**). |
| `eval.config.ts` | Vitest config for the live tests; deliberately outside `vitest.config.ts`, so the standing gate can never make a paid call. |

The corpus is also validated by `src/lib/translation/providers/eval.corpus.test.ts`, which runs
in the standing test gate with no network and no cost.

## Commands

```sh
# deterministic corpus + scoring gate (part of the normal test suite)
npx vitest run src/lib/translation/providers/eval.corpus.test.ts

# full live comparison: 44 cases × 3 configs + independent judge + probes
RUN_LIVE_EVAL=1 EVAL_WRITE_FIXTURE=1 npx vitest run --config tests/eval/eval.config.ts

# bounded smoke run (4 cases, no judge/probes)
RUN_LIVE_EVAL=1 EVAL_CASE_LIMIT=4 EVAL_SKIP_JUDGE=1 EVAL_SKIP_PROBES=1 npx vitest run --config tests/eval/eval.config.ts
```

`DEEPSEEK_API_KEY` is read server-side from the environment or the repo `.env`; it is never
printed and never written to an artefact. Run artefacts go to `artifacts/eval/<runId>/`
(gitignored); only the deliberate `EVAL_WRITE_FIXTURE=1` run rewrites the committed fixture.

## Configurations compared

| id | request shape |
| --- | --- |
| `production-full` | `capabilityRequest("full")`: thinking disabled, temperature 0.3, JSON, 512–16,384 token ceiling |
| `reasoning-high` | `capabilityRequest("repair")` shape: thinking enabled, `reasoning_effort: high`, JSON, 32,768 ceiling |
| `reasoning-max` | `capabilityRequest("analysis")` shape: thinking enabled, `reasoning_effort: max`, JSON, 65,536 ceiling |

Reusing the production repair/analysis profiles means the comparison never invents a
parameter: it asks whether a shape the product already documents would translate better.

## Scoring contract

- **Hard pass** = provider answered (`finish_reason: stop`), the structured reply parsed,
  `verifyTranslation` reported no issue, every declared number/date/time/URL/emoji survived,
  required terminology appeared, forbidden register wording was absent, negation and question
  marks were kept, and declared paragraph counts were mirrored.
- **Soft signals** (never in the pass/fail boolean): requested-register marker, Arabic-variety
  marker, model `isAmbiguous` flag, length ratio, extra-number heuristic, sentence count.
- **Independent judge** = `deepseek-v4-pro` (a different documented model, same account) with
  its own judge instructions and temperature 0. It is a secondary signal only: it can share
  provider-family bias with the writer, so it is never the sole metric and never overrides the
  deterministic checks or the human review.
- **Known verifier limitation**: `verify.ts` compares number tokens without date awareness, so a
  correctly preserved `12.03.2026` is reported as missing `12, 03, 2026`. The runner reports
  those cases separately (`pass rate excl. date-verify FP`) instead of hiding them in the model
  score; the verifier itself is outside this task's write scope.

## Human review — exact plan (NOT_VERIFIED in this environment)

No native reviewer ran against this corpus in this environment, so every row stays
`NOT_VERIFIED` and no quality claim may cite it yet. To close it:

1. Run the baseline command above with `EVAL_WRITE_FIXTURE=1`; keep the run directory
   (`artifacts/eval/<runId>/results.json`) as the reviewed artefact.
2. Blind the reviewer to configuration names: export rows as source + candidate A/B/C in a
   shuffled order, no model or config labels, no judge scores.
3. Two reviewers per direction: one native Arabic speaker (Levantine rows: a Levantine speaker;
   MSA rows: a reviewer fluent in formal Arabic) and one native German speaker. One reviewer
   cannot certify every variety and register.
4. Score each row 1–5 on the six axes in `docs/translation/evaluation.md`: meaning preserved,
   intent preserved, naturalness, register, factual details, no invention/no omission; mark
   any factual or polarity loss as a regression regardless of style score.
5. Fill the row's `humanReview` slot (`status: "REVIEWED"`, reviewer, date) in `corpus/v1.ts`
   and record the aggregate in the fixture; update `docs/translation/evaluation.md` (status,
   corpus version, reviewer, pass/regression counts) — that document is maintained by the lead.
6. Acceptance for a profile change: no new factual/negation/omission regression in either
   direction, the requested register is audible, and the reviewer can name the intended reader.

## What this does not prove

- It cannot prove semantic equivalence: a fluent wrong sentence can still pass the hard checks.
- The judge is a probabilistic second opinion, not a human.
- The corpus is 44 synthetic rows, not production traffic; dialect coverage is sampled.
- Live capability probes verify the documented contract today; they are not a latency SLA.

## Known v1 evaluation-harness limitations (frozen in v1.0.0, fix in v2)

The corpus is frozen before model output is seen, so none of these were "fixed" after a run.
They explain why the deterministic pass rate is a conservative floor, not a quality score:

- **Date/time formats**: the verifier (and the corpus expectations) compare numeric tokens
  without date awareness, so a correct `12.03.2026`, `20.11.` or a localized `17 Uhr` can be
  reported as a missing number. The runner reports those cases separately.
- **Non-exhaustive terminology alternatives**: a correct synonym not listed in an invariant can
  fail (`zuständige Abteilung` vs `Behörde`, `تصريح إقامتي` vs `الإقامة`, Latin `Müller GmbH`
  kept verbatim, Arabic month-name dates `14 أكتوبر 2025` vs a numeric date expectation).
- **Judge ceiling**: `deepseek-v4-pro` scored nearly every row 5/5 on this corpus, so the judge
  delta is not discriminative here; it stays a secondary signal by design.
- **Cross-model review is not part of the product any more**: model selection is strict, so there
  is no review profile to exercise. Only the live repair and analysis profiles are exercised.

v2 should fold dates/times before number comparison, use a broader "acceptable equivalents" list
per terminology row, and add rows that a judge can actually distinguish (subtle register or
implicit-meaning pairs where a 5/5 ceiling is not expected).
