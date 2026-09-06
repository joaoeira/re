# @simbyotic/re/item-types

Built-in Q&A and cloze item types for re. This module implements the `ItemType` contract
from `@simbyotic/re/core`, with runtime parsers and card generation as well as TypeScript declarations.
It exports ESM JavaScript and uses Effect for parsing and grading.

```ts
import { Effect } from "effect";
import { QAType, ClozeType } from "@simbyotic/re/item-types";

const qa = Effect.runSync(QAType.parse("Capital of France?\n---\nParis"));
const qaCards = QAType.cards(qa);

const cloze = Effect.runSync(ClozeType.parse("{{c1::Paris}} is in {{c2::France}}."));
const clozeCards = ClozeType.cards(cloze);
```

Q&A content separates question and answer with a line containing `---`. Cloze content uses
`{{c1::hidden text}}` syntax, with one card per distinct cloze index.

Use `composeQA(question, answer)` to write Q&A content. It returns `Effect<string, QAComposeError>`,
normalizes CRLF to LF, trims both fields, and rejects empty fields or standalone `---` lines in the
normalized question. `QAComposeError.field` identifies `question` or `answer` for form validation.
Separators in answers and interior space-padded separator-like lines are preserved.

```ts
import { composeQA } from "@simbyotic/re/item-types";

const content = Effect.runSync(composeQA("Capital of France?", "Paris"));
```

Q&A generates the key `main`. Cloze generates keys from the actual deletion indices (`c1`,
`c3`, etc.), preserving identity when another deletion is removed or the text is edited.

Use `resolveBuiltinItem(item)` to interpret saved items. It checks generated card counts
against the saved metadata, then prefers cloze when both cloze and Q&A fit. Desktop and Raycast
use this same rule for editing and review. Use `inferCards`
from `@simbyotic/re/core` only for unsaved content that has no metadata count yet.

Desktop can open a count-mismatched item using the first parseable type and offer an explicit
reset-and-save action. The save rechecks the current item under the deck lock and creates fresh IDs
and learning data only if its count is still mismatched; an item repaired in the meantime is matched
normally. Until repaired, count-mismatched items are skipped by desktop's
duplicate index and do not participate in duplicate checks.

For a review queue, call `annotateBuiltinCardKeys(entries)`. It accepts entries with `{ item, card }`,
returns `{ items, errors }`, preserves valid entries' order and other fields, and adds a string `cardKey`.
Unresolvable entries are excluded, with one error per invalid item containing an entry that identifies
its location. It resolves each shared item snapshot
once, even when its cards are interleaved in the queue. It has no dependency on workspace queue types.
For a complete built-in review queue, use `prepareBuiltinReviewQueue` from the workspace entry point,
which shares this resolution pass and retains rendered content.
Later, call `resolveBuiltinCard(currentItem, { cardId, cardKey })` before displaying or
grading it. The result includes the selected `spec` and its metadata `card`, along with the
resolved item `type` and all generated `cards`. Built-in specs expose `cardType: "qa" | "cloze"`. Selection uses the key and verifies the saved ID,
so cloze removal or reordering cannot redirect a review. A missing key or an ID/key disagreement
fails with `BuiltinCardNotFound`; parse and count errors retain their existing tags.

Apps report excluded items through their queue issues and count only reviewable cards. Session limits
are applied after filtering, so broken items do not consume the limit. Refresh the queue after
repairing an item. Content that becomes invalid after the queue was built still fails at load or
grade time. Keys remain derived from content, with no Markdown format change.

Build locally with `bun run build`. From the repository root, `bun run pack:library`
creates the installable package archive and `bun run check:packages` verifies it in an isolated Node consumer.
