import { FileSystem, Path } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Schema } from "@effect/schema";
import {
  parseFile,
  serializeFile,
  type ItemMetadata,
  type UntypedItemType,
  type ParsedFile,
} from "@re/core";
import { Context, Effect, Layer, Option } from "effect";

import { formatMetadataParseError } from "./snapshotWorkspace";

export class DeckNotFound extends Schema.TaggedError<DeckNotFound>("@re/workspace/DeckNotFound")(
  "DeckNotFound",
  {
    deckPath: Schema.String,
  },
) {}

export class DeckReadError extends Schema.TaggedError<DeckReadError>("@re/workspace/DeckReadError")(
  "DeckReadError",
  {
    deckPath: Schema.String,
    message: Schema.String,
  },
) {}

export class DeckParseError extends Schema.TaggedError<DeckParseError>(
  "@re/workspace/DeckParseError",
)("DeckParseError", {
  deckPath: Schema.String,
  message: Schema.String,
}) {}

export class DeckWriteError extends Schema.TaggedError<DeckWriteError>(
  "@re/workspace/DeckWriteError",
)("DeckWriteError", {
  deckPath: Schema.String,
  message: Schema.String,
}) {}

export class CardNotFound extends Schema.TaggedError<CardNotFound>("@re/workspace/CardNotFound")(
  "CardNotFound",
  {
    deckPath: Schema.String,
    cardId: Schema.String,
  },
) {}

export class ItemValidationError extends Schema.TaggedError<ItemValidationError>(
  "@re/workspace/ItemValidationError",
)("ItemValidationError", {
  deckPath: Schema.String,
  message: Schema.String,
}) {}

export const InvalidDeckPathReasonSchema = Schema.Literal(
  "empty_path",
  "absolute_path_required",
  "absolute_path_not_allowed",
  "path_traversal_not_allowed",
  "missing_md_extension",
  "invalid_file_name",
  "nul_byte_not_allowed",
);

export class InvalidDeckPath extends Schema.TaggedError<InvalidDeckPath>(
  "@re/workspace/InvalidDeckPath",
)("InvalidDeckPath", {
  inputPath: Schema.String,
  reason: InvalidDeckPathReasonSchema,
}) {}

export class DeckAlreadyExists extends Schema.TaggedError<DeckAlreadyExists>(
  "@re/workspace/DeckAlreadyExists",
)("DeckAlreadyExists", {
  deckPath: Schema.String,
}) {}

export class DeckFileNotFound extends Schema.TaggedError<DeckFileNotFound>(
  "@re/workspace/DeckFileNotFound",
)("DeckFileNotFound", {
  deckPath: Schema.String,
}) {}

export class DeckFileOperationError extends Schema.TaggedError<DeckFileOperationError>(
  "@re/workspace/DeckFileOperationError",
)("DeckFileOperationError", {
  operation: Schema.Literal("create", "delete", "rename"),
  message: Schema.String,
  deckPath: Schema.optional(Schema.String),
  fromPath: Schema.optional(Schema.String),
  toPath: Schema.optional(Schema.String),
}) {}

export type ReadError = DeckNotFound | DeckReadError | DeckParseError;
export type WriteError = ReadError | DeckWriteError;
export type DeckLifecycleError =
  | InvalidDeckPath
  | DeckAlreadyExists
  | DeckFileNotFound
  | DeckFileOperationError;

export interface DeckManager {
  readonly readDeck: (deckPath: string) => Effect.Effect<ParsedFile, ReadError>;

  readonly updateCardMetadata: (
    deckPath: string,
    cardId: string,
    metadata: ItemMetadata,
  ) => Effect.Effect<void, WriteError | CardNotFound>;

  readonly replaceItem: (
    deckPath: string,
    cardId: string,
    newItem: { readonly cards: readonly ItemMetadata[]; readonly content: string },
    itemType: UntypedItemType,
  ) => Effect.Effect<void, WriteError | CardNotFound | ItemValidationError>;

  readonly appendItem: (
    deckPath: string,
    item: { readonly cards: readonly ItemMetadata[]; readonly content: string },
    itemType: UntypedItemType,
  ) => Effect.Effect<void, WriteError | ItemValidationError>;

  readonly removeItem: (
    deckPath: string,
    cardId: string,
  ) => Effect.Effect<void, WriteError | CardNotFound>;

  readonly createDeck: (
    deckPath: string,
    options?: {
      readonly createParents?: boolean;
      readonly initialContent?: string;
    },
  ) => Effect.Effect<void, InvalidDeckPath | DeckAlreadyExists | DeckFileOperationError>;

  readonly deleteDeck: (
    deckPath: string,
  ) => Effect.Effect<void, InvalidDeckPath | DeckFileNotFound | DeckFileOperationError>;

  readonly renameDeck: (
    fromDeckPath: string,
    toDeckPath: string,
    options?: {
      readonly createParents?: boolean;
    },
  ) => Effect.Effect<void, InvalidDeckPath | DeckAlreadyExists | DeckFileNotFound | DeckFileOperationError>;
}

export const DeckManager = Context.GenericTag<DeckManager>("@re/workspace/DeckManager");

export const DeckManagerLive: Layer.Layer<DeckManager, never, FileSystem.FileSystem | Path.Path> =
  Layer.effect(
    DeckManager,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const readAndParse = (deckPath: string): Effect.Effect<ParsedFile, ReadError> =>
        fs.readFileString(deckPath).pipe(
          Effect.mapError((error): ReadError => {
            if (error._tag === "SystemError" && error.reason === "NotFound") {
              return new DeckNotFound({ deckPath });
            }
            return new DeckReadError({ deckPath, message: error.message });
          }),
          Effect.flatMap((content) =>
            parseFile(content).pipe(
              Effect.mapError(
                (error) =>
                  new DeckParseError({ deckPath, message: formatMetadataParseError(error) }),
              ),
            ),
          ),
        );

      const findItemByCardId = (
        parsed: ParsedFile,
        cardId: string,
        deckPath: string,
      ): Effect.Effect<{ itemIndex: number; cardIndex: number }, CardNotFound> => {
        for (let i = 0; i < parsed.items.length; i++) {
          const item = parsed.items[i]!;
          for (let c = 0; c < item.cards.length; c++) {
            if (item.cards[c]!.id === cardId) {
              return Effect.succeed({ itemIndex: i, cardIndex: c });
            }
          }
        }
        return Effect.fail(new CardNotFound({ deckPath, cardId }));
      };

      const atomicWrite = (
        deckPath: string,
        content: string,
      ): Effect.Effect<void, DeckWriteError> => {
        const tmpPath = `${deckPath}.tmp`;
        return fs.writeFileString(tmpPath, content).pipe(
          Effect.flatMap(() => fs.rename(tmpPath, deckPath)),
          Effect.catchAll((error) =>
            fs.remove(tmpPath).pipe(
              Effect.ignore,
              Effect.flatMap(() =>
                Effect.fail(new DeckWriteError({ deckPath, message: String(error) })),
              ),
            ),
          ),
        );
      };

      const validateItemCardCount = (
        item: { readonly cards: readonly ItemMetadata[]; readonly content: string },
        itemType: UntypedItemType,
        deckPath: string,
      ): Effect.Effect<void, ItemValidationError> =>
        itemType.parse(item.content).pipe(
          Effect.mapError(
            (error) =>
              new ItemValidationError({
                deckPath,
                message: `Content parse failed for type "${itemType.name}": ${error.message}`,
              }),
          ),
          Effect.flatMap((parsed) => {
            const expectedCards = itemType.cards(parsed).length;
            if (expectedCards !== item.cards.length) {
              return Effect.fail(
                new ItemValidationError({
                  deckPath,
                  message: `Card count mismatch: content produces ${expectedCards} card(s) but item has ${item.cards.length}`,
                }),
              );
            }
            return Effect.void;
          }),
        );

      const validateDeckPath = (
        inputPath: string,
      ): Effect.Effect<string, InvalidDeckPath> =>
        Effect.gen(function* () {
          const normalizedPath = inputPath.trim();
          if (normalizedPath.length === 0) {
            return yield* Effect.fail(
              new InvalidDeckPath({ inputPath, reason: "empty_path" }),
            );
          }

          if (normalizedPath.includes("\0")) {
            return yield* Effect.fail(
              new InvalidDeckPath({
                inputPath,
                reason: "nul_byte_not_allowed",
              }),
            );
          }

          if (!path.isAbsolute(normalizedPath)) {
            return yield* Effect.fail(
              new InvalidDeckPath({
                inputPath,
                reason: "absolute_path_required",
              }),
            );
          }

          return path.normalize(normalizedPath);
        });

      const toErrorMessage = (error: unknown): string =>
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof (error as { readonly message?: unknown }).message === "string"
          ? (error as { readonly message: string }).message
          : String(error);

      const operationError = (
        operation: "create" | "delete" | "rename",
        error: PlatformError | string,
        fields?: {
          readonly deckPath?: string;
          readonly fromPath?: string;
          readonly toPath?: string;
        },
      ): DeckFileOperationError => {
        const payload: {
          readonly operation: "create" | "delete" | "rename";
          readonly message: string;
          deckPath?: string;
          fromPath?: string;
          toPath?: string;
        } = {
          operation,
          message: toErrorMessage(error),
        };

        if (fields?.deckPath !== undefined) {
          payload.deckPath = fields.deckPath;
        }

        if (fields?.fromPath !== undefined) {
          payload.fromPath = fields.fromPath;
        }

        if (fields?.toPath !== undefined) {
          payload.toPath = fields.toPath;
        }

        return new DeckFileOperationError(payload);
      };

      const statMaybe = (
        targetPath: string,
        operation: "create" | "delete" | "rename",
        fields?: {
          readonly deckPath?: string;
          readonly fromPath?: string;
          readonly toPath?: string;
        },
      ): Effect.Effect<Option.Option<FileSystem.File.Info>, DeckFileOperationError> =>
        fs.stat(targetPath).pipe(
          Effect.map(Option.some),
          Effect.catchAll((error: PlatformError) =>
            error._tag === "SystemError" && error.reason === "NotFound"
              ? Effect.succeed(Option.none())
              : Effect.fail(operationError(operation, error, fields)),
          ),
        );

      const ensureParentDirectory = (
        deckPath: string,
        operation: "create" | "rename",
        createParents?: boolean,
      ): Effect.Effect<void, DeckFileOperationError> => {
        const parentPath = path.dirname(deckPath);
        if (createParents === true) {
          return fs.makeDirectory(parentPath, { recursive: true }).pipe(
            Effect.catchAll((error: PlatformError) =>
              Effect.fail(
                operationError(operation, error, {
                  deckPath,
                }),
              ),
            ),
          );
        }

        return fs.stat(parentPath).pipe(
          Effect.catchAll((error: PlatformError) =>
            Effect.fail(
              operationError(operation, error, {
                deckPath,
              }),
            ),
          ),
          Effect.flatMap((info) =>
            info.type === "Directory"
              ? Effect.void
              : Effect.fail(
                  operationError(
                    operation,
                    `Parent path is not a directory: ${parentPath}`,
                    {
                      deckPath,
                    },
                  ),
                ),
          ),
        );
      };

      return DeckManager.of({
        readDeck: readAndParse,

        updateCardMetadata: (deckPath, cardId, metadata) =>
          Effect.gen(function* () {
            const parsed = yield* readAndParse(deckPath);
            const { itemIndex, cardIndex } = yield* findItemByCardId(parsed, cardId, deckPath);

            const updatedItems = parsed.items.map((item, idx) => {
              if (idx !== itemIndex) return item;
              const updatedCards = item.cards.map((card, cIdx) =>
                cIdx === cardIndex ? metadata : card,
              );
              return { ...item, cards: updatedCards };
            });

            const serialized = serializeFile({ ...parsed, items: updatedItems });
            yield* atomicWrite(deckPath, serialized);
          }),

        replaceItem: (deckPath, cardId, newItem, itemType) =>
          Effect.gen(function* () {
            const parsed = yield* readAndParse(deckPath);
            const { itemIndex } = yield* findItemByCardId(parsed, cardId, deckPath);
            yield* validateItemCardCount(newItem, itemType, deckPath);

            const updatedItems = parsed.items.map((item, idx) =>
              idx === itemIndex ? newItem : item,
            );

            const serialized = serializeFile({ ...parsed, items: updatedItems });
            yield* atomicWrite(deckPath, serialized);
          }),

        appendItem: (deckPath, item, itemType) =>
          Effect.gen(function* () {
            const parsed = yield* readAndParse(deckPath);
            yield* validateItemCardCount(item, itemType, deckPath);

            let { preamble, items } = parsed;

            if (items.length > 0) {
              const lastItem = items[items.length - 1]!;
              if (lastItem.content.length > 0 && !lastItem.content.endsWith("\n\n")) {
                const fixedItems = [...items];
                const trimmed = lastItem.content.replace(/\n*$/, "");
                fixedItems[fixedItems.length - 1] = {
                  ...lastItem,
                  content: trimmed + "\n\n",
                };
                items = fixedItems;
              }
            } else if (preamble.length > 0 && !preamble.endsWith("\n\n")) {
              preamble = preamble.replace(/\n*$/, "") + "\n\n";
            }

            const updatedItems = [...items, item];
            const serialized = serializeFile({ preamble, items: updatedItems });
            yield* atomicWrite(deckPath, serialized);
          }),

        removeItem: (deckPath, cardId) =>
          Effect.gen(function* () {
            const parsed = yield* readAndParse(deckPath);
            const { itemIndex } = yield* findItemByCardId(parsed, cardId, deckPath);

            const updatedItems = parsed.items.filter((_, idx) => idx !== itemIndex);
            const serialized = serializeFile({ ...parsed, items: updatedItems });
            yield* atomicWrite(deckPath, serialized);
          }),

        createDeck: (deckPath, options) =>
          Effect.gen(function* () {
            const resolvedPath = yield* validateDeckPath(deckPath);
            yield* ensureParentDirectory(resolvedPath, "create", options?.createParents);

            const exists = yield* statMaybe(resolvedPath, "create", { deckPath: resolvedPath });

            if (Option.isSome(exists)) {
              return yield* Effect.fail(new DeckAlreadyExists({ deckPath: resolvedPath }));
            }

            yield* fs
              .writeFileString(resolvedPath, options?.initialContent ?? "", {
                flag: "wx",
              })
              .pipe(
                Effect.catchAll(
                  (
                    error: PlatformError,
                  ): Effect.Effect<never, DeckAlreadyExists | DeckFileOperationError> => {
                  if (error._tag === "SystemError" && error.reason === "AlreadyExists") {
                    return Effect.fail(new DeckAlreadyExists({ deckPath: resolvedPath }));
                  }

                  return Effect.fail(
                    operationError("create", error, {
                      deckPath: resolvedPath,
                    }),
                  );
                  },
                ),
              );
          }),

        deleteDeck: (deckPath) =>
          Effect.gen(function* () {
            const resolvedPath = yield* validateDeckPath(deckPath);

            const info = yield* fs.stat(resolvedPath).pipe(
              Effect.catchAll(
                (
                  error: PlatformError,
                ): Effect.Effect<never, DeckFileNotFound | DeckFileOperationError> => {
                if (error._tag === "SystemError" && error.reason === "NotFound") {
                  return Effect.fail(new DeckFileNotFound({ deckPath: resolvedPath }));
                }

                return Effect.fail(
                  operationError("delete", error, {
                    deckPath: resolvedPath,
                  }),
                );
                },
              ),
            );

            if (info.type !== "File") {
              return yield* Effect.fail(
                operationError("delete", `Path is not a file: ${resolvedPath}`, {
                  deckPath: resolvedPath,
                }),
              );
            }

            yield* fs.remove(resolvedPath, { force: false, recursive: false }).pipe(
              Effect.catchAll(
                (
                  error: PlatformError,
                ): Effect.Effect<never, DeckFileNotFound | DeckFileOperationError> => {
                if (error._tag === "SystemError" && error.reason === "NotFound") {
                  return Effect.fail(new DeckFileNotFound({ deckPath: resolvedPath }));
                }

                return Effect.fail(
                  operationError("delete", error, {
                    deckPath: resolvedPath,
                  }),
                );
                },
              ),
            );
          }),

        renameDeck: (fromDeckPath, toDeckPath, options) =>
          Effect.gen(function* () {
            const fromResolvedPath = yield* validateDeckPath(fromDeckPath);
            const toResolvedPath = yield* validateDeckPath(toDeckPath);

            const fromInfo = yield* fs.stat(fromResolvedPath).pipe(
              Effect.catchAll(
                (
                  error: PlatformError,
                ): Effect.Effect<never, DeckFileNotFound | DeckFileOperationError> => {
                if (error._tag === "SystemError" && error.reason === "NotFound") {
                  return Effect.fail(new DeckFileNotFound({ deckPath: fromResolvedPath }));
                }

                return Effect.fail(
                  operationError("rename", error, {
                    fromPath: fromResolvedPath,
                    toPath: toResolvedPath,
                  }),
                );
                },
              ),
            );

            if (fromInfo.type !== "File") {
              return yield* Effect.fail(
                operationError("rename", `Source path is not a file: ${fromResolvedPath}`, {
                  fromPath: fromResolvedPath,
                  toPath: toResolvedPath,
                }),
              );
            }

            if (fromResolvedPath === toResolvedPath) {
              return;
            }

            yield* ensureParentDirectory(toResolvedPath, "rename", options?.createParents);

            const destinationInfo = yield* statMaybe(toResolvedPath, "rename", {
              fromPath: fromResolvedPath,
              toPath: toResolvedPath,
            });

            if (Option.isSome(destinationInfo)) {
              return yield* Effect.fail(new DeckAlreadyExists({ deckPath: toResolvedPath }));
            }

            // NOTE: On POSIX, rename(2) can overwrite destination atomically.
            // This pre-check + lock strategy prevents in-process races only.
            yield* fs.rename(fromResolvedPath, toResolvedPath).pipe(
              Effect.catchAll(
                (
                  error: PlatformError,
                ): Effect.Effect<
                  never,
                  DeckAlreadyExists | DeckFileNotFound | DeckFileOperationError
                > =>
                Effect.gen(function* () {
                  if (error._tag === "SystemError" && error.reason === "AlreadyExists") {
                    return yield* Effect.fail(new DeckAlreadyExists({ deckPath: toResolvedPath }));
                  }

                  if (error._tag === "SystemError" && error.reason === "NotFound") {
                    const sourceExists = yield* fs.stat(fromResolvedPath).pipe(
                      Effect.as(true),
                      Effect.catchAll(
                        (sourceError: PlatformError): Effect.Effect<boolean, DeckFileOperationError> => {
                        if (sourceError._tag === "SystemError" && sourceError.reason === "NotFound") {
                          return Effect.succeed(false);
                        }

                        return Effect.fail(
                          operationError("rename", sourceError, {
                            fromPath: fromResolvedPath,
                            toPath: toResolvedPath,
                          }),
                        );
                        },
                      ),
                    );
                    if (!sourceExists) {
                      return yield* Effect.fail(
                        new DeckFileNotFound({ deckPath: fromResolvedPath }),
                      );
                    }
                  }

                  return yield* Effect.fail(
                    operationError("rename", error, {
                      fromPath: fromResolvedPath,
                      toPath: toResolvedPath,
                    }),
                  );
                }),
              ),
            );
          }),
      });
    }),
  );
