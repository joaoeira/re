import { FileSystem } from "@effect/platform";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { parseFile, State } from "@simbyotic/re/core";
import { Scheduler, SchedulerLive } from "@simbyotic/re/scheduler";
import {
  DeckManager,
  DeckManagerLive,
  ReviewQueueBuilderLive,
  ShuffledOrderingStrategy,
} from "@simbyotic/re/workspace";
import { Deferred, Effect, Fiber, Layer } from "effect";

import { ReviewStore, ReviewStoreLive } from "../src/review-store";

const PlatformLive = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const DeckManagerServicesLive = DeckManagerLive.pipe(Layer.provideMerge(PlatformLive));
const QueueServicesLive = ReviewQueueBuilderLive.pipe(
  Layer.provideMerge(
    Layer.mergeAll(DeckManagerServicesLive, ShuffledOrderingStrategy, PlatformLive),
  ),
);
const TestLive = ReviewStoreLive.pipe(
  Layer.provide(
    Layer.mergeAll(QueueServicesLive, DeckManagerServicesLive, SchedulerLive, PlatformLive),
  ),
);
const TestWithPlatformLive = Layer.merge(TestLive, PlatformLive);

// Keep integration coverage of the frozen Effect v3 archive during the library migration.
// Revisit this overlap when Raycast adopts the current library and equivalent app coverage.
describe("ReviewStoreLive", () => {
  it.scoped("grades the latest metadata after waiting to acquire the deck lock", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const base = yield* DeckManager;
      const scheduler = yield* Scheduler.pipe(Effect.provide(SchedulerLive));
      const rootPath = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${rootPath}/deck.md`;
      yield* fileSystem.writeFileString(deckPath, "<!--@ card-a 0 0 0 0-->\nQuestion\n---\nAnswer");
      const original = (yield* base.readDeck(deckPath)).items[0]!.cards[0]!;
      const waiting = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const beforeWrite = <A, E>(operation: Effect.Effect<A, E>) =>
        Deferred.succeed(waiting, undefined).pipe(
          Effect.zipRight(Deferred.await(release)),
          Effect.zipRight(operation),
        );
      const delayed: DeckManager = {
        ...base,
        modifyCardMetadata: (path, id, change) =>
          beforeWrite(base.modifyCardMetadata(path, id, change)),
        updateCardMetadata: (path, id, metadata) =>
          beforeWrite(base.updateCardMetadata(path, id, metadata)),
      };
      const reviews = yield* ReviewStore.pipe(
        Effect.provide(
          ReviewStoreLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                QueueServicesLive,
                SchedulerLive,
                PlatformLive,
                Layer.succeed(DeckManager, delayed),
              ),
            ),
          ),
        ),
      );
      const reference = {
        deckPath,
        deckName: "deck",
        relativePath: "deck.md",
        cardId: "card-a",
        cardKey: "main",
      };
      const grading = yield* reviews
        .gradeCard(reference, 2, new Date("2026-08-02T12:00:00Z"))
        .pipe(Effect.forkScoped);
      yield* Deferred.await(waiting);
      const intervening = yield* scheduler.scheduleReview(
        original,
        2,
        new Date("2026-08-01T12:00:00Z"),
      );
      yield* base.updateCardMetadata(deckPath, "card-a", intervening.updatedCard);
      yield* Deferred.succeed(release, undefined);
      const undo = yield* Fiber.join(grading);
      expect(undo.previousMetadata).toEqual(intervening.updatedCard);
    }).pipe(Effect.provide(DeckManagerServicesLive)),
  );

  it.scoped(
    "keeps healthy cards from a deck with a mismatched item and reports the skipped item",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const rootPath = yield* fileSystem.makeTempDirectoryScoped();
        const deckPath = `${rootPath}/mixed.md`;
        yield* fileSystem.writeFileString(
          deckPath,
          "<!--@ broken 0 0 0 0-->\n<!--@ extra 0 0 0 0-->\n{{c1::Only one}}\n" +
            "<!--@ healthy 3 4.5 2 0 2025-01-01T00:00:00Z 2025-01-04T00:00:00Z-->\nQuestion\n---\nAnswer",
        );
        const reviews = yield* ReviewStore;
        const session = yield* reviews.startSession(rootPath, new Date("2026-08-13T12:00:00Z"));
        expect(session.cards).toMatchObject([{ cardId: "healthy", cardKey: "main" }]);
        expect(session.totalNew).toBe(0);
        expect(session.totalDue).toBe(1);
        expect(session.issues).toMatchObject([
          {
            relativePath: "mixed.md",
            kind: "parse_error",
            message: expect.stringMatching(/^Card (broken|extra):/),
          },
        ]);
      }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("keeps the queued cloze key when an earlier cloze is removed", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const rootPath = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${rootPath}/cloze.md`;
      yield* fileSystem.writeFileString(
        deckPath,
        "<!--@ first 0 0 0 0-->\n<!--@ third 0 0 0 0-->\nThe {{c1::first}} and {{c3::third}}.",
      );
      const reviews = yield* ReviewStore;
      const now = new Date("2026-08-13T12:00:00Z");
      const session = yield* reviews.startSession(rootPath, now);
      const reference = session.cards.find((card) => card.cardId === "third")!;
      expect(reference.cardKey).toBe("c3");
      yield* fileSystem.writeFileString(
        deckPath,
        "<!--@ third 0 0 0 0-->\nOnly {{c3::third}} remains.",
      );

      const card = yield* reviews.loadCard(rootPath, reference);
      expect(card.reveal).toContain("third");
      yield* reviews.gradeCard(reference, 2, now);
      const saved = yield* parseFile(yield* fileSystem.readFileString(deckPath));
      expect(saved.items[0]!.cards[0]!.id).toBe("third");
      expect(saved.items[0]!.cards[0]!.state).not.toBe(State.New);
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("keeps a review saved while an edit is waiting to acquire the deck lock", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const base = yield* DeckManager;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${directory}/deck.md`;
      yield* fileSystem.writeFileString(
        deckPath,
        "<!--@ card-a 0 0 0 0-->\nOld question\n---\nOld answer",
      );
      const waiting = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const beforeSave = <A, E>(operation: Effect.Effect<A, E>) =>
        Deferred.succeed(waiting, undefined).pipe(
          Effect.zipRight(Deferred.await(release)),
          Effect.zipRight(operation),
        );
      // Delay entry into either public edit operation. An unlocked read made by
      // the caller before this point must not determine the metadata it saves.
      const delayed: DeckManager = {
        ...base,
        modifyItem: (path, id, change, type) => beforeSave(base.modifyItem(path, id, change, type)),
        replaceItem: (path, id, item, type) => beforeSave(base.replaceItem(path, id, item, type)),
      };
      const reviews = yield* ReviewStore.pipe(
        Effect.provide(
          ReviewStoreLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                QueueServicesLive,
                SchedulerLive,
                PlatformLive,
                Layer.succeed(DeckManager, delayed),
              ),
            ),
          ),
        ),
      );
      const reference = {
        deckPath,
        deckName: "deck",
        relativePath: "deck.md",
        cardId: "card-a",
        cardKey: "main",
      };
      const edit = yield* reviews
        .saveEdit(reference, {
          cardType: "qa",
          question: "Edited question",
          answer: "Edited answer",
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(waiting);

      yield* reviews.gradeCard(reference, 2, new Date("2026-08-13T12:00:00Z"));
      const reviewed = yield* base.readDeck(deckPath);
      expect(reviewed.items[0]!.cards[0]!.state).not.toBe(State.New);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(edit);

      const saved = yield* base.readDeck(deckPath);
      expect(saved.items[0]!.cards[0]).toEqual(reviewed.items[0]!.cards[0]);
      expect(saved.items[0]!.content).toBe("Edited question\n---\nEdited answer");
    }).pipe(Effect.provide(DeckManagerServicesLive)),
  );

  it.scoped("loads a Q&A card from the whole workspace", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      yield* fileSystem.writeFileString(
        `${workspacePath}/computing.md`,
        `<!--@ effect-card 0 0 0 0-->
What does Effect track?
---
Success, expected errors, and requirements.
`,
      );

      const reviews = yield* ReviewStore;
      const session = yield* reviews.startSession(workspacePath, new Date("2026-08-13T12:00:00Z"));

      expect(session.cards).toHaveLength(1);
      expect(session.totalNew).toBe(1);
      expect(session.totalDue).toBe(0);
      expect(session.issues).toEqual([]);

      const card = yield* reviews.loadCard(session.rootPath, session.cards[0]!);
      expect(card).toEqual({
        prompt: "What does Effect track?",
        reveal: "Success, expected errors, and requirements.",
        cardType: "qa",
        sourceCardIds: ["effect-card"],
        draft: {
          cardType: "qa",
          question: "What does Effect track?",
          answer: "Success, expected errors, and requirements.",
        },
      });
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("prepares inline math for Raycast when loading a card", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      yield* fileSystem.writeFileString(
        `${workspacePath}/computing.md`,
        `<!--@ math-card 0 0 0 0-->
If a page contains $2^n$ bytes, how many offset bits are needed?
---
$n$ bits
`,
      );

      const reviews = yield* ReviewStore;
      const session = yield* reviews.startSession(workspacePath, new Date("2026-08-13T12:00:00Z"));
      const card = yield* reviews.loadCard(session.rootPath, session.cards[0]!);

      expect(card.prompt).toBe(
        "If a page contains \\(2^n\\) bytes, how many offset bits are needed?",
      );
      expect(card.reveal).toBe("\\(n\\) bits");
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("saves Q&A edits without changing scheduling metadata", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${workspacePath}/computing.md`;
      yield* fileSystem.writeFileString(
        deckPath,
        `<!--@ edit-card 10 5 2 0 2026-08-01T12:00:00Z 2026-09-01T12:00:00Z-->
Old question
---
Old answer
`,
      );

      const before = yield* fileSystem.readFileString(deckPath).pipe(Effect.flatMap(parseFile));
      const reviews = yield* ReviewStore;
      yield* reviews.saveEdit(
        {
          deckPath,
          deckName: "computing",
          relativePath: "computing.md",
          cardId: "edit-card",
          cardKey: "main",
        },
        {
          cardType: "qa",
          question: "New question",
          answer: "New answer",
        },
      );

      const after = yield* fileSystem.readFileString(deckPath).pipe(Effect.flatMap(parseFile));
      expect(after.items[0]!.content).toBe("New question\n---\nNew answer");
      expect(after.items[0]!.cards).toEqual(before.items[0]!.cards);
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("keeps the following card separate when editing a Q&A card", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${workspacePath}/computing.md`;
      yield* fileSystem.writeFileString(
        deckPath,
        `<!--@ first-card 0 0 0 0-->
First question
---
First answer

<!--@ second-card 0 0 0 0-->
Second question
---
Second answer
`,
      );

      const reviews = yield* ReviewStore;
      yield* reviews.saveEdit(
        {
          deckPath,
          deckName: "computing",
          relativePath: "computing.md",
          cardId: "first-card",
          cardKey: "main",
        },
        {
          cardType: "qa",
          question: "Edited first question",
          answer: "Edited first answer",
        },
      );

      const after = yield* fileSystem.readFileString(deckPath).pipe(Effect.flatMap(parseFile));
      expect(after.items).toHaveLength(2);
      expect(after.items[0]!.content).toBe("Edited first question\n---\nEdited first answer\n");
      expect(after.items[1]!.cards[0]!.id).toBe("second-card");
      expect(after.items[1]!.content).toBe("Second question\n---\nSecond answer\n");
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("rejects cloze edits that change the generated card indices", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${workspacePath}/geography.md`;
      yield* fileSystem.writeFileString(
        deckPath,
        `<!--@ france-card 0 0 0 0-->
<!--@ germany-card 0 0 0 0-->
France: {{c1::Paris}}. Germany: {{c2::Berlin}}.
`,
      );

      const reviews = yield* ReviewStore;
      const result = yield* reviews
        .saveEdit(
          {
            deckPath,
            deckName: "geography",
            relativePath: "geography.md",
            cardId: "france-card",
            cardKey: "c1",
          },
          {
            cardType: "cloze",
            content: "France: {{c1::Paris}}. Germany: {{c3::Berlin}}.",
          },
        )
        .pipe(Effect.either);

      expect(result).toMatchObject({
        _tag: "Left",
        left: {
          _tag: "ReviewEditValidationError",
          field: "content",
        },
      });
      const written = yield* fileSystem.readFileString(deckPath);
      expect(written).toContain("{{c2::Berlin}}");
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("grades a card and writes its new schedule to the deck", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${workspacePath}/computing.md`;
      yield* fileSystem.writeFileString(
        deckPath,
        `<!--@ effect-card 0 0 0 0-->
What does Effect track?
---
Success, expected errors, and requirements.
`,
      );

      const reviews = yield* ReviewStore;
      const reviewedAt = new Date("2026-08-13T12:00:00Z");
      const session = yield* reviews.startSession(workspacePath, reviewedAt);
      yield* reviews.gradeCard(session.cards[0]!, 2, reviewedAt);

      const written = yield* fileSystem.readFileString(deckPath);
      const parsed = yield* parseFile(written);
      const metadata = parsed.items[0]!.cards[0]!;

      expect(metadata.id).toBe("effect-card");
      expect(metadata.state).not.toBe(State.New);
      expect(metadata.lastReview).toEqual(reviewedAt);
      expect(metadata.due?.getTime()).toBeGreaterThan(reviewedAt.getTime());
      expect(parsed.items[0]!.content).toBe(
        "What does Effect track?\n---\nSuccess, expected errors, and requirements.\n",
      );
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("rejects a missing generated card without changing the deck", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${workspacePath}/cloze.md`;
      const source =
        "<!--@ first-card 0 0 0 0-->\n<!--@ removed-card 0 0 0 0-->\nOnly {{c1::Paris}} remains.\n";
      yield* fileSystem.writeFileString(deckPath, source);
      const reviews = yield* ReviewStore;
      const error = yield* reviews
        .gradeCard(
          {
            deckPath,
            deckName: "cloze",
            relativePath: "cloze.md",
            cardId: "removed-card",
            cardKey: "c2",
          },
          2,
          new Date("2026-08-13T12:00:00Z"),
        )
        .pipe(Effect.flip);

      expect(error._tag).toBe("ReviewGradeError");
      expect(error.cardId).toBe("removed-card");
      expect(yield* fileSystem.readFileString(deckPath)).toBe(source);
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("undoes a grade by restoring the card's exact previous schedule", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${workspacePath}/computing.md`;
      yield* fileSystem.writeFileString(
        deckPath,
        `<!--@ effect-card 0 0 0 0-->
What does Effect track?
---
Success, expected errors, and requirements.
`,
      );

      const before = yield* fileSystem.readFileString(deckPath).pipe(Effect.flatMap(parseFile));
      const previousMetadata = before.items[0]!.cards[0]!;
      const reviews = yield* ReviewStore;
      const reviewedAt = new Date("2026-08-13T12:00:00Z");
      const session = yield* reviews.startSession(workspacePath, reviewedAt);
      const undo = yield* reviews.gradeCard(session.cards[0]!, 2, reviewedAt);

      yield* reviews.undoGrade(undo);

      const written = yield* fileSystem.readFileString(deckPath);
      const parsed = yield* parseFile(written);
      expect(parsed.items[0]!.cards[0]).toEqual(previousMetadata);
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("deletes and restores an entire cloze item", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${workspacePath}/geography.md`;
      yield* fileSystem.writeFileString(
        deckPath,
        `<!--@ lisbon-card 0 0 0 0-->
<!--@ portugal-card 0 0 0 0-->
{{c1::Lisbon}} is the capital of {{c2::Portugal}}.
`,
      );

      const reviews = yield* ReviewStore;
      const session = yield* reviews.startSession(workspacePath, new Date("2026-08-13T12:00:00Z"));
      const loaded = yield* reviews.loadCard(session.rootPath, session.cards[0]!);

      expect(loaded.sourceCardIds).toEqual(["lisbon-card", "portugal-card"]);

      const undo = yield* reviews.deleteItem(session.cards[0]!);
      const afterDelete = yield* fileSystem
        .readFileString(deckPath)
        .pipe(Effect.flatMap(parseFile));
      expect(afterDelete.items).toEqual([]);

      yield* reviews.undoDelete(undo);
      const afterUndo = yield* fileSystem.readFileString(deckPath).pipe(Effect.flatMap(parseFile));
      expect(afterUndo.items).toHaveLength(1);
      expect(afterUndo.items[0]!.cards.map((card) => card.id)).toEqual([
        "lisbon-card",
        "portugal-card",
      ]);
      expect(afterUndo.items[0]!.content).toBe(
        "{{c1::Lisbon}} is the capital of {{c2::Portugal}}.\n",
      );
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("renders each cloze index as its own card", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      yield* fileSystem.writeFileString(
        `${workspacePath}/geography.md`,
        `<!--@ lisbon-card 0 0 0 0-->
<!--@ portugal-card 0 0 0 0-->
{{c1::Lisbon}} is the capital of {{c2::Portugal}}.
`,
      );

      const reviews = yield* ReviewStore;
      const session = yield* reviews.startSession(workspacePath, new Date("2026-08-13T12:00:00Z"));
      const rendered = yield* Effect.forEach(session.cards, (card) =>
        reviews.loadCard(session.rootPath, card),
      );
      const normalized = rendered.map((card) => ({
        ...card,
        prompt: card.prompt.trim(),
        reveal: card.reveal.trim(),
      }));

      expect(rendered).toHaveLength(2);
      expect(normalized).toEqual(
        expect.arrayContaining([
          {
            prompt: "**[...]** is the capital of Portugal.",
            reveal: "**Lisbon** is the capital of Portugal.",
            cardType: "cloze",
            sourceCardIds: ["lisbon-card", "portugal-card"],
            draft: {
              cardType: "cloze",
              content: "{{c1::Lisbon}} is the capital of {{c2::Portugal}}.\n",
            },
          },
          {
            prompt: "Lisbon is the capital of **[...]**.",
            reveal: "Lisbon is the capital of **Portugal**.",
            cardType: "cloze",
            sourceCardIds: ["lisbon-card", "portugal-card"],
            draft: {
              cardType: "cloze",
              content: "{{c1::Lisbon}} is the capital of {{c2::Portugal}}.\n",
            },
          },
        ]),
      );
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("reports invalid decks without hiding valid cards", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      yield* fileSystem.writeFileString(
        `${workspacePath}/valid.md`,
        `<!--@ valid-card 0 0 0 0-->
Question
---
Answer
`,
      );
      yield* fileSystem.writeFileString(
        `${workspacePath}/broken.md`,
        `<!--@ invalid metadata-->
Broken card
`,
      );

      const reviews = yield* ReviewStore;
      const session = yield* reviews.startSession(workspacePath, new Date("2026-08-13T12:00:00Z"));

      expect(session.cards).toHaveLength(1);
      expect(session.cards[0]!.relativePath).toBe("valid.md");
      expect(session.issues).toHaveLength(1);
      expect(session.issues[0]).toMatchObject({
        relativePath: "broken.md",
        kind: "parse_error",
      });
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("returns an empty session when no cards are due or new", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      yield* fileSystem.writeFileString(
        `${workspacePath}/future.md`,
        `<!--@ future-card 10 5 2 0 2026-08-13T12:00:00Z 2026-09-13T12:00:00Z-->
Question
---
Answer
`,
      );

      const reviews = yield* ReviewStore;
      const session = yield* reviews.startSession(workspacePath, new Date("2026-08-13T12:00:00Z"));

      expect(session.cards).toEqual([]);
      expect(session.totalNew).toBe(0);
      expect(session.totalDue).toBe(0);
      expect(session.totalCards).toBe(1);
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );

  it.scoped("resolves deck-relative images for Raycast markdown", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      yield* fileSystem.makeDirectory(`${workspacePath}/notes`);
      yield* fileSystem.writeFileString(
        `${workspacePath}/notes/biology.md`,
        `<!--@ image-card 0 0 0 0-->
What is shown? ![Cell](../images/cell diagram.png)
---
A cell.
`,
      );

      const reviews = yield* ReviewStore;
      const session = yield* reviews.startSession(workspacePath, new Date("2026-08-13T12:00:00Z"));
      const card = yield* reviews.loadCard(session.rootPath, session.cards[0]!);

      expect(card.prompt).toContain(
        `![Cell](${encodeURI(`${workspacePath}/images/cell diagram.png`)})`,
      );
    }).pipe(Effect.provide(TestWithPlatformLive)),
  );
});
