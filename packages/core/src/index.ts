export { parseFile } from "./parser/index.js";
export { serializeFile, serializeMetadata } from "./serializer/index.js";
export { generateId, createMetadata, createMetadataWithId, numericField } from "./create.js";
export {
  hasClozeDeletion,
  nextClozeDeletionIndex,
  parseClozeDeletions,
  parseClozeDeletionsStrict,
  replaceClozeDeletions,
  replaceClozeDeletionsWithContext,
  ClozeSyntaxReasonSchema,
  ClozeSyntaxIssue,
  ClozeSyntaxError,
} from "./cloze.js";
export type { ClozeSyntaxMatch, ClozeReplacerContext, ClozeSyntaxReason } from "./cloze.js";

export type { Item, ItemMetadata, ParsedFile, NumericField, ItemId } from "./types.js";
export { State } from "./types.js";

export type { MetadataParseError } from "./errors.js";
export {
  ParseError,
  InvalidMetadataFormat,
  InvalidFieldValue,
  MetadataParseErrorSchema,
} from "./errors.js";

export { ItemIdSchema, isItemId } from "./schema/index.js";
export { StateFromString, StateSchema } from "./schema/index.js";
export { NumericFieldFromString, NumericFieldSchema } from "./schema/index.js";
export { LearningStepsFromString } from "./schema/index.js";
export { LastReviewFromString } from "./schema/index.js";

export type {
  CardSpec,
  ItemType,
  Grade,
  ContentParseDiagnostic,
  EvaluableCardSpec,
  EvaluableItemType,
  InferredCards,
} from "./item-type.js";
export {
  GradeSchema,
  ContentParseError,
  NoMatchingTypeError,
  manualCardSpec,
  ResponseValidationError,
  adaptItemType,
  inferCards,
} from "./item-type.js";
