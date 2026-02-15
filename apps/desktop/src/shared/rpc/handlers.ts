import { parseFile } from "@re/core";
import { Effect } from "effect";

import { appContract } from "./contracts";

const APP_NAME = "re Desktop";

const toAppRpcError = (reason: unknown): { code: string; message: string } => {
  if (typeof reason === "object" && reason !== null && "message" in reason) {
    const message = reason.message;
    if (typeof message === "string" && message.length > 0) {
      return { code: "PARSE_ERROR", message };
    }
  }

  return {
    code: "PARSE_ERROR",
    message: "Failed to parse deck markdown.",
  };
};

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
      Effect.mapError(toAppRpcError),
    ),
};

export type AppContract = typeof appContract;
