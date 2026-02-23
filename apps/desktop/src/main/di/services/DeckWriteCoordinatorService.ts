import { Context, Layer } from "effect";

import type { DeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";

export const DeckWriteCoordinatorService = Context.GenericTag<DeckWriteCoordinator>(
  "@re/desktop/main/DeckWriteCoordinatorService",
);

export const DeckWriteCoordinatorServiceLive = (deckWriteCoordinator: DeckWriteCoordinator) =>
  Layer.succeed(DeckWriteCoordinatorService, deckWriteCoordinator);
