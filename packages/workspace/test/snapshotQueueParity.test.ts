import { Path } from "@effect/platform";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  DeckManagerLive,
  QueueOrderingStrategy,
  ReviewDuePolicy,
  ReviewQueueBuilder,
  ReviewQueueBuilderLive,
  resolveDueDateIfDue,
  snapshotWorkspace,
} from "../src";
import { createMockFileSystemLayer, type MockFileSystemConfig } from "./mock-file-system";

describe("snapshot/queue due parity", () => {
  it("matches snapshot dueCards sum and queue totalDue for same asOf", async () => {
    const asOf = new Date("2025-01-10T00:00:00Z");
    const config: MockFileSystemConfig = {
      entryTypes: {
        "/root": "Directory",
        "/root/a.md": "File",
        "/root/b.md": "File",
        "/root/c.md": "File",
      },
      directories: {
        "/root": ["a.md", "b.md", "c.md"],
      },
      fileContents: {
        "/root/a.md": `<!--@ a-new 0 0 0 0-->
Prompt
---
Answer

<!--@ a-due-fallback 2 4 2 0 2025-01-01T00:00:00Z-->
Prompt
---
Answer

<!--@ a-not-due 20 4 2 0 2025-01-09T00:00:00Z-->
Prompt
---
Answer
`,
        "/root/b.md": `<!--@ b-due-stored 2 4 2 0 2025-01-01T00:00:00Z 2025-01-09T00:00:00Z-->
Prompt
---
Answer

<!--@ b-new 0 0 0 0-->
Prompt
---
Answer
`,
      },
      readFileErrors: {
        "/root/c.md": "PermissionDenied" as const,
      },
    };

    const mockFileSystemLayer = createMockFileSystemLayer(config);

    const snapshot = await snapshotWorkspace("/root", { asOf }).pipe(
      Effect.provide(Layer.merge(mockFileSystemLayer, Path.layer)),
      Effect.runPromise,
    );

    const duePolicyLayer = Layer.succeed(ReviewDuePolicy, {
      dueDateIfDue: (card, now) => Option.fromNullable(resolveDueDateIfDue(card, now)),
    });

    const identityOrderingLayer = Layer.succeed(QueueOrderingStrategy, {
      order: (items) => Effect.succeed(items),
    });

    const deckManagerLayer = DeckManagerLive.pipe(
      Layer.provide(Layer.merge(mockFileSystemLayer, Path.layer)),
    );

    const queue = await Effect.gen(function* () {
      const builder = yield* ReviewQueueBuilder;
      return yield* builder.buildQueue({
        deckPaths: ["/root/a.md", "/root/b.md", "/root/c.md"],
        rootPath: "/root",
        now: asOf,
      });
    }).pipe(
      Effect.provide(
        ReviewQueueBuilderLive.pipe(
          Layer.provide(
            Layer.mergeAll(deckManagerLayer, duePolicyLayer, identityOrderingLayer, Path.layer),
          ),
        ),
      ),
      Effect.runPromise,
    );

    const snapshotDueSum = snapshot.decks.reduce(
      (sum, deck) => (deck.status === "ok" ? sum + deck.dueCards : sum),
      0,
    );

    expect(snapshotDueSum).toBe(2);
    expect(queue.totalDue).toBe(2);
    expect(snapshotDueSum).toBe(queue.totalDue);
  });
});
