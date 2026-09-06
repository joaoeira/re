import { nextClozeDeletionIndex } from "@simbyotic/re/core";

export const appendNextClozeTemplate = (content: string): string =>
  `${content}{{c${nextClozeDeletionIndex(content)}::}}`;
