# Guardrails for a stable app

Goal: any future change or improvement cannot silently break something else. There are no automated checks today, so I'll add three layers of protection.

## 1. Written project rules (always applied)
Save lasting rules to project memory so every future edit follows them:
- Don't change files that aren't part of the request; a design change never touches translation logic, and the reverse.
- Behaviours that must never change (a list of fixed behaviours):
  - Swapping languages keeps the writing box direction and the typed text.
  - Copy / Listen / Save / Share appear once a translation settles, including text with no final punctuation.
  - The X buttons never cover text.
  - The language and dialect lists open without crashing and stay open.
  - The API key stays on the server only.
  - Arabic is never smaller than Latin text, and the clay accent is only used as a signal.
- Before saying a task is done: automated checks pass, the build is clean, and a phone-sized browser test runs with zero errors.
- Every bug that gets fixed also gets a test, so it can't come back.

## 2. Automated tests for the logic
Add a test runner and tests for the parts that break most easily:
- Scheduler: when text counts as finished or still being typed, minimum text length, typing pause timing.
- Translation hook: stale replies are ignored, repeated requests are merged, the cache works, a live result settles once typing pauses (today's bug), and a failed request keeps the last good result.
- Prompt: the reply keys the app depends on are always there; dialect rules are added only when the target is Arabic.
- Reply check and repair: bad or partial replies are rejected safely.
- Language search: aliases work ("franz", "ألماني"), and dialect ids never reach the browser's language-name lookup (the crash).
- Saved phrases and history: saving, reading, and recovering when stored data is damaged.
- i18n: all three languages (ar, en, de) have exactly the same text keys.

## 3. Phone-sized browser checks
One repeatable browser script at 390x844:
- Type, get a translation, and see the action buttons.
- Swap languages and check direction.
- Open and close the language, dialect, saved and history lists.
- Check the X doesn't overlap text.
- Fail on any page error.

The translation service is replaced with a fake reply, so the checks cost nothing and give the same result every run.

## 4. Structural safety
- A crash boundary around the translation area and each list, so one broken part shows a calm message instead of a blank screen.
- Stricter validation of anything read from device storage: damaged data is dropped, never allowed to crash the app.

## Technical details
- Add `vitest`, `@testing-library/react` and `jsdom`, plus `test` and `test:e2e` scripts. Tests live next to the code as `*.test.ts(x)`.
- The server function is mocked in the hook tests with `vi.mock` and fake timers.
- The browser script is saved in the repo (`tests/e2e/smoke.py`) and intercepts `/_serverFn` with a fixed JSON reply.
- Memory: new `mem://constraint/invariants` and `mem://preference/change-discipline`, both linked from the index Core.
- No visual or behaviour changes for users.
