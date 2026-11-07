# Product Vision and Scope

Status: **Verified** against the implementation and copy on 2026-11-07. User-research documents
were not found in the repository; statements about usage contexts are therefore inferred from the
product's design and must not be presented as measured research.

## Identity

**today** (Deep Meaning Translate) is a one-screen, meaning-first translator for **Arabic and
German**. It exists for the moment when a literal translation is not enough: a message to a
colleague, a sentence with an idiom, a polite request, a dialect phrase, a line whose tone carries
as much as its words.

The product's answer is not more controls. It is a quiet composer, an intelligent writer, and a
translation that reads as if a native speaker wrote it.

## Who it is for (inferred, not researched)

- Arabic speakers writing German, and German speakers writing Arabic, in daily, work and official
  situations.
- People who already know some of the language but do not trust word-for-word output for tone,
  politeness or idiom.
- People who value privacy: the draft and archive stay on the device; provider requests carry text
  only to produce the translation.

## Principles in force

1. Meaning, intent and tone outrank literal wording.
2. Register is a real behaviour: Natural, Formal and Casual must sound different.
3. Facts survive: names, numbers, dates, links, emoji, punctuation, negation, structure.
4. Never invent, explain or embellish.
5. One focused screen; the translator is the interface.
6. The app is continuous: navigation does not rebuild it or flash another colour.
7. Failure is calm, translated and recoverable; the draft is never lost.
8. Privacy is architectural: server-held keys, no text in logs or metrics, device-only caches.

## In scope (implemented)

Arabic ⇄ German translation with register and Arabic variety control; live streaming while typing;
verified finished results with a quiet repair pass; device translation memory; local history and
statistics; saved phrases; device and cloud read-aloud; Sentence Shadow; first-run introduction;
three themes; three interface languages (English, German, Arabic with RTL); public privacy and
Arabic–German guidance pages; offline shell; installable PWA.

## Explicit non-goals

- A chat interface, conversation memory, or a general-purpose assistant.
- A language-learning course, flashcards, grammar drills or gamification.
- A dashboard with accounts, cloud sync, teams or social features.
- Translating confidential material to a third party beyond the configured translation provider.
- Supporting every language pair equally. Arabic ⇄ German is first-class; other pairs may work
  through the model but receive no product-specific guarantees or checks.
- Search-engine content competing with the translator: public pages exist to explain and to be
  found, not to replace the workspace.
- Claims of human-level quality without a reviewed evaluation corpus.

## Terminology

| Term | Meaning in this project |
| --- | --- |
| **Brain** | The model that writes a translation. `deepseek` is active; `luna` (OpenCode) is implemented but paused. |
| **Live** | Provisional plain-text stream while the person is still typing. |
| **Full / settled** | Structured translation of a finished sentence, verified and eligible for repair. |
| **Register / style** | Natural, Formal or Casual. A semantic instruction, not a label. |
| **Dialect** | Arabic output variety: MSA or a regional variety; `auto` follows the source. |
| **Repair** | One quiet second pass, shown only if it clears more deterministic issues than it creates. |
| **Review** | A second-brain check of a settled sentence when no deterministic issue exists. |
| **Shadow** | A display-level note about a phrase whose meaning shifted; never silently rewrites history. |
| **Session** | The current draft, its pair, style and last translation; device-local. |
| **Prefs** | Last-used defaults, used to fill gaps when no session exists. |
| **Remembered** | The tab's in-memory copy of prefs/session, used to paint a remounted route immediately. |
| **Foreground** | User-initiated translation. Background enrichment (dictionary, shadow, review) is queued separately. |

## Success, honestly stated

A successful release preserves meaning and facts, reads naturally, keeps the interface stable
across navigation, fails calmly, and leaves no private text in logs. It does **not** require a new
feature. Quality and maturity outrank feature count.
