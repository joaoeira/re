import { Schema } from "@effect/schema";

export const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const RawCardSchema = Schema.Struct({
  question: Schema.String,
  answer: Schema.String,
});

type RawCard = typeof RawCardSchema.Type;

export const normalizeCards = (cards: ReadonlyArray<RawCard>): ReadonlyArray<RawCard> => {
  const normalizedCards: RawCard[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const question = collapseWhitespace(card.question);
    const answer = collapseWhitespace(card.answer);
    if (question.length === 0 || answer.length === 0) {
      continue;
    }

    const dedupeKey = `${question}\u0000${answer}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalizedCards.push({ question, answer });
  }

  return normalizedCards;
};

export const NormalizedCardArraySchema = Schema.transform(
  Schema.Array(RawCardSchema),
  Schema.Array(RawCardSchema),
  {
    strict: true,
    decode: (cards) => normalizeCards(cards),
    encode: (cards) => cards,
  },
);
