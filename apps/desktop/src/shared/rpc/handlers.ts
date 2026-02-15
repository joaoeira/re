import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { parseFile } from "@re/core";
import { scanDecks } from "@re/workspace";
import { Effect, Layer } from "effect";

import { appContract } from "./contracts";

const APP_NAME = "re Desktop";

const toAppRpcError =
  (code: string, fallbackMessage: string) =>
  (reason: unknown): { code: string; message: string } => {
    if (typeof reason === "object" && reason !== null && "message" in reason) {
      const message = reason.message;
      if (typeof message === "string" && message.length > 0) {
        return { code, message };
      }
    }

    return {
      code,
      message: fallbackMessage,
    };
  };

const ScanDecksServicesLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

export const appRpcHandlers = {
  GetBootstrapData: () =>
    Effect.succeed({
      appName: APP_NAME,
      message: "Renderer connected to main through typed Effect RPC",
      timestamp: new Date().toISOString(),
    }),
  ParseDeckPreview: ({ markdown }: { markdown: string }) =>
    parseFile(markdown).pipe(
      Effect.map((parsed) => ({
        items: parsed.items.length,
        cards: parsed.items.reduce(
          (total, item) => total + item.cards.length,
          0,
        ),
      })),
      Effect.mapError(toAppRpcError("PARSE_ERROR", "Failed to parse deck markdown.")),
    ),
  ScanDecks: ({ rootPath }: { rootPath: string }) =>
    scanDecks(rootPath).pipe(
      Effect.provide(ScanDecksServicesLive),
      Effect.map((result) => ({
        rootPath: result.rootPath,
        decks: result.decks,
      })),
      Effect.mapError(toAppRpcError("SCAN_ERROR", "Failed to scan decks.")),
    ),
};

export type AppContract = typeof appContract;
