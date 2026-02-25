import { Context, Layer } from "effect";

import type { ForgeSessionRepository } from "@main/forge/services/forge-session-repository";

export const ForgeSessionRepositoryService = Context.GenericTag<ForgeSessionRepository>(
  "@re/desktop/main/ForgeSessionRepositoryService",
);

export const ForgeSessionRepositoryServiceLive = (repository: ForgeSessionRepository) =>
  Layer.succeed(ForgeSessionRepositoryService, repository);
