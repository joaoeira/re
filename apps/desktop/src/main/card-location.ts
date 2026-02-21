import type { Item, ParsedFile } from "@re/core";

export const findCardLocationById = (
  parsed: ParsedFile,
  cardId: string,
): { item: Item; card: Item["cards"][number]; itemIndex: number; cardIndex: number } | null => {
  for (let itemIndex = 0; itemIndex < parsed.items.length; itemIndex++) {
    const item = parsed.items[itemIndex]!;
    for (let cardIndex = 0; cardIndex < item.cards.length; cardIndex++) {
      const card = item.cards[cardIndex]!;
      if (card.id === cardId) {
        return { item, card, itemIndex, cardIndex };
      }
    }
  }

  return null;
};
