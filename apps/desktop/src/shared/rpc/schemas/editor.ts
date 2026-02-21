import { Schema } from "@effect/schema";

export class EditorOperationError extends Schema.TaggedError<EditorOperationError>(
  "@re/desktop/rpc/EditorOperationError",
)("editor_operation_error", {
  message: Schema.String,
}) {}
