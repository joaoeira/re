import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect, Schema } from "effect";
import {
  adaptItemType,
  ContentParseError,
  createMetadata,
  inferCards,
  ItemMetadataSchema,
  ItemSchema,
  parseFile,
  parseMetadata,
  ParsedFileSchema,
  serializeFile,
  serializeMetadata,
  type Grade,
  type Item,
  type ItemMetadata,
  type ItemType,
  type ParsedFile,
  type ResponseValidationError,
} from "@re/core";
import { ClozeType, QAType } from "@re/item-types";
import {
  Scheduler,
  SchedulerLive,
  computeDueDate,
  isCardDue,
  resolveDueDateIfDue,
  type ScheduleResult,
} from "@re/scheduler";

for (const name of ["core", "item-types", "scheduler"]) {
  assert.equal(
    fileURLToPath(import.meta.resolve(`@re/${name}`)),
    path.resolve("node_modules/@re", name, "dist/index.js"),
  );
}

// Keep storage in memory: no filesystem or platform layer is needed to review a card.
const content = "Capital of France?\n---\nParis\n";
const cardSpec = QAType.cards(Effect.runSync(QAType.parse(content)))[0];
assert.ok(cardSpec);
const card = createMetadata();
const reviewedAt = new Date("2026-01-01T12:00:00.000Z");
const scheduled: ScheduleResult = Effect.runSync(
  Effect.gen(function* () {
    const scheduler = yield* Scheduler;
    const grade = yield* cardSpec.grade(2);
    return yield* scheduler.scheduleReview(card, grade, reviewedAt);
  }).pipe(Effect.provide(SchedulerLive)),
);
assert.equal(scheduled.updatedCard.id, card.id);
assert.equal(scheduled.schedulerLog.rating, 2);
assert.deepEqual(scheduled.schedulerLog.previousCard, card);
assert.equal(card.lastReview, null);

// Import a standalone metadata record and validate the in-memory models using
// the installed public schemas before storing the resulting deck.
const stored: ParsedFile = Effect.runSync(
  Effect.gen(function* () {
    const metadata: ItemMetadata = yield* parseMetadata(
      serializeMetadata(scheduled.updatedCard),
    ).pipe(Effect.flatMap(Schema.decodeUnknown(ItemMetadataSchema)));
    assert.deepEqual(metadata, scheduled.updatedCard);
    const item: Item = yield* Schema.decodeUnknown(ItemSchema)({ content, cards: [metadata] });
    return yield* Schema.decodeUnknown(ParsedFileSchema)({
      preamble: "# Geography\n\n",
      items: [item],
    });
  }),
);
const restored = Effect.runSync(parseFile(serializeFile(stored)));
assert.deepEqual(restored, stored);
const restoredCard = restored.items[0]?.cards[0];
assert.ok(restoredCard?.due);
assert.deepEqual(computeDueDate(restoredCard), scheduled.updatedCard.due);
assert.equal(isCardDue(restoredCard, restoredCard.due), true);
assert.deepEqual(resolveDueDateIfDue(restoredCard, restoredCard.due), restoredCard.due);

const nextReviewedAt = restoredCard.due;
const next = Effect.runSync(
  Effect.gen(function* () {
    const scheduler = yield* Scheduler;
    return yield* scheduler.scheduleReview(restoredCard, 2, nextReviewedAt);
  }).pipe(Effect.provide(SchedulerLive)),
);
assert.equal(next.updatedCard.id, card.id);
assert.deepEqual(next.updatedCard.lastReview, restoredCard.due);
assert.deepEqual(next.schedulerLog.previousCard, restoredCard);

// This custom type lives in the consuming app, not in any installed re package.
class AnswerCheckError extends Data.TaggedError("AnswerCheckError")<{
  readonly message: string;
}> {}

const VocabularyType: ItemType<{ readonly answer: string }, string, AnswerCheckError> = {
  name: "vocabulary",
  parse: (raw) =>
    raw.startsWith("vocabulary:")
      ? Effect.succeed({ answer: raw.slice("vocabulary:".length) })
      : new ContentParseError({
          type: "vocabulary",
          raw,
          message: "Expected vocabulary: prefix",
        }),
  cards: ({ answer }) => [
    {
      prompt: "Type the answer",
      reveal: answer,
      cardType: "vocabulary",
      responseSchema: Schema.String,
      grade: (response) =>
        Effect.tryPromise({
          try: (): Promise<Grade> => Promise.resolve().then(() => (response === answer ? 2 : 0)),
          catch: () => new AnswerCheckError({ message: "Answer check failed" }),
        }),
    },
  ],
};

// Exercise the installed declarations and runtime through grading into scheduling.
// Validation, failures, and ordering are covered by the core behavioral tests.
await Effect.runPromise(
  Effect.gen(function* () {
    const types = [adaptItemType(QAType), adaptItemType(ClozeType), adaptItemType(VocabularyType)];
    const inferred = yield* inferCards(types, "vocabulary:Paris");
    const vocabularyCard = inferred.cards[0];
    assert.ok(vocabularyCard);

    const evaluation: Effect.Effect<Grade, ResponseValidationError | AnswerCheckError> =
      vocabularyCard.evaluate("Paris");
    const grade = yield* evaluation;

    const scheduler = yield* Scheduler;
    const metadata = createMetadata();
    const result = yield* scheduler.scheduleReview(metadata, grade, reviewedAt);
    assert.ok(result.updatedCard.due && result.updatedCard.due.getTime() > reviewedAt.getTime());
  }).pipe(Effect.provide(SchedulerLive)),
);
console.log(
  "Passed: built-in and custom async grading, scheduling, standalone metadata import, model validation, metadata round-trip, due dates, and subsequent review without a filesystem layer.",
);
