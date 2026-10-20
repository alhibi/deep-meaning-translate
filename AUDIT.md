# Reliability audit — 2026-10-20

## Verified repairs

- Admission counters now separate proxy-reported clients instead of sharing one translation bucket. Incoming raw JSON is bounded by actual bytes, including chunked bodies; cross-site browser origins are rejected.
- Clearing or shortening input invalidates pending translation and repair work. Repair results cannot overwrite another input generation. Dictionary caching includes the translated context.
- Translation streams reject provider error events and incomplete EOF. Cancelling the outgoing translation cancels upstream work. A direct-provider deadline covers both headers and body consumption.
- Gemini speech requires its completion event; failed streams cancel the reader. Cloud audio inactivity settles waiting consumers rather than hanging. Device speech finishing without a start event no longer triggers a later retry.
- Cancelling dictation during asynchronous audio initialization prevents token creation. Stopping dictation no longer accepts an older finalized turn as the latest turn.
- Corrupted current voice preferences preserve a valid legacy device choice. Clearing storage in another tab invalidates the saved-phrase cache. History timestamps outside the JavaScript date range are rejected.
- Shadow map-to-detail transitions retain their sheet session. Undo is bound to the exact input, base translation, target and style; applying a fix cannot corrupt a different document's archive.

## Evidence

- Full unit suite: **192 passed, 4 skipped**, 32 test files. Skipped cases are not counted as verified.
- `tests/e2e/smoke.py`: **0 failures**, translation, Copy visibility, swap, saved sheet, statistics, reload, navigation and runtime errors.
- `tests/e2e/adversarial.py`: **0 failures**, deterministic 50-action sequences in each of two independent browser contexts (424×758 English and 1280×1800 Arabic), plus shadow apply/readback, map-to-detail, archive integrity, stale Undo, single-character invalidation and overflow checks. Provider replies are intercepted fixtures, not real model output.
- `tests/e2e/voice_sync.py`: both viewports passed playable synthetic PCM, known word timing, Stop, replay, no duplicate synthesis, no overflow and no runtime errors. This proves the browser playback path, not real provider pronunciation.
- One real DeepSeek German→Arabic flow passed: generic sentence, number 10 preserved, result read back through the UI and found in the local archive. No real concurrent provider load was generated.
- Latest checked automatic build record: **build OK** at 2026-10-20T11:08:57Z.

## Limits and unresolved checks

- Admission is bounded **process-local** state, not a distributed security guarantee. Clients behind the same proxy-reported address share a bucket. Hosting-edge/shared abuse controls are still required for public paid endpoints; Origin checks do not stop direct HTTP bots.
- The 3,000-identity limiter unit test uses sequential in-memory calls. It is **not** evidence of 3,000 concurrent users, deployed throughput, provider quota or distributed fairness.
- No deployment-wide load test, real concurrent paid-provider test, fresh live microphone test, real provider speech test or physical-phone check was performed in this audit.
- Project lint failed: **514 errors, 45 warnings**, including 502 auto-fixable errors, mostly existing formatting and React rule findings. The entire lint result is not clean. A blanket rewrite was deliberately avoided in this scoped reliability repair.
- No manual build or typecheck was executed; the automatic preview build is the build evidence.
- Public APIs still use owner-funded keys without end-user accounts. Full bot resistance and distributed concurrency control remain unresolved, not implicitly fixed by this audit.

## Repeatable checks

Run the unit suite, then the smoke, adversarial and voice-sync browser scripts against the running preview. Keep live provider checks small and explicit; never send users' archived text for testing or log translation/audio request bodies.