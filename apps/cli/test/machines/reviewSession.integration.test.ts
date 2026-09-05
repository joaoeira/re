import { FileSystem, Path } from "@effect/platform";
import { createMetadata, parseFile, serializeFile, State } from "@re/core";
import { SchedulerLive } from "@re/scheduler";
import { DeckManagerLive, type QueueItem } from "@re/workspace";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";
import { reviewSessionMachine } from "../../src/machines/reviewSession";

const createFixture = (cardIndex: number) => {
  const item = {
    cards: Array.from({ length: cardIndex + 1 }, () => createMetadata()),
    content: "Question\n---\nAnswer\n",
  };
  const queueItem: QueueItem = {
    deckPath: "/deck.md",
    deckName: "deck",
    relativePath: "deck.md",
    item,
    card: item.cards[cardIndex]!,
    cardIndex,
    filePosition: 0,
    category: "new",
    dueDate: null,
  };
  const files = new Map([[queueItem.deckPath, serializeFile({ preamble: "", items: [item] })]]);
  let nextTempFile = 0;
  const fileSystem = FileSystem.makeNoop({
    makeTempFileScoped: () =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const path = `/temp-${nextTempFile++}`;
          files.set(path, "");
          return path;
        }),
        (path) =>
          Effect.sync(() => {
            files.delete(path);
          }),
      ),
    readFileString: (path) => Effect.sync(() => files.get(path)!),
    writeFileString: (path, content) =>
      Effect.sync(() => {
        files.set(path, content);
      }),
    rename: (from, to) =>
      Effect.sync(() => {
        files.set(to, files.get(from)!);
        files.delete(from);
      }),
    remove: (path) =>
      Effect.sync(() => {
        files.delete(path);
      }),
  });
  const runtime = ManagedRuntime.make(
    Layer.merge(
      SchedulerLive,
      DeckManagerLive.pipe(
        Layer.provide(Layer.merge(Layer.succeed(FileSystem.FileSystem, fileSystem), Path.layer)),
      ),
    ),
  );
  return { queueItem, files, runtime };
};

describe("review session persistence", () => {
  it("saves an evaluated review before completing the session", async () => {
    const { queueItem, files, runtime } = createFixture(0);
    const actor = createActor(reviewSessionMachine, {
      input: { queue: [queueItem], runtime: await runtime.runtime() },
    });
    try {
      actor.start();
      actor.send({ type: "START" });
      actor.send({ type: "REVEAL" });
      actor.send({ type: "GRADE", grade: 2 });
      await waitFor(actor, (state) => state.matches("complete"));

      const saved = Effect.runSync(parseFile(files.get(queueItem.deckPath)!));
      expect(saved.items[0]!.cards[0]!.state).not.toBe(State.New);
      expect(actor.getSnapshot().context.sessionStats.reviewed).toBe(1);
    } finally {
      actor.stop();
      await runtime.dispose();
    }
  });

  it("keeps a failed review on screen without saving or counting it", async () => {
    const { queueItem, files, runtime } = createFixture(1);
    const original = files.get(queueItem.deckPath);
    const actor = createActor(reviewSessionMachine, {
      input: { queue: [queueItem], runtime: await runtime.runtime() },
    });
    try {
      actor.start();
      actor.send({ type: "START" });
      actor.send({ type: "REVEAL" });
      actor.send({ type: "GRADE", grade: 2 });
      await waitFor(actor, (state) => state.context.error !== null || state.matches("complete"));

      expect(actor.getSnapshot().matches({ presenting: "showAnswer" })).toBe(true);
      expect(actor.getSnapshot().context.sessionStats.reviewed).toBe(0);
      expect(files.get(queueItem.deckPath)).toBe(original);
    } finally {
      actor.stop();
      await runtime.dispose();
    }
  });
});
