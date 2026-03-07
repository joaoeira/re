import { Schema } from "@effect/schema";

export class EditorOperationError extends Schema.TaggedError<EditorOperationError>(
  "@re/desktop/rpc/EditorOperationError",
)("editor_operation_error", {
  message: Schema.String,
}) {}

export const ImageExtensionSchema = Schema.Literal(".png", ".jpg", ".jpeg", ".webp", ".gif");

export type ImageExtension = typeof ImageExtensionSchema.Type;

export const ImportDeckImageAssetInputSchema = Schema.Struct({
  deckPath: Schema.String,
  extension: ImageExtensionSchema,
  bytes: Schema.Uint8ArrayFromSelf,
});

export type ImportDeckImageAssetInput = typeof ImportDeckImageAssetInputSchema.Type;

export const ImportedDeckImageAssetResultSchema = Schema.Struct({
  contentHash: Schema.String,
  extension: Schema.String,
  workspaceRelativePath: Schema.String,
  deckRelativePath: Schema.String,
});

export type ImportedDeckImageAssetResult = typeof ImportedDeckImageAssetResultSchema.Type;
