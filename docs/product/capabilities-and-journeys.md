# Capabilities and User Journeys

Status: **Verified** by source inspection and, where stated, runtime observation on 2026-11-07.
The editing journey, the one-public-page change and the dictionary/shadow journeys were rechecked on
2026-11-17 with unit tests, mocked Chromium streams and the recorded e2e checks; provider-dependent
quality is **NOT_VERIFIED** in that follow-up.

Each journey is described in three stages: **A — initial state**, **B — execution**, **C — final
state and return**.

## 1. Translate a sentence

**A.** The composer is focused or one tap away. The language bar shows the remembered pair (or
`auto → de` on a first visit), the selected register, and the active brain. The result area is
empty. The first-run introduction may cover the screen once; it is server-rendered and removed
after entry.

**B.** Typing is debounced by the scheduler. Short or incomplete text may stream a provisional
plain-text translation; a finished sentence requests the structured result. A newer request
supersedes an older one; a live stream for a prefix may continue so words do not disappear. The
result area shows a loading state only after 260 ms, so fast answers do not flicker.

**C.** The translation appears with copy, listen, save and shadow actions when relevant. The
session (draft, pair, style, result) is written to device storage after 400 ms and flushed when the
page is hidden. On return to `/`, the draft and translation paint from the remembered session
without a new request.

**Editing contract.** The borderless canvas hugs the draft and answer, not the viewport. The source
starts at one full line, grows/shrinks with real text up to six lines (four on viewports ≤640 px
high, three at ≤480 px or with the keyboard open), then scrolls natively. An arriving answer cannot
stretch an unchanged source; long answers grow the workspace, with actions directly below the text.
Arabic and Latin share one line box. The composer has exactly one caret, the native textarea's,
painted at the inline-start edge of the first glyph (right in RTL, left in LTR); the hidden mirror
that sizes the field repeats its direction, padding and text rendering, and
`tests/e2e/composer_interactions.py` asserts that the mirror and the field agree and that the first
glyph starts exactly at the caret's inline-start edge in both directions. The visible "translates as you type" caption is gone; the
composer's screen-reader description carries the same meaning. Translation is automatic; there is no
manual send button. Enter remains an optional shortcut, Shift+Enter inserts a newline, and IME
confirmation never submits a candidate. Paste preserves whitespace, and all programmatic entry paths respect the server's
5,000-unit limit without splitting an emoji surrogate pair. Clear is explicit, not a downward swipe.
Dictation appends to the exact typed draft instead of flattening its paragraphs. A stale result is
labelled as previous and has no usable result actions; it cannot be archived, saved or persisted for
a newer source. Editing also stops its read-along.

**Failure.** Offline, timeout, rate limit and provider errors produce a calm, translated state and
keep the previous good result and the draft. Transient failures retry once. A rate-limited _live_
request stays silent while typing.

## 2. Hold a conversation in Live mode

**A.** Live output is automatic while typing; the pair and register are already chosen.

**B.** Each pause streams plain text for the current prefix. Provisional text is never written to
device memory, never verified and never archived. A 1,200 ms pause requests one full reading of
the unchanged thought, even without final punctuation; it is translated structurally and checked,
not simply relabelled as final. Composition candidates are excluded from this schedule.

**C.** The settled translation replaces the provisional text, actions become available, and the
result is eligible for memory. The provisional text never becomes a permanent answer.

## 3. Change register or Arabic variety

**A.** Natural / Formal / Casual is visible as a compact control; the dialect picker appears when
Arabic is the target.

**B.** Changing either changes the request identity (style, dialect, brain). The scheduler treats
the change as deliberate and sends promptly. Prompts carry explicit, different guidance for each
register and variety.

**C.** The wording changes audibly, not just the label. The choice is persisted in preferences.
The verification layer still applies. **Quality of the change is NOT_VERIFIED without provider
keys and human review.**

## 4. Navigate to statistics and back

**A.** The header's statistics action opens `/stats`; the translator unmounts but the root shell,
theme, locale and providers stay alive. The document is not reloaded.

**B.** Statistics are derived from the local history archive through the pure stats engine. Opening
a record stores a pending pick and navigates to `/`.

The visual overview uses the same filtered archive: translation/word sparklines include zero
activity buckets, and the activity view switches between bars and a Monday-aligned calendar
for daily periods only. Each calendar day includes its actual count, including zero; cells
outside the selected period are blank. Selecting a day updates the existing readout and opens
its translations. Colour is relative to the largest visible bucket, not a quality score;
classification estimates remain labelled and correctable. No synthetic rows, network calls,
new storage or personal profiling are introduced by these views.

The practice landscape follows the same rule: it exposes the leading classified topic, the number
of observed topics, active days in the selected period, and phrases whose stored `uses` count shows
they were translated again. Its topic marks are real filters, never recommendations or an opaque
proficiency score. Classification covers text forms, everyday and specialist subjects, and
communicative functions; model tags are validated against the shared taxonomy, while local fallback
estimates remain visibly correctable.

The rhythm, records, milestones and language-flow views follow the same rule. The hour dial counts
the archive's own timestamps and its active hours open exactly those translations; "busiest day"
opens that day; the longest translation opens its record. Milestones are derived from the whole
local archive and show their real progress. The flow graph draws only real directions, reports what
it left out instead of hiding it, and each ribbon opens its direction. None of these views writes
to storage or sends anything anywhere.

**C.** The translator mounts with the remembered values already present: the draft, the pair and
the translation are on the first paint. The pending pick replaces them intentionally when the
record is opened in the translator. A return without a pick restores the session — **not** the
preference pair. Measured in the production bundle: composer and translation present ~64 ms after
the click, one document, no translation POST.

## 5. Save, copy, listen

- **Copy** uses the clipboard API, falls back to selection where unavailable, and confirms quietly.
- **Save** writes a validated phrase to the local saved store; the saved sheet can reopen it in the
  composer.
- **Listen** prefers device speech, then cloud read-along where configured. Cloud playback follows
  the audio clock for highlighting; if it cannot, highlighting stays conservative. Text sent for
  speech is not logged.

## 6. Theme and interface language

**A.** The theme and locale are restored **before paint** by inline boot scripts; the document has
the right palette, `lang` and `dir` on the first frame.

**B.** Theme changes animate as a reveal from the control; route changes use a cross-fade. Interface
language changes update copy and direction. Both persist locally.

**C.** The choice survives refresh and navigation. The browser-chrome `theme-color` is synchronised
after root mount, including on routes with no theme control (`/stats`).

## 7. First arrival

**A.** `INTRO_BOOT` marks the document before paint; CSS decides whether the introduction is shown.
Returning visitors never see it.

**B.** Entering releases the gate and runs the exit choreography. Users without JavaScript get the
translator, not a permanent cover.

**C.** The introduction is recorded as seen and does not return.

## 8. Offline and installation

The service worker precaches the shell and falls back to a branded offline page. Installed, the app
opens without a connection and keeps the draft on the device; translation requires the network. A
preview environment can bypass registration with `?sw=off` (see
`docs/architecture/decisions/0004-service-worker-and-offline-shell.md`).

## 9. Choose a language pair

**A.** The bar shows the remembered pair; on a first visit it is `auto → de`. The target picker
opens with the natural partners of the current source first, then recently used languages, pinned
favorites, the most used languages and the complete alphabetical list. Arabic ⇄ German is labelled
as the tuned pair rather than implying equal quality everywhere.

**B.** Search matches native names, the interface-language name, the code and aliases; Arabic
search also matches hamza/alef and teh-marbuta variants. Arrow keys move through the list, Enter
selects, and the star pins a language. Picking the language already on the other side trades the
pair instead of producing X→X. Favorites and recents are bounded, validated device state.

**C.** The chosen pair is persisted and restored with the session it belongs to. The detected
source is shown as the source label with a quiet marker, while the model still receives `auto`.

## 10. Look a word up in the dictionary

**A.** For a settled word or short fixed expression, the translator offers the dictionary. For a
sentence it offers nothing: the local candidate gate refuses prose before any request is made.

**B.** The lookup is quiet background work. After the translation settles it sends the term, the
direction, style and dialect, the interface language, the model's translation and — when it adds
information — the full sentence as ranking context, to one model analysis. The reading is ranked for
that sentence: the meaning the model's translation selected comes first, other distinct readings
after it.

**C.** The sheet says "Model reading — not a verified dictionary". It opens with the in-context
reading and term, and keeps labelled forms, synonyms, collocations, nuances (context shift,
near-synonym, double meaning, idiom, false friend), up to two example pairs, register, variety and —
only when the model was confident — pronunciation, behind a per-reading disclosure, with further
readings one expand away. A stale lookup never replaces a newer one; "nothing found" is a normal
answer. **Lexical accuracy is NOT_VERIFIED without a reviewed corpus (TD1).**

## 11. Check what a translation may have lost

**A.** Sentence Shadow is on by default and works only on a settled translation.

**B.** After the translation rests, the shadow reads origin and translation and reports at most four
findings, strongest first: a genuine `loss` of meaning or a tone that came out `weakened`, in one of
eight categories (warmth, intensity, respect, humor, ambiguity, culture, rhythm, implied). Strength
and confidence are shown as separate measures. Stylistic or normal cross-language differences are not
reported, and a finding that cannot be anchored to exact spans in both texts is dropped.

**C.** A quiet line under the translation says either how many things may have been lost or, honestly,
that nothing essential was lost. Opening a finding shows both texts, the explanation and — only when
a safe alternative exists — restores. Apply previews the word-level change, keeps the other findings
visible while the edited sentence is re-checked, updates the archive and a saved phrase, and offers
Undo until the draft or the checked translation changes. A very long source is analysed in up to four
sentence-aligned windows; the live quality of that path is **NOT_VERIFIED** (TD41).

## Acceptance criteria (testable)

1. Typing then pausing produces a translation; a newer edit never shows an older answer.
2. A settled result survives navigation away and back with no new translation request.
3. The restored screen uses the session's language pair, not a later preference pair.
4. Navigating between `/` and `/stats` keeps one document and one background colour.
5. A failed request preserves the draft and the previous result; retry is available.
6. Theme and direction are correct before the first paint.
7. Statistics open a record in the translator intentionally, without corrupting the session.
8. No private text appears in server logs or metrics.
9. The language picker finds every offered language by native name, localized name, code or alias;
   favorites and recents survive reload through validation and never exceed their bounds.
10. Every statistics visual opens only records that exist in the filtered archive; it introduces no
    synthetic data, network call or second store.
11. The translator's footer carries one public-page entry; `/privacy` and
    `/arabic-german-translation` answer with 301 redirects into `/about#privacy` and
    `/about#translation`, and the sitemap lists exactly `/` and `/about`.
12. The composer has one caret — the native textarea's — at the inline-start edge of the first glyph,
    and the hidden mirror agrees with the field on direction, padding and text rendering in RTL and
    LTR.
13. A dictionary reading is labelled model-generated, its in-context reading comes first, and a stale
    lookup never replaces a newer one.
14. Sentence Shadow shows only anchored findings (at most four), states honestly when nothing
    essential was lost, and an applied restore can be undone until the draft or the checked
    translation changes.
