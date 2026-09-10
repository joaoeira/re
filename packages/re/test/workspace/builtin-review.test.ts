import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import { describe, expect, it } from "@effect/vitest";
import { SchedulerLive } from "../../src/scheduler/index.js";
import { numericField } from "../../src/core/index.js";
import { Effect, Layer } from "effect";
import {
  DeckManager,
  DeckManagerLive,
  gradeBuiltinCard,
  NewFirstOrderingStrategy,
  ReviewQueueBuilderLive,
  prepareBuiltinReviewQueue,
} from "../../src/workspace/index.js";

const platform = Layer.merge(NodeFileSystem.layer, Path.layer);

const decks = DeckManagerLive.pipe(Layer.provideMerge(platform));

const queueLayer = ReviewQueueBuilderLive.pipe(
  Layer.provideMerge(Layer.merge(decks, NewFirstOrderingStrategy)),
);

const runtime = Layer.merge(queueLayer, SchedulerLive);

const now = new Date("2025-01-10T00:00:00Z");

describe("built-in review", () => {
  it.effect("fills the limit with resolvable cards and reports skipped items and decks", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const rootPath = yield* fs.makeTempDirectoryScoped();
      const deckPath = `${rootPath}/deck.md`;
      yield* fs.writeFileString(
        deckPath,
        `<!--@ broken 0 0 0 0-->
No card syntax

<!--@ qa1 0 0 0 0-->
Question?
---
Answer

<!--@ due1 5 4.5 2 0 2025-01-01T00:00:00Z 2025-01-06T00:00:00.000Z-->
A {{c1::deletion}}.

<!--@ due2 5 4.5 2 0 2025-01-04T00:00:00Z 2025-01-09T00:00:00.000Z-->
Another question?
---
Another answer
`,
      );

      const queue = yield* prepareBuiltinReviewQueue({
        rootPath,
        deckPaths: [deckPath, `${rootPath}/missing.md`],
        now,
        options: { includeNew: true, includeDue: true, order: "default", cardLimit: 2 },
      });

      expect(queue.cards.map(({ reference }) => reference.cardId)).toEqual(["qa1", "due1"]);
      expect(queue).toMatchObject({ totalNew: 1, totalDue: 1 });
      expect(queue.cards[0]?.content).toEqual({
        prompt: "Question?",
        reveal: "Answer",
        cardType: "qa",
      });
      expect(queue.cards[1]).toMatchObject({
        reference: { cardKey: "c1" },
        content: { cardType: "cloze" },
      });
      expect(queue.issues.find((issue) => issue.kind === "deck")).toHaveProperty(
        "error._tag",
        "DeckNotFound",
      );
      expect(
        queue.issues.find((issue) => issue.kind === "card" && issue.cardId === "broken"),
      ).toHaveProperty("error._tag", "NoMatchingTypeError");
    }).pipe(Effect.provide(runtime)),
  );
  it.effect("grades current metadata and permits content edits that preserve identity", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const manager = yield* DeckManager;
      const rootPath = yield* fs.makeTempDirectoryScoped();
      const deckPath = `${rootPath}/deck.md`;
      yield* fs.writeFileString(deckPath, "<!--@ qa1 0 0 0 0-->\nQuestion?\n---\nAnswer\n");
      const queue = yield* prepareBuiltinReviewQueue({ rootPath, deckPaths: [deckPath], now });
      const reference = queue.cards[0]!.reference;
      // Another writer changes both the text and scheduling metadata after preparation.
      yield* fs.writeFileString(
        deckPath,
        "<!--@ qa1 0 0 0 0-->\nEdited question?\n---\nEdited answer\n",
      );
      const current = (yield* manager.readDeck(deckPath)).items[0]!.cards[0]!;
      yield* manager.updateCardMetadata(deckPath, reference.cardId, {
        ...current,
        stability: numericField(9),
      });
      const result = yield* gradeBuiltinCard(reference, 2, now);
      expect(result.previousCard.stability.value).toBe(9);
      expect(result.schedulerLog.previousCard.stability.value).toBe(9);
      expect(result.grade).toBe(2);
      const saved = (yield* manager.readDeck(deckPath)).items[0]!;
      expect(saved.content).toContain("Edited question?");
      expect(saved.cards[0]?.lastReview).toEqual(now);
      expect(saved.cards[0]?.stability.value).toBe(result.updatedCard.stability.value);
    }).pipe(Effect.provide(runtime)),
  );

  it.effect("does not write when a prepared card key no longer belongs to the card", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const rootPath = yield* fs.makeTempDirectoryScoped();
      const deckPath = `${rootPath}/deck.md`;
      yield* fs.writeFileString(deckPath, "<!--@ cloze1 0 0 0 0-->\nA {{c1::deletion}}.\n");
      const queue = yield* prepareBuiltinReviewQueue({ rootPath, deckPaths: [deckPath], now });
      const edited = "<!--@ cloze1 0 0 0 0-->\nA {{c2::different deletion}}.\n";
      yield* fs.writeFileString(deckPath, edited);
      const result = yield* gradeBuiltinCard(queue.cards[0]!.reference, 2, now).pipe(Effect.result);
      expect(result).toHaveProperty("_tag", "Failure");
      expect(result).toHaveProperty("failure._tag", "BuiltinCardNotFound");
      expect(result).toMatchObject({ failure: { cardId: "cloze1", cardKey: "c1" } });
      expect(yield* fs.readFileString(deckPath)).toBe(edited);
    }).pipe(Effect.provide(runtime)),
  );
});
