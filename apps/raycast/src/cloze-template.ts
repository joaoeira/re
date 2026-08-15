import { nextClozeDeletionIndex } from "@re/core";

export const appendNextClozeTemplate = (content: string): string =>
  `${content}{{c${nextClozeDeletionIndex(content)}::}}`;
