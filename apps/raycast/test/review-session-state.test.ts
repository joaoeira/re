import { describe, expect, it } from "vitest";

import {
  removeSourceItemFromSession,
  restoreSourceItemToSession,
} from "../src/review-session-state";
import type { ReviewCardReference, ReviewSession } from "../src/review-store";

const reference = (cardId: string, cardIndex: number): ReviewCardReference => ({
  deckPath: "/decks/geography.md",
  deckName: "geography",
  relativePath: "geography.md",
  cardId,
  cardIndex,
});

const session = (cards: readonly ReviewCardReference[]): ReviewSession => ({
  rootPath: "/decks",
  cards,
  totalDue: 0,
  totalNew: cards.length,
  totalCards: cards.length,
  issues: [],
});

describe("Raycast review session deletion", () => {
  it("removes every cloze sibling and continues with the next surviving card", () => {
    const current = session([
      reference("reviewed", 0),
      reference("cloze-a", 0),
      reference("next", 0),
      reference("cloze-b", 1),
    ]);

    const removal = removeSourceItemFromSession(current, 1, {
      deckPath: "/decks/geography.md",
      sourceCardIds: ["cloze-a", "cloze-b"],
    });

    expect(removal.session.cards.map((card) => card.cardId)).toEqual(["reviewed", "next"]);
    expect(removal.removedEntries.map(({ index, card }) => [index, card.cardId])).toEqual([
      [1, "cloze-a"],
      [3, "cloze-b"],
    ]);
    expect(removal.nextIndex).toBe(1);
  });

  it("restores every removed queue entry at its original position", () => {
    const current = session([
      reference("reviewed", 0),
      reference("cloze-a", 0),
      reference("next", 0),
      reference("cloze-b", 1),
    ]);
    const removal = removeSourceItemFromSession(current, 1, {
      deckPath: "/decks/geography.md",
      sourceCardIds: ["cloze-a", "cloze-b"],
    });

    const restored = restoreSourceItemToSession(removal.session, removal.removedEntries);

    expect(restored.cards).toEqual(current.cards);
  });

  it("completes instead of returning to an already reviewed card", () => {
    const current = session([reference("reviewed", 0), reference("current", 0)]);

    const removal = removeSourceItemFromSession(current, 1, {
      deckPath: "/decks/geography.md",
      sourceCardIds: ["current"],
    });

    expect(removal.session.cards.map((card) => card.cardId)).toEqual(["reviewed"]);
    expect(removal.nextIndex).toBeNull();
  });
});
