import { FileSystem, Path } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Schema } from "@effect/schema";
import { Context, Effect, Layer } from "effect";

import bundledAiModelsJson from "../../../resources/ai-models.json";

import {
  AiModelCatalogReadFailed,
  AiModelCatalogSchemaV1,
  getAiModelCatalogValidationIssue,
  type AiModelCatalogDocument,
} from "@shared/ai-models";

export interface AiModelCatalogRepository {
  readonly getCatalog: () => Effect.Effect<AiModelCatalogDocument, AiModelCatalogReadFailed>;
}

export const AiModelCatalogRepository = Context.GenericTag<AiModelCatalogRepository>(
  "@re/desktop/main/AiModelCatalogRepository",
);

export interface MakeAiModelCatalogRepositoryOptions {
  readonly aiModelCatalogFilePath: string;
}

export const getBundledAiModelCatalogDocument = (): AiModelCatalogDocument => {
  const decoded = Schema.decodeUnknownSync(AiModelCatalogSchemaV1)(bundledAiModelsJson);
  const issue = getAiModelCatalogValidationIssue(decoded);

  if (issue !== null) {
    throw new Error(`Bundled AI model catalog is invalid: ${issue}`);
  }

  return decoded;
};

const bundledAiModelCatalogJson = JSON.stringify(bundledAiModelsJson, null, 2);

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toReadFailed = (path: string, message: string): AiModelCatalogReadFailed =>
  new AiModelCatalogReadFailed({
    path,
    message,
  });

const mapWritePlatformError = (
  aiModelCatalogFilePath: string,
  error: PlatformError,
): AiModelCatalogReadFailed =>
  toReadFailed(
    aiModelCatalogFilePath,
    `Unable to seed AI model catalog at startup: ${error.message}`,
  );

const validateCatalogDocument = (
  aiModelCatalogFilePath: string,
  document: AiModelCatalogDocument,
): Effect.Effect<AiModelCatalogDocument, AiModelCatalogReadFailed> => {
  const issue = getAiModelCatalogValidationIssue(document);

  if (issue !== null) {
    return Effect.fail(
      toReadFailed(aiModelCatalogFilePath, `AI model catalog failed validation: ${issue}`),
    );
  }

  return Effect.succeed(document);
};

export const makeAiModelCatalogRepository = ({
  aiModelCatalogFilePath,
}: MakeAiModelCatalogRepositoryOptions): Effect.Effect<
  AiModelCatalogRepository,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const aiModelCatalogDirectory = pathService.dirname(aiModelCatalogFilePath);
    const decodeCatalogJson = Schema.decodeUnknown(Schema.parseJson(AiModelCatalogSchemaV1));

    const seedBundledCatalog = (): Effect.Effect<void, AiModelCatalogReadFailed> =>
      Effect.gen(function* () {
        const tempFilePath = `${aiModelCatalogFilePath}.${Date.now()}.tmp`;

        const writeAndCommit = Effect.gen(function* () {
          yield* fileSystem
            .makeDirectory(aiModelCatalogDirectory, { recursive: true })
            .pipe(Effect.mapError((error) => mapWritePlatformError(aiModelCatalogFilePath, error)));

          yield* Effect.scoped(
            Effect.gen(function* () {
              const file = yield* fileSystem
                .open(tempFilePath, { flag: "w" })
                .pipe(
                  Effect.mapError((error) => mapWritePlatformError(aiModelCatalogFilePath, error)),
                );

              const content = new TextEncoder().encode(bundledAiModelCatalogJson);
              yield* file
                .writeAll(content)
                .pipe(
                  Effect.mapError((error) => mapWritePlatformError(aiModelCatalogFilePath, error)),
                );
              yield* file.sync.pipe(
                Effect.mapError((error) => mapWritePlatformError(aiModelCatalogFilePath, error)),
              );
            }),
          );

          yield* fileSystem
            .rename(tempFilePath, aiModelCatalogFilePath)
            .pipe(Effect.mapError((error) => mapWritePlatformError(aiModelCatalogFilePath, error)));
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

    const loadCatalogJson = (): Effect.Effect<string, AiModelCatalogReadFailed> =>
      fileSystem.readFileString(aiModelCatalogFilePath, "utf8").pipe(
        Effect.catchTag("SystemError", (error) =>
          error.reason === "NotFound"
            ? seedBundledCatalog().pipe(Effect.as(bundledAiModelCatalogJson))
            : Effect.fail(
                toReadFailed(
                  aiModelCatalogFilePath,
                  `Unable to read AI model catalog file: ${error.message}`,
                ),
              ),
        ),
        Effect.catchTag("BadArgument", (error) =>
          Effect.fail(
            toReadFailed(
              aiModelCatalogFilePath,
              `Invalid AI model catalog path or read arguments: ${error.message}`,
            ),
          ),
        ),
      );

    const decodeWithRecovery = (
      rawCatalog: string,
    ): Effect.Effect<AiModelCatalogDocument, AiModelCatalogReadFailed> =>
      decodeCatalogJson(rawCatalog).pipe(
        Effect.mapError((error) =>
          toReadFailed(
            aiModelCatalogFilePath,
            `AI model catalog failed schema validation: ${toMessage(error)}`,
          ),
        ),
        Effect.catchTag("AiModelCatalogReadFailed", (schemaError) =>
          // If the on-disk catalog has invalid JSON or fails schema decode,
          // re-seed from the bundled default and retry. Without this, a
          // corrupt file bricks the app permanently (file exists → seeding
          // is skipped → decode fails → startup crash on every launch).
          Effect.sync(() => {
            console.warn(
              `[ai-model-catalog] Catalog file is corrupt, re-seeding from bundled default: ${schemaError.message}`,
            );
          }).pipe(
            Effect.flatMap(() => seedBundledCatalog()),
            Effect.flatMap(() =>
              decodeCatalogJson(bundledAiModelCatalogJson).pipe(
                Effect.mapError((error) =>
                  toReadFailed(
                    aiModelCatalogFilePath,
                    `AI model catalog failed schema validation: ${toMessage(error)}`,
                  ),
                ),
              ),
            ),
            Effect.catchTag("AiModelCatalogReadFailed", () =>
              // If re-seeding also fails, report the original schema error.
              Effect.fail(schemaError),
            ),
          ),
        ),
        // Post-decode validation (missing default, duplicate keys, etc.)
        // is NOT recoverable by re-seeding — these are user-authored content
        // errors, not corruption. Let them fail through.
        Effect.flatMap((document) => validateCatalogDocument(aiModelCatalogFilePath, document)),
      );

    return {
      getCatalog: () =>
        loadCatalogJson().pipe(Effect.flatMap((rawCatalog) => decodeWithRecovery(rawCatalog))),
    };
  });

export const AiModelCatalogRepositoryLive = (options: MakeAiModelCatalogRepositoryOptions) =>
  Layer.effect(AiModelCatalogRepository, makeAiModelCatalogRepository(options));
