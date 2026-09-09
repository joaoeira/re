import { Data, Effect, Option, Schema } from "effect";
import type { Item } from "./types.js";

export const GradeSchema = Schema.Literals([0, 1, 2, 3]);
export type Grade = typeof GradeSchema.Type;

export interface ContentParseDiagnostic {
  readonly reason: string;
  readonly start: number;
  readonly end?: number;
  readonly fragment: string;
  readonly message: string;
}

export class ContentParseError extends Data.TaggedError("ContentParseError")<{
  readonly type: string;
  readonly message: string;
  readonly raw: string;
  readonly reason?: string;
  readonly start?: number;
  readonly end?: number;
  readonly fragment?: string;
  readonly issues?: ReadonlyArray<ContentParseDiagnostic>;
}> {}

export interface CardSpec<Response, GradeError = never> {
  /** Stable identity within the item, independent of position and rendered text. */
  readonly key: string;
  readonly prompt: string;
  readonly reveal: string;
  readonly cardType: string;
  readonly responseSchema: Schema.Codec<Response, Response, never, never>;
  readonly grade: (response: Response) => Effect.Effect<Grade, GradeError>;
}

export interface ItemType<Content, Response = unknown, GradeError = never> {
  readonly name: string;
  readonly parse: (content: string) => Effect.Effect<Content, ContentParseError>;
  cards(content: Content): ReadonlyArray<CardSpec<Response, GradeError>>;
}

export class ResponseValidationError extends Data.TaggedError("ResponseValidationError")<{
  readonly cardType: string;
  readonly message: string;
  readonly cause: Schema.SchemaError;
}> {}

/** A card that validates an unknown response before invoking its typed grader. */
export interface EvaluableCardSpec<GradeError = never> {
  readonly key: string;
  readonly prompt: string;
  readonly reveal: string;
  readonly cardType: string;
  readonly evaluate: (
    response: unknown,
  ) => Effect.Effect<Grade, ResponseValidationError | GradeError>;
}

/** Keeps parsed content paired with the implementation that consumes it. */
export interface EvaluableItemType<GradeError = never> {
  readonly name: string;
  readonly parseCards: (
    content: string,
  ) => Effect.Effect<ReadonlyArray<EvaluableCardSpec<GradeError>>, ContentParseError>;
}

/** Adapt a typed item type for discovery and evaluation in a mixed collection. */
export const adaptItemType = <Content, Response, GradeError>(
  type: ItemType<Content, Response, GradeError>,
): EvaluableItemType<GradeError> => ({
  name: type.name,
  parseCards: (content) =>
    Effect.suspend(() => type.parse(content)).pipe(
      Effect.map((parsed) =>
        type.cards(parsed).map(
          (card): EvaluableCardSpec<GradeError> => ({
            key: card.key,
            prompt: card.prompt,
            reveal: card.reveal,
            cardType: card.cardType,
            evaluate: (response) =>
              Effect.suspend(() =>
                Schema.decodeUnknownEffect(card.responseSchema)(response).pipe(
                  Effect.mapError(
                    (cause) =>
                      new ResponseValidationError({
                        cardType: card.cardType,
                        message: cause.message,
                        cause,
                      }),
                  ),
                  Effect.flatMap((validated) => card.grade(validated)),
                ),
              ),
          }),
        ),
      ),
    ),
});

export const manualCardSpec = (
  prompt: string,
  reveal: string,
  cardType: string,
  key: string,
): CardSpec<Grade, never> => ({
  key,
  prompt,
  reveal,
  cardType,
  responseSchema: GradeSchema,
  grade: (response) => Effect.succeed(response),
});

export class NoMatchingTypeError extends Data.TaggedError("NoMatchingTypeError")<{
  readonly raw: string;
  readonly triedTypes: ReadonlyArray<string>;
}> {
  override get message(): string {
    return `No registered item type could parse this content (tried: ${this.triedTypes.join(", ") || "none"}).`;
  }
}

export interface InferredCards<GradeError = never> {
  readonly cards: ReadonlyArray<EvaluableCardSpec<GradeError>>;
}

type ItemTypeGradeError<Type> =
  Type extends EvaluableItemType<infer GradeError> ? GradeError : never;

export interface ItemTypeMatch<GradeError = never> {
  readonly type: EvaluableItemType<GradeError>;
  readonly cards: ReadonlyArray<EvaluableCardSpec<GradeError>>;
}

export interface ParseableItemType {
  readonly name: string;
  readonly cardCount: number;
}

export class ItemCardCountMismatch extends Data.TaggedError("ItemCardCountMismatch")<{
  readonly metadataCount: number;
  readonly parseableTypes: readonly [ParseableItemType, ...ParseableItemType[]];
}> {
  override get message(): string {
    const counts = this.parseableTypes.map((type) => `${type.name}: ${type.cardCount}`).join(", ");
    return `Item has ${this.metadataCount} metadata record(s), but its content generates a different number of cards (${counts}).`;
  }
}

/**
 * Match saved content using its metadata count. Returns every matching type in
 * input order so the caller can apply an explicit policy for ambiguous content.
 * Count mismatches retain parseable types and their expected counts for repair.
 */
export function matchItemTypes<Types extends ReadonlyArray<EvaluableItemType<unknown>>>(
  types: Types,
  item: Item,
): Effect.Effect<
  readonly [
    ItemTypeMatch<ItemTypeGradeError<Types[number]>>,
    ...ItemTypeMatch<ItemTypeGradeError<Types[number]>>[],
  ],
  NoMatchingTypeError | ItemCardCountMismatch
>;
export function matchItemTypes(
  types: ReadonlyArray<EvaluableItemType<unknown>>,
  item: Item,
): Effect.Effect<
  readonly [ItemTypeMatch<unknown>, ...ItemTypeMatch<unknown>[]],
  NoMatchingTypeError | ItemCardCountMismatch
> {
  return Effect.gen(function* () {
    const matches: ItemTypeMatch<unknown>[] = [];
    const parseableTypes: ParseableItemType[] = [];

    for (const type of types) {
      const cards = yield* type.parseCards(item.content).pipe(Effect.option);
      if (Option.isNone(cards)) continue;

      parseableTypes.push({ name: type.name, cardCount: cards.value.length });
      if (cards.value.length === item.cards.length) {
        matches.push({ type, cards: cards.value });
      }
    }

    const [first, ...rest] = matches;
    if (first) return [first, ...rest] as const;

    const [parseable, ...otherParseable] = parseableTypes;
    if (parseable) {
      return yield* new ItemCardCountMismatch({
        metadataCount: item.cards.length,
        parseableTypes: [parseable, ...otherParseable],
      });
    }
    return yield* new NoMatchingTypeError({
      raw: item.content,
      triedTypes: types.map((type) => type.name),
    });
  });
}

/**
 * Discover cards using the first matching parser, preserving all registered grading errors.
 * Parsing failures try the next type; evaluation happens only when the caller submits a response.
 */
export function inferCards<Types extends ReadonlyArray<EvaluableItemType<unknown>>>(
  types: Types,
  content: string,
): Effect.Effect<InferredCards<ItemTypeGradeError<Types[number]>>, NoMatchingTypeError>;
export function inferCards(
  types: ReadonlyArray<EvaluableItemType<unknown>>,
  content: string,
): Effect.Effect<InferredCards<unknown>, NoMatchingTypeError> {
  const tryNext = (index: number): Effect.Effect<InferredCards<unknown>, NoMatchingTypeError> =>
    Effect.suspend(() => {
      const type = types[index];
      if (!type) {
        return Effect.fail(
          new NoMatchingTypeError({
            raw: content,
            triedTypes: types.map((type) => type.name),
          }),
        );
      }

      return type.parseCards(content).pipe(
        Effect.map((cards) => ({ cards })),
        Effect.catchTag("ContentParseError", () => tryNext(index + 1)),
      );
    });

  return tryNext(0);
}
