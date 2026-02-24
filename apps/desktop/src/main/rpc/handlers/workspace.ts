import path from "node:path";

import { parseFile } from "@re/core";
import {
  DeckFileOperationError,
  DeckManager,
  InvalidDeckPath,
  scanDecks,
  snapshotWorkspace,
} from "@re/workspace";
import { BrowserWindow, dialog } from "electron";
import { Effect } from "effect";
import type { FileSystem, Path } from "@effect/platform";
import type { Implementations } from "electron-effect-rpc/types";

import {
  DeckWriteCoordinatorService,
  DuplicateIndexInvalidationService,
  SettingsRepositoryService,
  WorkspaceWatcherControlService,
} from "@main/di";
import { toErrorMessage } from "@main/utils/format";
import type { AppContract } from "@shared/rpc/contracts";
import { WorkspaceRootPathNotConfiguredError } from "@shared/rpc/schemas/workspace";

import { assertWithinRoot, getConfiguredRootPath, provideHandlerServices } from "./shared";

const APP_NAME = "re Desktop";

type WorkspaceHandlerKeys =
  | "GetBootstrapData"
  | "ParseDeckPreview"
  | "ScanDecks"
  | "GetWorkspaceSnapshot"
  | "CreateDeck"
  | "DeleteDeck"
  | "RenameDeck"
  | "GetSettings"
  | "SetWorkspaceRootPath"
  | "SelectDirectory";

type WorkspaceHandlerRuntime = DeckManager | FileSystem.FileSystem | Path.Path;

export const createWorkspaceHandlers = () =>
  Effect.gen(function* () {
    const settingsRepository = yield* SettingsRepositoryService;
    const watcherControl = yield* WorkspaceWatcherControlService;
    const duplicateIndexInvalidation = yield* DuplicateIndexInvalidationService;
    const deckWriteCoordinator = yield* DeckWriteCoordinatorService;

    const resolveDeckPathFromRelative = (
      rootPath: string,
      relativePath: string,
    ): Effect.Effect<string, InvalidDeckPath> =>
      Effect.gen(function* () {
        const trimmed = relativePath.trim();

        if (trimmed.length === 0) {
          return yield* Effect.fail(
            new InvalidDeckPath({
              inputPath: relativePath,
              reason: "empty_path",
            }),
          );
        }

        if (trimmed.includes("\0")) {
          return yield* Effect.fail(
            new InvalidDeckPath({
              inputPath: relativePath,
              reason: "nul_byte_not_allowed",
            }),
          );
        }

        if (path.isAbsolute(trimmed)) {
          return yield* Effect.fail(
            new InvalidDeckPath({
              inputPath: relativePath,
              reason: "absolute_path_not_allowed",
            }),
          );
        }

        if (path.basename(trimmed) === ".md") {
          return yield* Effect.fail(
            new InvalidDeckPath({
              inputPath: relativePath,
              reason: "invalid_file_name",
            }),
          );
        }

        if (path.extname(trimmed) !== ".md") {
          return yield* Effect.fail(
            new InvalidDeckPath({
              inputPath: relativePath,
              reason: "missing_md_extension",
            }),
          );
        }

        const resolved = path.resolve(path.join(rootPath, trimmed));

        if (!assertWithinRoot(resolved, rootPath)) {
          return yield* Effect.fail(
            new InvalidDeckPath({
              inputPath: relativePath,
              reason: "path_traversal_not_allowed",
            }),
          );
        }

        return resolved;
      });

    const getWorkspaceRootPath = (
      operation: "create" | "delete" | "rename",
    ): Effect.Effect<string, WorkspaceRootPathNotConfiguredError | DeckFileOperationError> =>
      getConfiguredRootPath<WorkspaceRootPathNotConfiguredError | DeckFileOperationError>(
        settingsRepository,
        (error) =>
          new DeckFileOperationError({
            operation,
            message: toErrorMessage(error),
          }),
        () =>
          new WorkspaceRootPathNotConfiguredError({
            message: "Workspace root path is not configured.",
          }),
      );

    const handlers: Pick<
      Implementations<AppContract, WorkspaceHandlerRuntime>,
      WorkspaceHandlerKeys
    > = {
      GetBootstrapData: () =>
        Effect.succeed({
          appName: APP_NAME,
          message: "Renderer connected to main through typed Effect RPC",
          timestamp: new Date().toISOString(),
        }),
      ParseDeckPreview: ({ markdown }) =>
        parseFile(markdown).pipe(
          Effect.map((parsed) => ({
            items: parsed.items.length,
            cards: parsed.items.reduce((total, item) => total + item.cards.length, 0),
          })),
        ),
      ScanDecks: ({ rootPath }) => scanDecks(rootPath),
      GetWorkspaceSnapshot: ({ rootPath, options }) => snapshotWorkspace(rootPath, options),
      CreateDeck: ({ relativePath, createParents, initialContent }) =>
        Effect.gen(function* () {
          const rootPath = yield* getWorkspaceRootPath("create");
          const absolutePath = yield* resolveDeckPathFromRelative(rootPath, relativePath);
          const deckManager = yield* DeckManager;
          const createOptions: {
            createParents?: boolean;
            initialContent?: string;
          } = {};
          if (createParents !== undefined) {
            createOptions.createParents = createParents;
          }
          if (initialContent !== undefined) {
            createOptions.initialContent = initialContent;
          }

          yield* deckWriteCoordinator.withDeckLock(
            absolutePath,
            deckManager.createDeck(absolutePath, createOptions),
          );

          duplicateIndexInvalidation.markDuplicateIndexDirty();

          return { absolutePath };
        }),
      DeleteDeck: ({ relativePath }) =>
        Effect.gen(function* () {
          const rootPath = yield* getWorkspaceRootPath("delete");
          const absolutePath = yield* resolveDeckPathFromRelative(rootPath, relativePath);
          const deckManager = yield* DeckManager;

          yield* deckWriteCoordinator.withDeckLock(
            absolutePath,
            deckManager.deleteDeck(absolutePath),
          );

          duplicateIndexInvalidation.markDuplicateIndexDirty();

          return {};
        }),
      RenameDeck: ({ fromRelativePath, toRelativePath, createParents }) =>
        Effect.gen(function* () {
          const rootPath = yield* getWorkspaceRootPath("rename");
          const fromAbsolutePath = yield* resolveDeckPathFromRelative(rootPath, fromRelativePath);
          const toAbsolutePath = yield* resolveDeckPathFromRelative(rootPath, toRelativePath);
          const deckManager = yield* DeckManager;
          const renameOptions: {
            createParents?: boolean;
          } = {};
          if (createParents !== undefined) {
            renameOptions.createParents = createParents;
          }

          const renameEffect = deckManager.renameDeck(
            fromAbsolutePath,
            toAbsolutePath,
            renameOptions,
          );

          if (fromAbsolutePath === toAbsolutePath) {
            yield* deckWriteCoordinator.withDeckLock(fromAbsolutePath, renameEffect);
          } else {
            const firstPath = fromAbsolutePath < toAbsolutePath ? fromAbsolutePath : toAbsolutePath;
            const secondPath = firstPath === fromAbsolutePath ? toAbsolutePath : fromAbsolutePath;
            yield* deckWriteCoordinator.withDeckLock(
              firstPath,
              deckWriteCoordinator.withDeckLock(secondPath, renameEffect),
            );
          }

          duplicateIndexInvalidation.markDuplicateIndexDirty();

          return { absolutePath: toAbsolutePath };
        }),
      GetSettings: () => settingsRepository.getSettings(),
      SetWorkspaceRootPath: (input) =>
        settingsRepository.setWorkspaceRootPath(input).pipe(
          Effect.tap((settings) =>
            Effect.sync(() => {
              duplicateIndexInvalidation.markDuplicateIndexDirty();
              if (settings.workspace.rootPath) {
                watcherControl.start(settings.workspace.rootPath);
              } else {
                watcherControl.stop();
              }
            }),
          ),
        ),
      SelectDirectory: () =>
        Effect.promise(async () => {
          const options: Electron.OpenDialogOptions = { properties: ["openDirectory"] };
          const focusedWindow = BrowserWindow.getFocusedWindow();
          const result = focusedWindow
            ? await dialog.showOpenDialog(focusedWindow, options)
            : await dialog.showOpenDialog(options);
          return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
        }),
    };

    return provideHandlerServices(handlers);
  });
