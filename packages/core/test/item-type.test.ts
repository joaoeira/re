import { Data, Deferred, Effect, Exit, Fiber, Option, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { expectTypeOf } from "vitest";
import {
  adaptItemType,
  ContentParseError,
  inferCards,
  type Grade,
  type ItemType,
  type ResponseValidationError,
} from "../src/index";

interface TextContent {
  readonly answer: string;
}

const textType = <E>(
  grade: (response: string, answer: string) => Effect.Effect<Grade, E>,
): ItemType<TextContent, string, E> => ({
  name: "text",
  parse: (raw) =>
    raw.startsWith("text:")
      ? Effect.succeed({ answer: raw.slice(5) })
      : new ContentParseError({ type: "text", raw, message: "Expected text: prefix" }),
  cards: ({ answer }) => [
    {
      prompt: "Type the answer",
      reveal: answer,
      cardType: "text",
      responseSchema: Schema.String,
      grade: (response) => grade(response, answer),
    },
  ],
});

class TextGradeError extends Data.TaggedError("TextGradeError")<{
  readonly message: string;
}> {}

class NumberGradeError extends Data.TaggedError("NumberGradeError")<{
  readonly message: string;
}> {}

describe("card evaluation", () => {
  it.effect("keeps each parsed value paired with its grader in a mixed registry", () =>
    Effect.gen(function* () {
      const text = textType(
        (response, answer): Effect.Effect<Grade, TextGradeError> =>
          Effect.succeed(response === answer ? 2 : 0),
      );
      const number: ItemType<number, number, NumberGradeError> = {
        name: "number",
        parse: (raw) =>
          raw.startsWith("number:")
            ? Effect.succeed(Number(raw.slice(7)))
            : new ContentParseError({ type: "number", raw, message: "Expected number: prefix" }),
        cards: (answer) => [
          {
            prompt: "Enter the number",
            reveal: String(answer),
            cardType: "number",
            responseSchema: Schema.Number,
            grade: (response) => Effect.succeed(response === answer ? 3 : 0),
          },
        ],
      };
      const types = [adaptItemType(text), adaptItemType(number)];
      const inferredText = yield* inferCards(types, "text:Paris");
      const textCard = inferredText.cards[0]!;
      expectTypeOf(textCard.evaluate).returns.toEqualTypeOf<
        Effect.Effect<Grade, ResponseValidationError | TextGradeError | NumberGradeError>
      >();
      expect(yield* textCard.evaluate("Paris")).toBe(2);

      const inferredNumber = yield* inferCards(types, "number:42");
      expect(yield* inferredNumber.cards[0]!.evaluate(42)).toBe(3);
    }),
  );

  it.effect("rejects invalid responses before running the grader", () =>
    Effect.gen(function* () {
      const responses: string[] = [];
      const type = adaptItemType(
        textType((response) =>
          Effect.sync(() => {
            responses.push(response);
            return 2;
          }),
        ),
      );
      const { cards } = yield* inferCards([type], "text:Paris");
      const card = cards[0]!;
      const error = yield* card.evaluate(42).pipe(Effect.flip);
      expect(error._tag).toBe("ResponseValidationError");
      expect(error.cardType).toBe("text");
      expect(responses).toEqual([]);
    }),
  );

  it.effect("waits for an asynchronous grader", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const result = yield* Deferred.make<Grade>();
      const type = adaptItemType(
        textType(() => Deferred.succeed(started, undefined).pipe(Effect.zipRight(result))),
      );
      const { cards } = yield* inferCards([type], "text:Paris");
      const fiber = yield* cards[0]!.evaluate("Paris").pipe(Effect.fork);
      yield* started;
      yield* Effect.yieldNow();
      expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
      yield* Deferred.succeed(result, 3);
      expect(yield* Fiber.join(fiber)).toBe(3);
    }),
  );

  it.effect("passes the schema's decoded response to the grader", () =>
    Effect.gen(function* () {
      const text = textType((response, answer) => Effect.succeed(response === answer ? 2 : 0));
      const trimmed: ItemType<TextContent, string> = {
        ...text,
        cards: (content) =>
          text.cards(content).map((card) => ({ ...card, responseSchema: Schema.Trim })),
      };
      const { cards } = yield* inferCards([adaptItemType(trimmed)], "text:Paris");
      expect(yield* cards[0]!.evaluate("  Paris  ")).toBe(2);
    }),
  );

  it.effect("preserves asynchronous grading failures for catchTag", () =>
    Effect.gen(function* () {
      const failure = new TextGradeError({ message: "Grading service unavailable" });
      const type = adaptItemType(
        textType(() =>
          Effect.tryPromise({
            try: () => Promise.reject(failure),
            catch: () => failure,
          }),
        ),
      );
      const { cards } = yield* inferCards([type], "text:Paris");
      const caught = yield* cards[0]!
        .evaluate("Paris")
        .pipe(Effect.catchTag("TextGradeError", (error) => Effect.succeed(error.message)));
      expect(caught).toBe("Grading service unavailable");
    }),
  );

  it.effect("interrupts an in-flight grader and runs its cleanup", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const cleanedUp = yield* Deferred.make<void>();
      const type = adaptItemType(
        textType(() =>
          Deferred.succeed(started, undefined).pipe(
            Effect.zipRight(Effect.never),
            Effect.ensuring(Deferred.succeed(cleanedUp, undefined)),
          ),
        ),
      );
      const { cards } = yield* inferCards([type], "text:Paris");
      const fiber = yield* cards[0]!.evaluate("Paris").pipe(Effect.fork);
      yield* started;
      expect(Exit.isInterrupted(yield* Fiber.interrupt(fiber))).toBe(true);
      expect(yield* Deferred.isDone(cleanedUp)).toBe(true);
    }),
  );

  it.effect("uses the first matching type when parsers overlap", () =>
    Effect.gen(function* () {
      const first = adaptItemType(textType(() => Effect.succeed(1)));
      const second = { ...adaptItemType(textType(() => Effect.succeed(3))), name: "second" };
      const { cards } = yield* inferCards([first, second], "text:Paris");
      expect(yield* cards[0]!.evaluate("Paris")).toBe(1);
    }),
  );

  it.effect("reports exhausted discovery as NoMatchingTypeError", () =>
    Effect.gen(function* () {
      const first = adaptItemType(textType(() => Effect.succeed(1)));
      const second = { ...first, name: "second" };
      const attempted = yield* inferCards([first, second], "unrecognized").pipe(
        Effect.catchTag("NoMatchingTypeError", (error) => Effect.succeed(error.triedTypes)),
      );
      expect(attempted).toEqual(["text", "second"]);
    }),
  );
});
