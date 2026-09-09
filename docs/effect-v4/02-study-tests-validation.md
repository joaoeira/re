# Step 2 — Study coverage validation

Implemented on Effect 3.19.18 on 2026-09-09, starting from `c76e9b3`. The library remains on its existing dependency versions. No library implementation or frozen archive changes were required; the grading persistence-error fix and its regression were already present from step 1.

## Coverage ownership

| Change                                                                                                                      | Cases |
| --------------------------------------------------------------------------------------------------------------------------- | ----: |
| Move card creation, image insertion, and cloze-template cases from Raycast to the library                                   |     9 |
| Adapt deck-store and review-store integration cases into the library; retain the originals against Raycast's frozen archive |    17 |
| Add successful and failing Markdown callback cases                                                                          |     2 |
| Retain the existing grading persistence-error regression in the library                                                     |     1 |
| Remove the redundant stubbed `loadDecksForUi` pass-through case                                                             |     1 |

The library study suite now contains 29 cases across five files. All library imports use public source entry points under `packages/re/src`; there are no Raycast or frozen-archive imports. Integration tests use scoped temporary directories and the existing `@effect/platform-node-shared` adapters. Review tests share layer values and retain the deterministic `Deferred` barriers.

Raycast retains all 19 deck/review integration cases, including its two Markdown rendering cases, plus all 21 preview, Markdown, UI-boundary, and session-state cases. Comments in the integration suites explain why coverage overlaps and when to reconsider it.

The new callback cases verify root/deck context, the supplied `Path` service, transformation of both prompt and reveal, and an unchanged raw draft. A reveal transformation failure must retain the public error tag, reference, and formatted message without changing the deck. Rejected cloze edits now assert exact file preservation; missing-card grading checks both reference fields.

## Verification

| Check                                                                                   | Result                                                                                                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Baseline library suite                                                                  | 415 tests in 30 files passed                                                                                              |
| Baseline Raycast suite                                                                  | 50 tests in 9 files passed                                                                                                |
| Completed library suite                                                                 | 443 tests in 34 files passed                                                                                              |
| Focused library study suite                                                             | 29 tests in 5 files passed                                                                                                |
| Library build and typecheck                                                             | Passed                                                                                                                    |
| Completed Raycast workspace suite                                                       | 40 tests in 6 files passed                                                                                                |
| Standalone Raycast check                                                                | npm install and npm ci, frozen-library verification, lint, format check, typecheck, 40 tests, and production build passed |
| Changed TypeScript/JavaScript lint, changed-file formatting, and diff whitespace checks | Passed                                                                                                                    |

Commands from the repository root:

```sh
bun run --filter '@simbyotic/re' typecheck
bun run --filter '@simbyotic/re' test
bun --cwd=apps/raycast run test
bun run check:raycast
```

The standalone check initially failed because `git ls-files --cached` still lists deleted-but-uncommitted test files. `scripts/check-raycast.mjs` now skips `ENOENT` for those entries, matching Desktop's existing handling, while retaining rejection of non-files and propagation of other filesystem errors. Rerunning the actual standalone export with the three pending deletions passed.

## Mutation evidence

Each mutation was applied separately in a disposable source copy. The original review integration suite passed there first. Every mutated run executed the named case and failed its assertion; the other 17 review cases were filtered out. Each source mutation was restored immediately afterward. No mutation machinery or production-code test seam was added to the repository.

| Temporary fault                                                                                                           | Test that caught it                                                                       | Observed failure                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Grade using metadata read before `modifyCardMetadata` acquires the lock, including that stale metadata in the undo result | `grades the latest metadata after waiting to acquire the deck lock`                       | Undo contained the original new-card metadata, including null review/due dates, instead of the intervening schedule. |
| Reconcile an edit with cards read before `modifyItem` acquires the lock                                                   | `keeps a review saved while an edit is waiting to acquire the deck lock`                  | Persisted metadata reverted to the new-card state and lost the intervening review/due dates.                         |
| Remove the `sameKeys` edit validation                                                                                     | `rejects cloze edits that change the generated card indices`                              | Editing returned success instead of `ReviewEditValidationError`.                                                     |
| Replace grading's formatted persistence message with the underlying message                                               | `preserves the public persistence message and reference without saving a grade`           | Received `disk full` instead of `Could not save the deck: disk full`.                                                |
| Bypass the reveal Markdown transform                                                                                      | `transforms prompt and reveal using the supplied context and Path, leaving the draft raw` | Received raw `Answer` instead of `notes/deck.md: Answer`.                                                            |
| Remove the transform error message prefix                                                                                 | `contains a reveal transform failure as a card load error without changing the deck`      | Received `renderer unavailable` instead of `Could not prepare the card: renderer unavailable`.                       |

The focused study suite passed again after the mutation exercise. These cases now establish the v3 baseline for the later library migration; the retained Raycast integration suite continues to exercise its frozen v3 implementation.
