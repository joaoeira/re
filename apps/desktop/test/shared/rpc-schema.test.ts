import { createMetadata, parseFile, serializeFile } from "@re/core";
import { DeckAlreadyExists } from "@re/workspace";
import { Effect, Runtime } from "effect";
import { defineContract } from "electron-effect-rpc/contract";
import { createRpcEndpoint } from "electron-effect-rpc/main";
import { createRpcClient } from "electron-effect-rpc/renderer";
import type { Implementations, RpcHandlerContext } from "electron-effect-rpc/types";
import { expect, it, vi } from "vitest";

import { provideHandlerServices } from "@main/rpc/handlers/shared";
import { UndoReview } from "@shared/rpc/contracts/review";
import { CreateDeck, ParseDeckPreview } from "@shared/rpc/contracts/workspace";

it("preserves library errors and date transformations across desktop RPC", async () => {
  const contract = defineContract({
    methods: [ParseDeckPreview, CreateDeck, UndoReview],
    events: [],
  });
  const listeners = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const sender = { id: 1, isDestroyed: () => false, send: vi.fn() };
  const undoReview = vi.fn((_input: typeof UndoReview.req.Type, _context: RpcHandlerContext) =>
    Effect.succeed({}),
  );
  const endpoint = createRpcEndpoint(
    contract,
    {
      handle: (channel, listener) => listeners.set(channel, listener),
      removeHandler: (channel) => listeners.delete(channel),
    },
    provideHandlerServices({
      ParseDeckPreview: ({ markdown }) =>
        parseFile(markdown).pipe(
          Effect.map((file) => ({
            items: file.items.length,
            cards: file.items.reduce((count, item) => count + item.cards.length, 0),
          })),
        ),
      CreateDeck: ({ relativePath }) =>
        Effect.fail(new DeckAlreadyExists({ deckPath: relativePath })),
      UndoReview: undoReview,
    } satisfies Implementations<typeof contract>),
    { runtime: Runtime.defaultRuntime },
  );
  const client = createRpcClient(contract, {
    invoke: async (method, payload) => {
      const listener = listeners.get(`rpc/${method}`);
      if (!listener) throw new Error(`Missing RPC listener: ${method}`);
      // Exercise the encoded wire values, without sharing object instances across the boundary.
      const response = await listener({ sender }, JSON.parse(JSON.stringify(payload)));
      return JSON.parse(JSON.stringify(response));
    },
  });
  endpoint.start();

  try {
    const previousCard = {
      ...createMetadata(),
      lastReview: new Date("2026-01-01T12:00:00.000Z"),
      due: new Date("2026-01-02T12:00:00.000Z"),
    };
    const markdown = serializeFile({
      preamble: "",
      items: [{ cards: [previousCard], content: "Question\n---\nAnswer\n" }],
    });
    expect(await Effect.runPromise(client.ParseDeckPreview({ markdown }))).toEqual({
      items: 1,
      cards: 1,
    });

    const invalidMetadata = await Effect.runPromise(
      client.ParseDeckPreview({ markdown: "<!--@ invalid-->\n" }).pipe(
        Effect.as(null),
        Effect.catchTag("InvalidMetadataFormat", (error) => Effect.succeed(error)),
      ),
    );
    expect(invalidMetadata).toMatchObject({ line: 1, raw: "invalid" });

    const existingDeck = await Effect.runPromise(
      client.CreateDeck({ relativePath: "existing.md" }).pipe(
        Effect.as(null),
        Effect.catchTag("DeckAlreadyExists", (error) => Effect.succeed(error)),
      ),
    );
    expect(existingDeck).toMatchObject({ deckPath: "existing.md" });

    await Effect.runPromise(
      client.UndoReview({
        deckPath: "existing.md",
        cardId: previousCard.id,
        previousCard,
        reviewEntryId: null,
        expectedCurrentCardFingerprint: "current",
        previousCardFingerprint: "previous",
      }),
    );
    expect(undoReview.mock.calls[0]?.[0].previousCard).toEqual(previousCard);
    expect(undoReview.mock.calls[0]?.[1]).toEqual({ sender });
  } finally {
    endpoint.dispose();
  }
});
