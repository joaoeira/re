import { Effect } from "effect";
import { createMetadata } from "@re/core";
import { DeckNotFound, type QueueItem } from "@re/workspace";
import { expect, it } from "vitest";
import { prepareReviewQueue } from "../src/lib/review-queue";

it("counts only reviewable cards and retains both deck and item errors", () => {
  const broken = { content: "{{c1::Only one}}", cards: [createMetadata(), createMetadata()] };
  const healthy = { content: "Question\n---\nAnswer", cards: [createMetadata()] };
  const entry = (
    item: QueueItem["item"],
    card: QueueItem["card"],
    category: QueueItem["category"],
  ): QueueItem => ({
    item,
    card,
    category,
    deckPath: "/deck.md",
    deckName: "deck",
    relativePath: "deck.md",
    filePosition: 0,
    dueDate: category === "due" ? new Date("2025-01-01") : null,
  });
  const queue = Effect.runSync(
    prepareReviewQueue({
      items: [
        entry(broken, broken.cards[0]!, "new"),
        entry(broken, broken.cards[1]!, "due"),
        entry(healthy, healthy.cards[0]!, "due"),
      ],
      totalNew: 1,
      totalDue: 2,
      deckErrors: [new DeckNotFound({ deckPath: "/missing.md" })],
    }),
  );
  expect(queue.items).toMatchObject([{ cardKey: "main", card: { id: healthy.cards[0]!.id } }]);
  expect(queue.totalNew).toBe(0);
  expect(queue.totalDue).toBe(1);
  expect(queue.deckErrors).toMatchObject([
    { _tag: "DeckNotFound", deckPath: "/missing.md" },
    {
      _tag: "DeckParseError",
      deckPath: "/deck.md",
      message: expect.stringContaining(broken.cards[0]!.id),
    },
  ]);
});
