import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { createMetadata, parseFile, serializeFile, type ParsedFile } from "@re/core";
import { QAType } from "@re/item-types";
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

const stored: ParsedFile = {
  preamble: "# Geography\n\n",
  items: [{ content, cards: [scheduled.updatedCard] }],
};
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
console.log(
  "Passed: card grading, scheduling, metadata round-trip, due dates, and subsequent review without a filesystem layer.",
);
