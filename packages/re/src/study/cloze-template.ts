import { nextClozeDeletionIndex } from "../core/index.js";

export const appendNextClozeTemplate = (content: string): string =>
  `${content}{{c${nextClozeDeletionIndex(content)}::}}`;
