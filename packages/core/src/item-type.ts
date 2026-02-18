import { Data, Effect, Schema } from "effect";

export const GradeSchema = Schema.Literal(0, 1, 2, 3);
export type Grade = typeof GradeSchema.Type;

export class ContentParseError extends Data.TaggedError("ContentParseError")<{
  readonly type: string;
  readonly message: string;
  readonly raw: string;
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
