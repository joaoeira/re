import type { CardNotFound, ItemValidationError, ReadError, WriteError } from "./DeckManager.js";

/** Shared UI wording. Underlying diagnostic messages may themselves contain paths. */
export const toReadErrorMessage = (error: ReadError): string => {
  switch (error._tag) {
    case "DeckNotFound":
      return "The deck no longer exists.";
    case "DeckReadError":
      return `Could not read the deck: ${error.message}`;
    case "DeckParseError":
      return `The deck metadata is invalid: ${error.message}`;
  }
};

export const toWriteErrorMessage = (
  error: WriteError | CardNotFound | ItemValidationError,
): string => {
  switch (error._tag) {
    case "DeckNotFound":
    case "DeckReadError":
    case "DeckParseError":
      return toReadErrorMessage(error);
    case "DeckWriteError":
      return `Could not save the deck: ${error.message}`;
    case "CardNotFound":
      return "The card no longer exists in its deck.";
    case "ItemValidationError":
      return error.message;
  }
};
