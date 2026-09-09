const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Effect, Layer } = require("effect");
const NodeFileSystem = require("@effect/platform-node/NodeFileSystem");
const NodePath = require("@effect/platform-node/NodePath");
const { adaptItemType, createMetadata, parseFile } = require("@simbyotic/re/core");
const { QAType } = require("@simbyotic/re/item-types");
const { SchedulerLive } = require("@simbyotic/re/scheduler");
const {
  DeckManager,
  DeckManagerLive,
  ReviewQueueBuilderLive,
  NewFirstOrderingStrategy,
} = require("@simbyotic/re/workspace");
const {
  DeckStore,
  DeckStoreLive,
  ReviewStore,
  makeReviewStoreLive,
} = require("@simbyotic/re/study");

for (const entry of ["core", "item-types", "scheduler", "workspace", "study"]) {
  assert.equal(
    require.resolve(`@simbyotic/re/${entry}`),
    path.resolve("node_modules/@simbyotic/re/dist", entry, "index.js"),
  );
}

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const manager = DeckManagerLive.pipe(Layer.provideMerge(platform));
const queue = ReviewQueueBuilderLive.pipe(
  Layer.provide(Layer.merge(manager, NewFirstOrderingStrategy)),
);
const stores = Layer.merge(
  DeckStoreLive,
  makeReviewStoreLive((_context, markdown) => Effect.succeed(markdown)),
).pipe(Layer.provideMerge(Layer.mergeAll(manager, queue, SchedulerLive)));

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "re-commonjs-study-"));
  const deckPath = path.join(root, "study.md");
  const now = new Date("2026-01-01T12:00:00Z");
  try {
    const reference = await Effect.runPromise(
      Effect.gen(function* () {
        const manager = yield* DeckManager;
        const decks = yield* DeckStore;
        const reviews = yield* ReviewStore;
        yield* manager.createDeck(deckPath);
        const card = createMetadata();
        yield* decks.appendItem(
          deckPath,
          {
            cards: [card],
            content: "Capital of France?\n---\nParis\n",
          },
          adaptItemType(QAType),
        );
        const session = yield* reviews.startSession(root, now);
        assert.equal(session.cards.length, 1);
        const reference = session.cards[0];
        const loaded = yield* reviews.loadCard(root, reference);
        assert.equal(loaded.reveal, "Paris");
        yield* reviews.gradeCard(reference, 2, now);
        return reference;
      }).pipe(Effect.provide(stores)),
    );
    const persisted = Effect.runSync(parseFile(await readFile(deckPath, "utf8")));
    assert.equal(persisted.items[0].cards[0].id, reference.cardId);
    assert.deepEqual(persisted.items[0].cards[0].lastReview, now);
    console.log(
      "Passed: native CommonJS workspace/study imports, shared layers, authoring, loading, grading, and persisted bytes.",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
