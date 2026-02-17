import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import type { SnapshotWorkspaceResult } from "@re/workspace";
import { Deferred, Effect, FiberId, Runtime } from "effect";
import { describe, expect, it } from "vitest";

import { createWorkspaceWatcher } from "@main/watcher/workspace-watcher";

const runtime = Runtime.defaultRuntime;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const SETTLE_MS = 800;

describe("workspace watcher", () => {
  it("publishes snapshot when .md file is created", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-watcher-"));

    try {
      await fs.writeFile(path.join(rootPath, "existing.md"), "# existing", "utf8");

      const published = Deferred.unsafeMake<SnapshotWorkspaceResult>(FiberId.none);
      const watcher = createWorkspaceWatcher({
        publish: (snapshot) => Deferred.succeed(published, snapshot),
        runtime,
      });

      watcher.start(rootPath);

      await fs.writeFile(path.join(rootPath, "new-deck.md"), "# new deck", "utf8");

      const snapshot = await Effect.runPromise(
        Deferred.await(published).pipe(Effect.timeout("5 seconds")),
      );

      expect(snapshot.rootPath).toBe(rootPath);
      const deckNames = snapshot.decks.map((d) => d.name).sort();
      expect(deckNames).toContain("existing");
      expect(deckNames).toContain("new-deck");

      watcher.stop();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 10000);

  it("ignores non-.md file changes", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-watcher-"));

    try {
      let publishCount = 0;

      const publishedMd = Deferred.unsafeMake<SnapshotWorkspaceResult>(FiberId.none);
      const watcher = createWorkspaceWatcher({
        publish: (snapshot) => {
          publishCount += 1;
          return Deferred.succeed(publishedMd, snapshot);
        },
        runtime,
      });

      watcher.start(rootPath);

      await fs.writeFile(path.join(rootPath, "notes.txt"), "not a deck", "utf8");
      await fs.writeFile(path.join(rootPath, "image.png"), "fake image", "utf8");

      await wait(SETTLE_MS);
      expect(publishCount).toBe(0);

      await fs.writeFile(path.join(rootPath, "deck.md"), "# deck", "utf8");

      await Effect.runPromise(
        Deferred.await(publishedMd).pipe(Effect.timeout("5 seconds")),
      );

      expect(publishCount).toBe(1);

      watcher.stop();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 10000);

  it("debounces rapid changes into a single publish", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-watcher-"));

    try {
      let publishCount = 0;
      let lastSnapshot: SnapshotWorkspaceResult | null = null;

      const firstPublish = Deferred.unsafeMake<void>(FiberId.none);
      const watcher = createWorkspaceWatcher({
        publish: (snapshot) => {
          publishCount += 1;
          lastSnapshot = snapshot;
          return Deferred.succeed(firstPublish, undefined);
        },
        runtime,
      });

      watcher.start(rootPath);

      for (let i = 0; i < 5; i++) {
        await fs.writeFile(path.join(rootPath, `deck-${i}.md`), `# deck ${i}`, "utf8");
      }

      await Effect.runPromise(
        Deferred.await(firstPublish).pipe(Effect.timeout("5 seconds")),
      );

      await wait(SETTLE_MS);

      expect(publishCount).toBe(1);
      expect(lastSnapshot!.decks).toHaveLength(5);

      watcher.stop();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 10000);

  it("stop prevents further publishes", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-watcher-"));

    try {
      let publishCount = 0;
      const watcher = createWorkspaceWatcher({
        publish: () => {
          publishCount += 1;
          return Effect.void;
        },
        runtime,
      });

      watcher.start(rootPath);
      watcher.stop();

      await fs.writeFile(path.join(rootPath, "deck.md"), "# deck", "utf8");

      await wait(SETTLE_MS);

      expect(publishCount).toBe(0);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 10000);

  it("start replaces previous watcher", async () => {
    const rootA = await fs.mkdtemp(path.join(tmpdir(), "re-watcher-a-"));
    const rootB = await fs.mkdtemp(path.join(tmpdir(), "re-watcher-b-"));

    try {
      const published = Deferred.unsafeMake<SnapshotWorkspaceResult>(FiberId.none);
      const watcher = createWorkspaceWatcher({
        publish: (snapshot) => Deferred.succeed(published, snapshot),
        runtime,
      });

      watcher.start(rootA);
      watcher.start(rootB);

      await fs.writeFile(path.join(rootA, "a.md"), "# a", "utf8");
      await fs.writeFile(path.join(rootB, "b.md"), "# b", "utf8");

      const snapshot = await Effect.runPromise(
        Deferred.await(published).pipe(Effect.timeout("5 seconds")),
      );

      expect(snapshot.rootPath).toBe(rootB);

      watcher.stop();
    } finally {
      await fs.rm(rootA, { recursive: true, force: true });
      await fs.rm(rootB, { recursive: true, force: true });
    }
  }, 10000);

  it("handles .reignore changes", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-watcher-"));

    try {
      await fs.writeFile(path.join(rootPath, "deck.md"), "# deck", "utf8");

      const published = Deferred.unsafeMake<SnapshotWorkspaceResult>(FiberId.none);
      const watcher = createWorkspaceWatcher({
        publish: (snapshot) => Deferred.succeed(published, snapshot),
        runtime,
      });

      watcher.start(rootPath);

      await fs.writeFile(path.join(rootPath, ".reignore"), "deck.md\n", "utf8");

      const snapshot = await Effect.runPromise(
        Deferred.await(published).pipe(Effect.timeout("5 seconds")),
      );

      expect(snapshot.decks).toHaveLength(0);

      watcher.stop();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 10000);
});
