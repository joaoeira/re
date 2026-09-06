import { Context, Layer } from "effect";

import type { GitSyncCoordinator } from "@main/git/sync-coordinator";

export const GitSyncCoordinatorService = Context.GenericTag<GitSyncCoordinator>(
  "@re/desktop/main/GitSyncCoordinatorService",
);

export const GitSyncCoordinatorServiceLive = (gitSyncCoordinator: GitSyncCoordinator) =>
  Layer.succeed(GitSyncCoordinatorService, gitSyncCoordinator);
