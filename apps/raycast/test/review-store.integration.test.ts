import { FileSystem } from "@effect/platform";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { parseFile, State } from "@re/core";
import {
  DeckManagerLive,
  ReviewQueueBuilderLive,
  SchedulerLive,
  ShuffledOrderingStrategy,
} from "@re/workspace";
import { Effect, Layer } from "effect";

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

describe("ReviewStoreLive", () => {
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
      });
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
          },
          {
            prompt: "Lisbon is the capital of **[...]**.",
            reveal: "Lisbon is the capital of **Portugal**.",
            cardType: "cloze",
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
