const assert = require("node:assert/strict");
const { Effect } = require("effect");
const { createMetadata, parseFile, serializeFile } = require("@re/core");
const { QAType, ClozeType } = require("@re/item-types");
const { Scheduler, SchedulerLive } = require("@re/scheduler");

const card = createMetadata();
const content = "Capital of France?\n---\nParis\n";
const source = { preamble: "", items: [{ cards: [card], content }] };
assert.deepEqual(Effect.runSync(parseFile(serializeFile(source))), source);
assert.equal(QAType.cards(Effect.runSync(QAType.parse(content)))[0].reveal, "Paris");
assert.equal(
  ClozeType.cards(Effect.runSync(ClozeType.parse("{{c1::Paris}} is in France."))).length,
  1,
);

const scheduled = Effect.runSync(
  Effect.gen(function* () {
    const scheduler = yield* Scheduler;
    return yield* scheduler.scheduleReview(card, 2, new Date("2026-01-01T12:00:00.000Z"));
  }).pipe(Effect.provide(SchedulerLive)),
);
assert.equal(scheduled.updatedCard.id, card.id);
assert.ok(scheduled.updatedCard.due instanceof Date);
console.log(
  "Passed: CommonJS require, parsing, card types, and scheduling with the consumer's Effect runtime.",
);
