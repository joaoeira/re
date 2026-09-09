---
"@simbyotic/re": minor
---

Add `composeQA` with field-specific validation and CRLF normalization, and shared built-in review preparation and grading functions. Preparation returns resolved content snapshots and typed issues, applying limits after invalid cards are skipped. Grading revalidates card identity and schedules current metadata under the deck lock.

Give missing-deck and missing-card errors useful default messages and export shared deck error formatters. Built-in resolution now exposes the `qa`/`cloze` card type union while preserving the existing key annotation API.
