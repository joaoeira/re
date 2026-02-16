import { FileSystem, Path } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Schema } from "@effect/schema";
import { Effect, Option } from "effect";

import {
  DEFAULT_SETTINGS,
  SettingsDecodeFailed,
  SettingsReadFailed,
  SettingsWriteFailed,
  WorkspaceRootNotDirectory,
  WorkspaceRootNotFound,
  WorkspaceRootUnreadable,
  type SetWorkspaceRootPathInput,
  type Settings,
  type SettingsError,
} from "@shared/settings";
import { SettingsSchemaV1 } from "@shared/settings/schema";

export interface SettingsRepository {
  readonly getSettings: () => Effect.Effect<Settings, SettingsError>;
  readonly setWorkspaceRootPath: (
    input: SetWorkspaceRootPathInput,
  ) => Effect.Effect<Settings, SettingsError>;
}

export interface MakeSettingsRepositoryOptions {
  readonly settingsFilePath: string;
}

const asMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const toReadFailed = (
  settingsFilePath: string,
  message: string,
): SettingsReadFailed =>
  new SettingsReadFailed({
    path: settingsFilePath,
    message,
  });

const toDecodeFailed = (
  settingsFilePath: string,
  message: string,
): SettingsDecodeFailed =>
  new SettingsDecodeFailed({
    path: settingsFilePath,
    message,
  });

const toWriteFailed = (
  settingsFilePath: string,
  message: string,
): SettingsWriteFailed =>
  new SettingsWriteFailed({
    path: settingsFilePath,
    message,
  });

const toWorkspaceUnreadable = (
  rootPath: string,
  message: string,
): WorkspaceRootUnreadable =>
  new WorkspaceRootUnreadable({
    rootPath,
    message,
  });

const mapWorkspaceRootStatError = (
  rootPath: string,
  error: PlatformError,
): WorkspaceRootNotFound | WorkspaceRootUnreadable => {
  if (error._tag === "SystemError" && error.reason === "NotFound") {
    return new WorkspaceRootNotFound({ rootPath });
  }

  return toWorkspaceUnreadable(rootPath, error.message);
};

const mapWorkspaceRootReadError = (
  rootPath: string,
  error: PlatformError,
): WorkspaceRootUnreadable =>
  toWorkspaceUnreadable(rootPath, error.message);

export const makeSettingsRepository = ({
  settingsFilePath,
}: MakeSettingsRepositoryOptions): Effect.Effect<
  SettingsRepository,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const semaphore = yield* Effect.makeSemaphore(1);

    const settingsDirectory = pathService.dirname(settingsFilePath);
    const settingsCodec = Schema.parseJson(SettingsSchemaV1, { space: 2 });
    const decodeSettings = Schema.decodeUnknown(settingsCodec);
    const encodeSettings = Schema.encode(settingsCodec);

    const loadSettings = (): Effect.Effect<
      Settings,
      SettingsReadFailed | SettingsDecodeFailed
    > =>
      Effect.gen(function* () {
        const rawSettings = yield* fileSystem
          .readFileString(settingsFilePath, "utf8")
          .pipe(
            Effect.map(Option.some),
            Effect.catchTag("SystemError", (error) =>
              error.reason === "NotFound"
                ? Effect.succeed(Option.none())
                : Effect.fail(
                    toReadFailed(
                      settingsFilePath,
                      `Unable to read settings file: ${error.message}`,
                    ),
                  ),
            ),
            Effect.catchTag("BadArgument", (error) =>
              Effect.fail(
                toReadFailed(
                  settingsFilePath,
                  `Invalid settings path or read arguments: ${error.message}`,
                ),
              ),
            ),
          );

        if (Option.isNone(rawSettings)) {
          return DEFAULT_SETTINGS;
        }

        return yield* decodeSettings(rawSettings.value).pipe(
          Effect.mapError((error) =>
            toDecodeFailed(
              settingsFilePath,
              `Settings file failed schema validation: ${asMessage(error)}`,
            ),
          ),
        );
      });

    const persistSettings = (
      settings: Settings,
    ): Effect.Effect<void, SettingsWriteFailed> =>
      Effect.gen(function* () {
        const serialized = yield* encodeSettings(settings).pipe(
          Effect.mapError((error) =>
            toWriteFailed(
              settingsFilePath,
              `Unable to encode settings payload: ${asMessage(error)}`,
            ),
          ),
        );

        const tempFilePath = `${settingsFilePath}.${Date.now()}.tmp`;

        const mapWritePlatformError = (
          error: PlatformError,
        ): SettingsWriteFailed =>
          toWriteFailed(
            settingsFilePath,
            `Unable to persist settings file: ${error.message}`,
          );

        const writeAndCommit = Effect.gen(function* () {
          yield* fileSystem
            .makeDirectory(settingsDirectory, { recursive: true })
            .pipe(Effect.mapError(mapWritePlatformError));

          yield* Effect.scoped(
            Effect.gen(function* () {
              const file = yield* fileSystem
                .open(tempFilePath, { flag: "w" })
                .pipe(Effect.mapError(mapWritePlatformError));

              const content = new TextEncoder().encode(serialized);
              yield* file.writeAll(content).pipe(Effect.mapError(mapWritePlatformError));
              yield* file.sync.pipe(Effect.mapError(mapWritePlatformError));
            }),
          );

          yield* fileSystem
            .rename(tempFilePath, settingsFilePath)
            .pipe(Effect.mapError(mapWritePlatformError));
        });

        yield* writeAndCommit.pipe(
          Effect.catchAll((error) =>
            fileSystem.remove(tempFilePath, { force: true }).pipe(
              Effect.catchAll(() => Effect.void),
              Effect.zipRight(Effect.fail(error)),
            ),
          ),
        );
      });

    const validateWorkspaceRootPath = (
      rootPath: string | null,
    ): Effect.Effect<
      string | null,
      WorkspaceRootNotFound | WorkspaceRootNotDirectory | WorkspaceRootUnreadable
    > => {
      if (rootPath === null) {
        return Effect.succeed(null);
      }

      return Effect.gen(function* () {
        const normalizedRootPath = pathService.resolve(rootPath);

        const stat = yield* fileSystem
          .stat(normalizedRootPath)
          .pipe(
            Effect.mapError((error) =>
              mapWorkspaceRootStatError(normalizedRootPath, error),
            ),
          );

        if (stat.type !== "Directory") {
          return yield* new WorkspaceRootNotDirectory({
            rootPath: normalizedRootPath,
          });
        }

        yield* fileSystem.readDirectory(normalizedRootPath).pipe(
          Effect.mapError((error) =>
            mapWorkspaceRootReadError(normalizedRootPath, error),
          ),
        );

        return normalizedRootPath;
      });
    };

    const withLock = semaphore.withPermits(1);

    return {
      getSettings: () => withLock(loadSettings()),
      setWorkspaceRootPath: (input) =>
        withLock(
          loadSettings().pipe(
            Effect.flatMap((currentSettings) =>
              validateWorkspaceRootPath(input.rootPath).pipe(
                Effect.map((validatedRootPath) => ({
                  ...currentSettings,
                  workspace: {
                    ...currentSettings.workspace,
                    rootPath: validatedRootPath,
                  },
                })),
              ),
            ),
            Effect.flatMap((nextSettings) =>
              persistSettings(nextSettings).pipe(Effect.as(nextSettings)),
            ),
          ),
        ),
    };
  });
