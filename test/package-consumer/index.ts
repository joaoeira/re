import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import {
  createMetadata,
  InvalidMetadataFormat,
  MetadataParseErrorSchema,
  parseFile,
  serializeFile,
  type Item,
  type ParsedFile,
} from "@re/core";
import { ClozeType, QAContent, QAType } from "@re/types";
import {
  DeckManager,
  DeckManagerLive,
  DeckNotFound,
  NewFirstOrderingStrategy,
  ReviewQueueBuilder,
  ReviewQueueBuilderLive,
  Scheduler,
  SchedulerLive,
  scanDecks,
  snapshotWorkspace,
} from "@re/workspace";

// Public imports must resolve to installed JavaScript, never a workspace source file.
for (const name of ["core", "types", "workspace"]) {
  assert.equal(
    fileURLToPath(import.meta.resolve(`@re/${name}`)),
    path.resolve("node_modules/@re", name, "dist/index.js"),
  );
}

const qaContent = "What is the capital of France?\n---\nParis\n\n";
const qa = Effect.runSync(QAType.parse(qaContent));
assert.equal(QAType.cards(qa)[0]?.reveal, "Paris");

// Exported schemas from all three libraries compose with the consumer's Schema implementation.
const ConsumerSchema = Schema.Struct({
  content: QAContent,
  metadataError: MetadataParseErrorSchema,
  workspaceError: DeckNotFound,
});
const schemaValue = {
  content: qa,
  metadataError: new InvalidMetadataFormat({ line: 1, raw: "invalid", reason: "fixture" }),
  workspaceError: new DeckNotFound({ deckPath: "missing.md" }),
};
const encodedSchemaValue = Schema.encodeSync(ConsumerSchema)(schemaValue);
assert.deepEqual(Schema.decodeUnknownSync(ConsumerSchema)(encodedSchemaValue), schemaValue);
assert.throws(() =>
  Schema.decodeUnknownSync(ConsumerSchema)({
    ...encodedSchemaValue,
    metadataError: { ...encodedSchemaValue.metadataError, line: "invalid" },
  }),
);

const clozeContent = "{{c1::Paris}} is in {{c2::France}}.\n";
const cloze = Effect.runSync(ClozeType.parse(clozeContent));
assert.equal(ClozeType.cards(cloze).length, 2);
const qaMetadata = createMetadata();
const item: Item = { cards: [qaMetadata], content: qaContent };
const source: ParsedFile = { preamble: "# Geography\n\n", items: [item] };
const serialized = serializeFile(source);
assert.deepEqual(Effect.runSync(parseFile(serialized)), source);

// The caller provides the platform. Library entry points must not depend on app runtimes.
const PlatformLive = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const DeckLive = DeckManagerLive.pipe(Layer.provideMerge(PlatformLive));
const QueueLive = ReviewQueueBuilderLive.pipe(
  Layer.provide(Layer.merge(DeckLive, NewFirstOrderingStrategy)),
);
const ConsumerLive = Layer.mergeAll(DeckLive, QueueLive, SchedulerLive);
const rootPath = await mkdtemp(path.join(tmpdir(), "re-consumer-decks-"));
const deckPath = path.join(rootPath, "geography.md");
const reviewedAt = new Date("2026-01-01T12:00:00.000Z");
try {
  await Effect.runPromise(
    Effect.gen(function* () {
      const decks = yield* DeckManager;
      const scheduler = yield* Scheduler;
      const queues = yield* ReviewQueueBuilder;
      yield* decks.createDeck(deckPath, { initialContent: serialized });
      const loaded = yield* decks.readDeck(deckPath);
      assert.deepEqual(loaded, source);

      const missing = yield* decks.readDeck(path.join(rootPath, "missing.md")).pipe(
        Effect.as(false),
        Effect.catchTag("DeckNotFound", () => Effect.succeed(true)),
      );
      assert.equal(missing, true, "Tagged errors must remain usable by consumers");

      yield* decks.appendItem(
        deckPath,
        { content: clozeContent, cards: ClozeType.cards(cloze).map(() => createMetadata()) },
        ClozeType,
      );
      const scheduled = yield* scheduler.scheduleReview(qaMetadata, 2, reviewedAt);
      assert.ok(scheduled.updatedCard.due instanceof Date);
      yield* decks.updateCardMetadata(deckPath, qaMetadata.id, scheduled.updatedCard);
      const updated = yield* decks.readDeck(deckPath);
      assert.deepEqual(updated.items[0]?.cards[0], scheduled.updatedCard);
      assert.equal(updated.items[0]?.content, qaContent);
      assert.equal(updated.items[1]?.cards.length, 2);

      const scan = yield* scanDecks(rootPath);
      assert.deepEqual(
        scan.decks.map((deck) => deck.relativePath),
        ["geography.md"],
      );
      const snapshot = yield* snapshotWorkspace(rootPath, { asOf: reviewedAt });
      const deck = snapshot.decks[0];
      assert.ok(deck?.status === "ok");
      assert.equal(deck.totalCards, 3);
      const queue = yield* queues.buildQueue({ deckPaths: [deckPath], rootPath, now: reviewedAt });
      assert.equal(queue.totalNew, 2);
      assert.equal(queue.totalDue, 0);
    }).pipe(Effect.provide(ConsumerLive)),
  );
  // Independently read the bytes written by the library.
  const persisted = Effect.runSync(parseFile(await readFile(deckPath, "utf8")));
  assert.equal(persisted.items[0]?.cards[0]?.lastReview?.toISOString(), reviewedAt.toISOString());
  console.log(
    "Passed: public imports, declarations, schema composition, round-trip, Q&A, cloze, scheduling, tagged errors, deck writes, scan, snapshot, queue.",
  );
} finally {
  await rm(rootPath, { recursive: true, force: true });
}
