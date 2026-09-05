import { Data, Effect, Schema, type ParseResult } from "effect";

export const GradeSchema = Schema.Literal(0, 1, 2, 3);
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
  readonly prompt: string;
  readonly reveal: string;
  readonly cardType: string;
  readonly responseSchema: Schema.Schema<Response>;
  readonly grade: (response: Response) => Effect.Effect<Grade, GradeError>;
}

export interface ItemType<Content, Response = unknown, GradeError = never> {
  readonly name: string;
  readonly parse: (content: string) => Effect.Effect<Content, ContentParseError>;
  cards(content: Content): ReadonlyArray<CardSpec<Response, GradeError>>;
}

export interface UntypedCardSpec {
  readonly prompt: string;
  readonly reveal: string;
  readonly cardType: string;
}

export interface UntypedItemType {
  readonly name: string;
  readonly parse: (content: string) => Effect.Effect<unknown, ContentParseError>;
  cards(content: unknown): ReadonlyArray<UntypedCardSpec>;
}

export class ResponseValidationError extends Data.TaggedError("ResponseValidationError")<{
  readonly cardType: string;
  readonly message: string;
  readonly cause: ParseResult.ParseError;
}> {}

/** A card that validates an unknown response before invoking its typed grader. */
export interface EvaluableCardSpec<GradeError = never> extends UntypedCardSpec {
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
            prompt: card.prompt,
            reveal: card.reveal,
            cardType: card.cardType,
            evaluate: (response) =>
              Effect.suspend(() =>
                Schema.decodeUnknown(card.responseSchema)(response).pipe(
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
): CardSpec<Grade, never> => ({
  prompt,
  reveal,
  cardType,
  responseSchema: GradeSchema,
  grade: (response) => Effect.succeed(response),
});

export class NoMatchingTypeError extends Data.TaggedError("NoMatchingTypeError")<{
  readonly raw: string;
  readonly triedTypes: ReadonlyArray<string>;
}> {}

export interface InferredCards<GradeError = never> {
  readonly cards: ReadonlyArray<EvaluableCardSpec<GradeError>>;
}

type ItemTypeGradeError<Type> =
  Type extends EvaluableItemType<infer GradeError> ? GradeError : never;

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
        return new NoMatchingTypeError({
          raw: content,
          triedTypes: types.map((type) => type.name),
        });
      }

      return type.parseCards(content).pipe(
        Effect.map((cards) => ({ cards })),
        Effect.catchTag("ContentParseError", () => tryNext(index + 1)),
      );
    });

  return tryNext(0);
}

export interface InferredType {
  readonly type: UntypedItemType;
  readonly content: unknown;
}

/** Try each type's parser in order until one succeeds. */
export const inferType = (
  types: ReadonlyArray<UntypedItemType>,
  content: string,
): Effect.Effect<InferredType, NoMatchingTypeError> => {
  const tryNext = (
    index: number,
    tried: string[],
  ): Effect.Effect<InferredType, NoMatchingTypeError> => {
    if (index >= types.length) {
      return Effect.fail(new NoMatchingTypeError({ raw: content, triedTypes: tried }));
    }

    const type = types[index]!;
    return type.parse(content).pipe(
      Effect.map((parsed) => ({ type, content: parsed })),
      Effect.catchTag("ContentParseError", () => tryNext(index + 1, [...tried, type.name])),
    );
  };

  return tryNext(0, []);
};
