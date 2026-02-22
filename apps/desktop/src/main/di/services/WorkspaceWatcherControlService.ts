import { Context, Effect, Layer } from "effect";

import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";

export interface WorkspaceWatcherControlService {
  readonly start: (rootPath: string) => void;
  readonly stop: () => void;
  readonly bind: (watcher: WorkspaceWatcher) => void;
}

const noOpWatcher: WorkspaceWatcher = {
  start: () => undefined,
  stop: () => undefined,
};

export const WorkspaceWatcherControlService = Context.GenericTag<WorkspaceWatcherControlService>(
  "@re/desktop/main/WorkspaceWatcherControlService",
);

export const makeWorkspaceWatcherControlBridgeService = (): WorkspaceWatcherControlService => {
  let currentWatcher: WorkspaceWatcher = noOpWatcher;

  return {
    start: (rootPath) => currentWatcher.start(rootPath),
    stop: () => currentWatcher.stop(),
    bind: (watcher) => {
      currentWatcher = watcher;
    },
  };
};

export const WorkspaceWatcherControlBridgeLive = Layer.effect(
  WorkspaceWatcherControlService,
  Effect.sync(makeWorkspaceWatcherControlBridgeService),
);

export const WorkspaceWatcherControlServiceLive = (watcher: WorkspaceWatcher) =>
  Layer.succeed(WorkspaceWatcherControlService, {
    start: (rootPath) => watcher.start(rootPath),
    stop: () => watcher.stop(),
    bind: () => undefined,
  });
