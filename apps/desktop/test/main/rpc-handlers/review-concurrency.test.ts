import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { Deferred, Effect } from "effect";
import { parseFile } from "@simbyotic/re/core";
import { DeckManager } from "@simbyotic/re/workspace";
import { Scheduler, SchedulerLive } from "@simbyotic/re/scheduler";
import { describe, expect, it } from "vitest";

import { toMetadataFingerprint } from "@main/analytics/fingerprint";
import { DeckManagerServicesLive } from "@main/rpc/handlers/shared";
import { createHandlersWithOverrides } from "./helpers";

const fixture = async () => {
  const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-review-concurrency-"));
  const deckPath = path.join(rootPath, "deck.md");
  await fs.writeFile(deckPath, "<!--@ card-a 0 0 0 0-->\nQuestion\n---\nAnswer");
  const base = await Effect.runPromise(DeckManager.pipe(Effect.provide(DeckManagerServicesLive)));
  const scheduler = Effect.runSync(Scheduler.pipe(Effect.provide(SchedulerLive)));
  const waiting = Effect.runSync(Deferred.make<void>());
  const release = Effect.runSync(Deferred.make<void>());
  let pauseNextWrite = true;
  const beforeWrite = <A, E>(operation: Effect.Effect<A, E>) =>
    Effect.suspend(() => {
      if (!pauseNextWrite) return operation;
      pauseNextWrite = false;
      return Deferred.succeed(waiting, undefined).pipe(
        Effect.zipRight(Deferred.await(release)),
        Effect.zipRight(operation),
      );
    });
  const delayed: DeckManager = {
    ...base,
    modifyCardMetadata: (deck, id, change) =>
      beforeWrite(base.modifyCardMetadata(deck, id, change)),
    updateCardMetadata: (deck, id, metadata) =>
      beforeWrite(base.updateCardMetadata(deck, id, metadata)),
  };
  const handlers = await createHandlersWithOverrides(path.join(rootPath, "settings.json"), {
    deckManager: delayed,
  });
  await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));
  const original = (await Effect.runPromise(base.readDeck(deckPath))).items[0]!.cards[0]!;
  return { rootPath, deckPath, base, scheduler, handlers, original, waiting, release };
};

describe("review concurrency", () => {
  it("grades the latest metadata after waiting to acquire the deck lock", async () => {
    const f = await fixture();
    const grading = Effect.runPromise(
      f.handlers.ScheduleReview({
        deckPath: f.deckPath,
        cardId: "card-a",
        cardKey: "main",
        grade: 2,
      }),
    );
    try {
      await Effect.runPromise(
        Deferred.await(f.waiting).pipe(
          Effect.timeoutFail({
            duration: "500 millis",
            onTimeout: () =>
              new Error("RPC bypassed the shared DeckManager: metadata write was not reached."),
          }),
        ),
      );
      const intervening = await Effect.runPromise(
        f.scheduler.scheduleReview(f.original, 2, new Date("2026-08-01T12:00:00Z")),
      );
      await Effect.runPromise(
        f.base.updateCardMetadata(f.deckPath, "card-a", intervening.updatedCard),
      );
      await Effect.runPromise(Deferred.succeed(f.release, undefined));
      const result = await grading;
      expect(result.previousCard).toEqual(intervening.updatedCard);
      expect(result.previousCardFingerprint).toBe(toMetadataFingerprint(intervening.updatedCard));
    } finally {
      await Effect.runPromise(Deferred.succeed(f.release, undefined));
      await grading.catch(() => undefined);
      await fs.rm(f.rootPath, { recursive: true, force: true });
    }
  });

  it("rechecks undo's fingerprint under the deck lock before restoring metadata", async () => {
    const f = await fixture();
    const first = await Effect.runPromise(
      f.scheduler.scheduleReview(f.original, 2, new Date("2026-08-01T12:00:00Z")),
    );
    await Effect.runPromise(f.base.updateCardMetadata(f.deckPath, "card-a", first.updatedCard));
    const undoing = Effect.runPromise(
      f.handlers
        .UndoReview({
          deckPath: f.deckPath,
          cardId: "card-a",
          previousCard: f.original,
          reviewEntryId: null,
          expectedCurrentCardFingerprint: toMetadataFingerprint(first.updatedCard),
          previousCardFingerprint: toMetadataFingerprint(f.original),
        })
        .pipe(Effect.either),
    );
    try {
      await Effect.runPromise(
        Deferred.await(f.waiting).pipe(
          Effect.timeoutFail({
            duration: "500 millis",
            onTimeout: () =>
              new Error("RPC bypassed the shared DeckManager: metadata write was not reached."),
          }),
        ),
      );
      const newer = await Effect.runPromise(
        f.scheduler.scheduleReview(first.updatedCard, 2, new Date("2026-08-02T12:00:00Z")),
      );
      await Effect.runPromise(f.base.updateCardMetadata(f.deckPath, "card-a", newer.updatedCard));
      const beforeUndo = await fs.readFile(f.deckPath, "utf8");
      await Effect.runPromise(Deferred.succeed(f.release, undefined));
      expect(await undoing).toMatchObject({ _tag: "Left", left: { _tag: "undo_conflict" } });
      expect(await fs.readFile(f.deckPath, "utf8")).toBe(beforeUndo);
    } finally {
      await Effect.runPromise(Deferred.succeed(f.release, undefined));
      await undoing;
      await fs.rm(f.rootPath, { recursive: true, force: true });
    }
  });

  it("preserves concurrent editor writes across separate RPC calls", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-rpc-shared-lock-"));
    const deckPath = path.join(rootPath, "deck.md");
    try {
      await fs.writeFile(deckPath, "");
      const handlers = await createHandlersWithOverrides(path.join(rootPath, "settings.json"));
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));
      const contents = Array.from({ length: 12 }, (_, index) => `Question ${index}\n---\nAnswer`);
      await Effect.runPromise(
        Effect.forEach(
          contents,
          (content) => handlers.AppendItem({ deckPath, cardType: "qa", content }),
          { concurrency: "unbounded" },
        ),
      );
      const saved = Effect.runSync(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(saved.items.map((item) => item.content.trim()).sort()).toEqual(contents.sort());
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
