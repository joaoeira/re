import { FileSystem, Path } from "@effect/platform";
import { snapshotWorkspace, type SnapshotWorkspaceResult } from "@re/workspace";
import { Effect, Fiber, Runtime, Stream } from "effect";

import { NodeServicesLive } from "@main/effect/node-services";

const DEBOUNCE_DURATION = "300 millis";

const SNAPSHOT_OPTIONS = {
  includeHidden: false,
  extraIgnorePatterns: [],
} as const;

export interface WorkspaceWatcher {
  readonly start: (rootPath: string) => void;
  readonly stop: () => void;
}

interface WorkspaceWatcherDeps {
  readonly publish: (snapshot: SnapshotWorkspaceResult) => Effect.Effect<void, never>;
  readonly runtime: Runtime.Runtime<never>;
}

const isRelevantChange = (eventPath: string, pathService: Path.Path): boolean => {
  if (pathService.basename(eventPath) === ".reignore") return true;
  return pathService.extname(eventPath) === ".md";
};

const makeWatchEffect = (
  rootPath: string,
  publish: WorkspaceWatcherDeps["publish"],
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    const snapshotAndPublish = snapshotWorkspace(rootPath, SNAPSHOT_OPTIONS).pipe(
      Effect.flatMap(publish),
      Effect.catchAll((error) => Effect.logWarning("Workspace re-snapshot failed", { error })),
    );

    yield* fs.watch(rootPath, { recursive: true }).pipe(
      Stream.filter((event) => isRelevantChange(event.path, pathService)),
      Stream.debounce(DEBOUNCE_DURATION),
      Stream.runForEach(() => snapshotAndPublish),
      Effect.catchAll((error) => Effect.logWarning("Workspace watcher stream ended", { error })),
    );
  });

export const createWorkspaceWatcher = (deps: WorkspaceWatcherDeps): WorkspaceWatcher => {
  let fiber: Fiber.RuntimeFiber<void, never> | null = null;

  const stop = (): void => {
    if (fiber !== null) {
      Runtime.runFork(deps.runtime)(Fiber.interrupt(fiber));
      fiber = null;
    }
  };

  const start = (rootPath: string): void => {
    stop();
    const effect = makeWatchEffect(rootPath, deps.publish).pipe(Effect.provide(NodeServicesLive));
    fiber = Runtime.runFork(deps.runtime)(effect);
  };

  return { start, stop };
};
