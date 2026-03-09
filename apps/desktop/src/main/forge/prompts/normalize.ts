import { Schema } from "@effect/schema";

export const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const RawCardSchema = Schema.Struct({
  question: Schema.String,
  answer: Schema.String,
});

type RawCard = typeof RawCardSchema.Type;

export const normalizeCard = (card: RawCard): RawCard | null => {
  const question = collapseWhitespace(card.question);
  const answer = collapseWhitespace(card.answer);
  if (question.length === 0 || answer.length === 0) {
    return null;
  }

  return { question, answer };
};

export const normalizeCards = (cards: ReadonlyArray<RawCard>): ReadonlyArray<RawCard> => {
  const normalizedCards: RawCard[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const normalizedCard = normalizeCard(card);
    if (!normalizedCard) {
      continue;
    }

    const { question, answer } = normalizedCard;
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

export const NormalizedCardSchema = Schema.transform(RawCardSchema, RawCardSchema, {
  strict: true,
  decode: (card) => normalizeCard(card) ?? { question: "", answer: "" },
  encode: (card) => card,
}).pipe(
  Schema.filter((card) => card.question.length > 0 && card.answer.length > 0, {
    message: () => ({
      message: "Card question and answer must both contain non-empty text after normalization.",
      override: true,
    }),
  }),
);
