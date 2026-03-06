import { FileSystem } from "@effect/platform";
import * as CommandExecutor from "@effect/platform/CommandExecutor";
import { Effect } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import {
  DeckWriteCoordinatorService,
  DuplicateIndexInvalidationService,
  SettingsRepositoryService,
} from "@main/di";
import { makeGitCommandRunner } from "@main/git/command-runner";
import { makeGitSyncService } from "@main/git/sync-service";
import type { AppContract } from "@shared/rpc/contracts";

import { provideHandlerServices } from "./shared";

type GitHandlerKeys = "GetGitSyncSnapshot" | "RunGitSync";

export const createGitHandlers = () =>
  Effect.gen(function* () {
    const settingsRepository = yield* SettingsRepositoryService;
    const mutationCoordinator = yield* DeckWriteCoordinatorService;
    const duplicateIndexInvalidation = yield* DuplicateIndexInvalidationService;
    const fileSystem = yield* FileSystem.FileSystem;
    const commandExecutor = yield* CommandExecutor.CommandExecutor;
    const gitCommandRunner = makeGitCommandRunner({ commandExecutor });
    const gitSyncService = makeGitSyncService({
      fileSystem,
      gitCommandRunner,
      settingsRepository,
      mutationCoordinator,
      duplicateIndexInvalidation,
    });

    const handlers: Pick<Implementations<AppContract, never>, GitHandlerKeys> = {
      GetGitSyncSnapshot: ({ rootPath }) => gitSyncService.getSnapshot({ rootPath }),
      RunGitSync: ({ rootPath }) => gitSyncService.sync({ rootPath }),
    };

    return provideHandlerServices(handlers);
  });
