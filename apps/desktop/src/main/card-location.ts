import type { Item, ParsedFile } from "@simbyotic/re/core";

export const findCardLocationById = (
  parsed: ParsedFile,
  cardId: string,
): { item: Item; card: Item["cards"][number]; itemIndex: number } | null => {
  for (let itemIndex = 0; itemIndex < parsed.items.length; itemIndex++) {
    const item = parsed.items[itemIndex]!;
    for (const card of item.cards) {
      if (card.id === cardId) {
        return { item, card, itemIndex };
      }
    }
  }

  return null;
};
