import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";
import {
  parseFile,
  serializeFile,
  type Item,
  type ItemMetadata,
  type EvaluableItemType,
  type ParsedFile,
} from "../core/index.js";
import { Context, Effect, Layer, Option, Semaphore } from "effect";

import { formatMetadataParseError } from "./snapshotWorkspace.js";

export class DeckNotFound extends Schema.TaggedError<DeckNotFound>("./index.js/DeckNotFound")(
  "DeckNotFound",
  {
    deckPath: Schema.String,
  },
) {
  override get message(): string {
    return `Deck not found: ${this.deckPath}`;
  }
}

export class DeckReadError extends Schema.TaggedError<DeckReadError>("./index.js/DeckReadError")(
  "DeckReadError",
  {
    deckPath: Schema.String,
    message: Schema.String,
  },
) {}

export class DeckParseError extends Schema.TaggedError<DeckParseError>("./index.js/DeckParseError")(
  "DeckParseError",
  {
    deckPath: Schema.String,
    message: Schema.String,
  },
) {}

export class DeckWriteError extends Schema.TaggedError<DeckWriteError>("./index.js/DeckWriteError")(
  "DeckWriteError",
  {
    deckPath: Schema.String,
    message: Schema.String,
  },
) {}

export class CardNotFound extends Schema.TaggedError<CardNotFound>("./index.js/CardNotFound")(
  "CardNotFound",
  {
    deckPath: Schema.String,
    cardId: Schema.String,
  },
) {
  override get message(): string {
    return `Card ${this.cardId} not found in deck: ${this.deckPath}`;
  }
}

export class ItemValidationError extends Schema.TaggedError<ItemValidationError>(
  "./index.js/ItemValidationError",
)("ItemValidationError", {
  deckPath: Schema.String,
  message: Schema.String,
}) {}

export const InvalidDeckPathReasonSchema = Schema.Literals([
  "empty_path",
  "absolute_path_required",
  "absolute_path_not_allowed",
  "path_traversal_not_allowed",
  "missing_md_extension",
  "invalid_file_name",
  "nul_byte_not_allowed",
]);

export class InvalidDeckPath extends Schema.TaggedError<InvalidDeckPath>(
  "./index.js/InvalidDeckPath",
)("InvalidDeckPath", {
  inputPath: Schema.String,
  reason: InvalidDeckPathReasonSchema,
}) {}

export class DeckAlreadyExists extends Schema.TaggedError<DeckAlreadyExists>(
  "./index.js/DeckAlreadyExists",
)("DeckAlreadyExists", {
  deckPath: Schema.String,
}) {}

export class DeckFileNotFound extends Schema.TaggedError<DeckFileNotFound>(
  "./index.js/DeckFileNotFound",
)("DeckFileNotFound", {
  deckPath: Schema.String,
}) {}

export class DeckFileOperationError extends Schema.TaggedError<DeckFileOperationError>(
  "./index.js/DeckFileOperationError",
)("DeckFileOperationError", {
  operation: Schema.Literals(["create", "delete", "rename"]),
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

export interface RemovedDeckItem {
  readonly itemIndex: number;
  readonly item: Item;
}

export interface DeckManager {
  readonly readDeck: (deckPath: string) => Effect.Effect<ParsedFile, ReadError>;

  /**
   * Read the current card and item, compute new metadata, and save under the deck
   * lock. Returns the callback's result only after the save succeeds. The callback
   * must not invoke another mutation on this deck; external side effects are not
   * rolled back if the save fails.
   */
  readonly modifyCardMetadata: <A, E>(
    deckPath: string,
    cardId: string,
    change: (current: {
      readonly item: Item;
      readonly card: ItemMetadata;
    }) => Effect.Effect<{ readonly metadata: ItemMetadata; readonly result: A }, E>,
  ) => Effect.Effect<A, WriteError | CardNotFound | E>;

  readonly updateCardMetadata: (
    deckPath: string,
    cardId: string,
    metadata: ItemMetadata,
  ) => Effect.Effect<void, WriteError | CardNotFound>;

  /**
   * Read, change, validate, and save one item under the deck lock. Returns the
   * saved item, including any newline needed to separate the following item.
   * The callback must not invoke another mutation on this deck. Its external
   * side effects are not rolled back if validation or saving subsequently fails.
   */
  readonly modifyItem: <E>(
    deckPath: string,
    cardId: string,
    change: (current: Item) => Effect.Effect<Item, E>,
    itemType: EvaluableItemType<unknown>,
  ) => Effect.Effect<Item, WriteError | CardNotFound | ItemValidationError | E>;

  readonly replaceItem: (
    deckPath: string,
    cardId: string,
    newItem: { readonly cards: readonly ItemMetadata[]; readonly content: string },
    itemType: EvaluableItemType<unknown>,
  ) => Effect.Effect<void, WriteError | CardNotFound | ItemValidationError>;

  readonly appendItem: (
    deckPath: string,
    item: { readonly cards: readonly ItemMetadata[]; readonly content: string },
    itemType: EvaluableItemType<unknown>,
  ) => Effect.Effect<void, WriteError | ItemValidationError>;

  readonly removeItem: (
    deckPath: string,
    cardId: string,
  ) => Effect.Effect<RemovedDeckItem, WriteError | CardNotFound>;

  readonly restoreItem: (
    deckPath: string,
    removed: RemovedDeckItem,
  ) => Effect.Effect<void, WriteError>;

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
  ) => Effect.Effect<
    void,
    InvalidDeckPath | DeckAlreadyExists | DeckFileNotFound | DeckFileOperationError
  >;
}

export const DeckManager = Context.Service<DeckManager>("./index.js/DeckManager");

export const DeckManagerLive: Layer.Layer<DeckManager, never, FileSystem.FileSystem | Path.Path> =
  Layer.effect(
    DeckManager,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const locksByPath = new Map<string, Semaphore.Semaphore>();

      const withDeckLocks = <A, E, R>(
        deckPaths: readonly string[],
        operation: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E, R> =>
        Effect.gen(function* () {
          // Rename must acquire both paths in the same order as other renames.
          const keys = [...new Set(deckPaths.map((deckPath) => path.resolve(deckPath)))].sort();
          // Get-or-create has no yield boundary, so callers always share the same lock.
          const locks = yield* Effect.sync(() =>
            keys.map((key) => {
              let lock = locksByPath.get(key);
              if (lock === undefined) {
                lock = Semaphore.makeUnsafe(1);
                locksByPath.set(key, lock);
              }
              return lock;
            }),
          );
          return yield* locks.reduceRight((effect, lock) => lock.withPermits(1)(effect), operation);
        });

      const readAndParse = (deckPath: string): Effect.Effect<ParsedFile, ReadError> =>
        fs.readFileString(deckPath).pipe(
          Effect.catchReasons(
            "PlatformError",
            { NotFound: () => Effect.fail(new DeckNotFound({ deckPath })) },
            (_, error) => Effect.fail(new DeckReadError({ deckPath, message: error.message })),
          ),
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
      ): Effect.Effect<void, DeckWriteError> =>
        Effect.scoped(
          Effect.gen(function* () {
            const tmpPath = yield* fs.makeTempFileScoped({
              directory: path.dirname(deckPath),
              prefix: ".re-write-",
              suffix: ".tmp",
            });
            yield* fs.writeFileString(tmpPath, content);
            // A rename cannot be cancelled once the OS starts it. Keep the lock
            // until it finishes, before cleaning up the temporary file.
            yield* fs.rename(tmpPath, deckPath).pipe(Effect.uninterruptible);
          }),
        ).pipe(
          Effect.mapError((error) => new DeckWriteError({ deckPath, message: String(error) })),
        );

      const modifyDeck = <A, E, R>(
        deckPath: string,
        change: (
          current: ParsedFile,
        ) => Effect.Effect<{ readonly file: ParsedFile; readonly result: A }, E, R>,
      ): Effect.Effect<A, WriteError | E, R> =>
        Effect.suspend(() => {
          const filePath = path.resolve(deckPath);
          return withDeckLocks(
            [filePath],
            readAndParse(filePath).pipe(
              Effect.flatMap(change),
              Effect.tap(({ file }) => atomicWrite(filePath, serializeFile(file))),
              Effect.map(({ result }) => result),
            ),
          );
        });

      const validateItem = (
        item: { readonly cards: readonly ItemMetadata[]; readonly content: string },
        itemType: EvaluableItemType<unknown>,
        deckPath: string,
      ): Effect.Effect<void, ItemValidationError> =>
        itemType.parseCards(item.content).pipe(
          Effect.mapError(
            (error) =>
              new ItemValidationError({
                deckPath,
                message: `Content parse failed for type "${itemType.name}": ${error.message}`,
              }),
          ),
          Effect.flatMap((cards) => {
            const keys = new Set<string>();
            for (const card of cards) {
              if (keys.has(card.key)) {
                return Effect.fail(
                  new ItemValidationError({
                    deckPath,
                    message: `Duplicate generated card key: ${card.key}`,
                  }),
                );
              }
              keys.add(card.key);
            }
            const expectedCards = cards.length;
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

      const validateDeckPath = (inputPath: string): Effect.Effect<string, InvalidDeckPath> =>
        Effect.gen(function* () {
          const normalizedPath = inputPath.trim();
          if (normalizedPath.length === 0) {
            return yield* new InvalidDeckPath({ inputPath, reason: "empty_path" });
          }

          if (normalizedPath.includes("\0")) {
            return yield* new InvalidDeckPath({
              inputPath,
              reason: "nul_byte_not_allowed",
            });
          }

          if (!path.isAbsolute(normalizedPath)) {
            return yield* new InvalidDeckPath({
              inputPath,
              reason: "absolute_path_required",
            });
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
          Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(Option.none())),
          Effect.mapError((error) => operationError(operation, error, fields)),
        );

      const ensureParentDirectory = (
        deckPath: string,
        operation: "create" | "rename",
        createParents?: boolean,
      ): Effect.Effect<void, DeckFileOperationError> => {
        const parentPath = path.dirname(deckPath);
        if (createParents === true) {
          return fs.makeDirectory(parentPath, { recursive: true }).pipe(
            Effect.mapError((error: PlatformError) =>
              operationError(operation, error, {
                deckPath,
              }),
            ),
          );
        }

        return fs.stat(parentPath).pipe(
          Effect.mapError((error: PlatformError) =>
            operationError(operation, error, {
              deckPath,
            }),
          ),
          Effect.flatMap((info) =>
            info.type === "Directory"
              ? Effect.void
              : Effect.fail(
                  operationError(operation, `Parent path is not a directory: ${parentPath}`, {
                    deckPath,
                  }),
                ),
          ),
        );
      };

      const modifyItem: DeckManager["modifyItem"] = (deckPath, cardId, change, itemType) =>
        modifyDeck(deckPath, (parsed) =>
          Effect.gen(function* () {
            const { itemIndex } = yield* findItemByCardId(parsed, cardId, deckPath);
            const changed = yield* change(parsed.items[itemIndex]!);
            const item =
              itemIndex === parsed.items.length - 1 || changed.content.endsWith("\n")
                ? changed
                : { ...changed, content: changed.content + "\n" };
            yield* validateItem(item, itemType, deckPath);
            const items = parsed.items.map((current, index) =>
              index === itemIndex ? item : current,
            );
            return { file: { ...parsed, items }, result: item };
          }),
        );

      const modifyCardMetadata: DeckManager["modifyCardMetadata"] = (deckPath, cardId, change) =>
        modifyDeck(deckPath, (parsed) =>
          Effect.gen(function* () {
            const { itemIndex, cardIndex } = yield* findItemByCardId(parsed, cardId, deckPath);
            const currentItem = parsed.items[itemIndex]!;
            const { metadata, result } = yield* change({
              item: currentItem,
              card: currentItem.cards[cardIndex]!,
            });

            const items = parsed.items.map((item, idx) => {
              if (idx !== itemIndex) return item;
              const cards = item.cards.map((card, cIdx) => (cIdx === cardIndex ? metadata : card));
              return { ...item, cards };
            });

            return { file: { ...parsed, items }, result };
          }),
        );

      return DeckManager.of({
        readDeck: readAndParse,
        modifyItem,
        modifyCardMetadata,

        updateCardMetadata: (deckPath, cardId, metadata) =>
          modifyCardMetadata(deckPath, cardId, () =>
            Effect.succeed({ metadata, result: undefined }),
          ),

        replaceItem: (deckPath, cardId, newItem, itemType) =>
          modifyItem(deckPath, cardId, () => Effect.succeed(newItem), itemType).pipe(Effect.asVoid),

        appendItem: (deckPath, item, itemType) =>
          modifyDeck(deckPath, (parsed) =>
            Effect.gen(function* () {
              yield* validateItem(item, itemType, deckPath);

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

              return { file: { preamble, items: [...items, item] }, result: undefined };
            }),
          ),

        removeItem: (deckPath, cardId) =>
          modifyDeck(deckPath, (parsed) =>
            Effect.gen(function* () {
              const { itemIndex } = yield* findItemByCardId(parsed, cardId, deckPath);
              const item = parsed.items[itemIndex]!;

              return {
                file: {
                  ...parsed,
                  items: parsed.items.filter((_, idx) => idx !== itemIndex),
                },
                result: { itemIndex, item } satisfies RemovedDeckItem,
              };
            }),
          ),

        restoreItem: (deckPath, removed) =>
          modifyDeck(deckPath, (parsed) =>
            Effect.sync(() => {
              const items = [...parsed.items];
              items.splice(removed.itemIndex, 0, removed.item);
              return { file: { ...parsed, items }, result: undefined };
            }),
          ),

        createDeck: (deckPath, options) =>
          Effect.gen(function* () {
            const resolvedPath = yield* validateDeckPath(deckPath);
            return yield* withDeckLocks(
              [resolvedPath],
              Effect.gen(function* () {
                yield* ensureParentDirectory(resolvedPath, "create", options?.createParents);

                const exists = yield* statMaybe(resolvedPath, "create", { deckPath: resolvedPath });

                if (Option.isSome(exists)) {
                  return yield* new DeckAlreadyExists({ deckPath: resolvedPath });
                }

                yield* fs
                  .writeFileString(resolvedPath, options?.initialContent ?? "", {
                    flag: "wx",
                  })
                  .pipe(
                    Effect.uninterruptible,
                    Effect.catchReasons(
                      "PlatformError",
                      {
                        AlreadyExists: () =>
                          Effect.fail(new DeckAlreadyExists({ deckPath: resolvedPath })),
                      },
                      (_, error) =>
                        Effect.fail(
                          operationError("create", error, {
                            deckPath: resolvedPath,
                          }),
                        ),
                    ),
                  );
              }),
            );
          }),

        deleteDeck: (deckPath) =>
          Effect.gen(function* () {
            const resolvedPath = yield* validateDeckPath(deckPath);

            return yield* withDeckLocks(
              [resolvedPath],
              Effect.gen(function* () {
                const info = yield* fs.stat(resolvedPath).pipe(
                  Effect.catchReasons(
                    "PlatformError",
                    {
                      NotFound: () => Effect.fail(new DeckFileNotFound({ deckPath: resolvedPath })),
                    },
                    (_, error) =>
                      Effect.fail(
                        operationError("delete", error, {
                          deckPath: resolvedPath,
                        }),
                      ),
                  ),
                );

                if (info.type !== "File") {
                  return yield* operationError("delete", `Path is not a file: ${resolvedPath}`, {
                    deckPath: resolvedPath,
                  });
                }

                yield* fs.remove(resolvedPath, { force: false, recursive: false }).pipe(
                  Effect.uninterruptible,
                  Effect.catchReasons(
                    "PlatformError",
                    {
                      NotFound: () => Effect.fail(new DeckFileNotFound({ deckPath: resolvedPath })),
                    },
                    (_, error) =>
                      Effect.fail(
                        operationError("delete", error, {
                          deckPath: resolvedPath,
                        }),
                      ),
                  ),
                );
              }),
            );
          }),

        renameDeck: (fromDeckPath, toDeckPath, options) =>
          Effect.gen(function* () {
            const fromResolvedPath = yield* validateDeckPath(fromDeckPath);
            const toResolvedPath = yield* validateDeckPath(toDeckPath);

            return yield* withDeckLocks(
              [fromResolvedPath, toResolvedPath],
              Effect.gen(function* () {
                const fromInfo = yield* fs.stat(fromResolvedPath).pipe(
                  Effect.catchReasons(
                    "PlatformError",
                    {
                      NotFound: () =>
                        Effect.fail(new DeckFileNotFound({ deckPath: fromResolvedPath })),
                    },
                    (_, error) =>
                      Effect.fail(
                        operationError("rename", error, {
                          fromPath: fromResolvedPath,
                          toPath: toResolvedPath,
                        }),
                      ),
                  ),
                );

                if (fromInfo.type !== "File") {
                  return yield* operationError(
                    "rename",
                    `Source path is not a file: ${fromResolvedPath}`,
                    {
                      fromPath: fromResolvedPath,
                      toPath: toResolvedPath,
                    },
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
                  return yield* new DeckAlreadyExists({ deckPath: toResolvedPath });
                }

                // NOTE: On POSIX, rename(2) can overwrite destination atomically.
                // This pre-check + lock strategy prevents in-process races only.
                yield* fs.rename(fromResolvedPath, toResolvedPath).pipe(
                  Effect.uninterruptible,
                  Effect.catchReasons(
                    "PlatformError",
                    {
                      AlreadyExists: () =>
                        Effect.fail(new DeckAlreadyExists({ deckPath: toResolvedPath })),
                      NotFound: (_, error) =>
                        Effect.gen(function* () {
                          const sourceExists = yield* fs.stat(fromResolvedPath).pipe(
                            Effect.as(true),
                            Effect.catchReason("PlatformError", "NotFound", () =>
                              Effect.succeed(false),
                            ),
                            Effect.mapError((sourceError) =>
                              operationError("rename", sourceError, {
                                fromPath: fromResolvedPath,
                                toPath: toResolvedPath,
                              }),
                            ),
                          );
                          if (!sourceExists) {
                            return yield* new DeckFileNotFound({ deckPath: fromResolvedPath });
                          }
                          return yield* operationError("rename", error, {
                            fromPath: fromResolvedPath,
                            toPath: toResolvedPath,
                          });
                        }),
                    },
                    (_, error) =>
                      Effect.fail(
                        operationError("rename", error, {
                          fromPath: fromResolvedPath,
                          toPath: toResolvedPath,
                        }),
                      ),
                  ),
                );
              }),
            );
          }),
      });
    }),
  );
