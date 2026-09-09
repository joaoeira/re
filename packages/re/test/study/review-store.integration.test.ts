import { FileSystem } from "@effect/platform";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SchedulerLive } from "../../src/scheduler/index.js";
import { makeReviewStoreLive, ReviewStore } from "../../src/study/index.js";
import {
  DeckManager,
  DeckManagerLive,
  DeckWriteError,
  ReviewQueueBuilderLive,
  ShuffledOrderingStrategy,
} from "../../src/workspace/index.js";

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const decks = DeckManagerLive.pipe(Layer.provideMerge(platform));
const queue = ReviewQueueBuilderLive.pipe(
  Layer.provideMerge(Layer.merge(decks, ShuffledOrderingStrategy)),
);

describe("ReviewStore grading failures", () => {
  it.scoped("preserves the public persistence message and reference without saving a grade", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const base = yield* DeckManager;
      const directory = yield* fs.makeTempDirectoryScoped();
      const deckPath = `${directory}/deck.md`;
      const original = "<!--@ card-a 0 0 0 0-->\nQuestion\n---\nAnswer";
      yield* fs.writeFileString(deckPath, original);
      const failing: DeckManager = {
        ...base,
        modifyCardMetadata: () =>
          Effect.fail(new DeckWriteError({ deckPath, message: "disk full" })),
      };
      const reviews = yield* ReviewStore.pipe(
        Effect.provide(
          makeReviewStoreLive((_context, markdown) => Effect.succeed(markdown)).pipe(
            Layer.provide(
              Layer.mergeAll(queue, SchedulerLive, Layer.succeed(DeckManager, failing)),
            ),
          ),
        ),
      );
      const error = yield* reviews
        .gradeCard(
          {
            deckPath,
            deckName: "deck",
            relativePath: "deck.md",
            cardId: "card-a",
            cardKey: "main",
          },
          2,
          new Date("2026-09-09T12:00:00Z"),
        )
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "ReviewGradeError",
        deckPath,
        cardId: "card-a",
        message: "Could not save the deck: disk full",
      });
      expect(yield* fs.readFileString(deckPath)).toBe(original);
    }).pipe(Effect.provide(decks)),
  );
});
