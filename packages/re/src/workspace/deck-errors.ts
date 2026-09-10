import { Match } from "effect";
import type { CardNotFound, ItemValidationError, ReadError, WriteError } from "./DeckManager.js";

/** Shared UI wording. Underlying diagnostic messages may themselves contain paths. */
export const toReadErrorMessage = (error: ReadError): string =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      DeckNotFound: () => "The deck no longer exists.",
      DeckReadError: (error) => `Could not read the deck: ${error.message}`,
      DeckParseError: (error) => `The deck metadata is invalid: ${error.message}`,
    }),
  );

export const toWriteErrorMessage = (
  error: WriteError | CardNotFound | ItemValidationError,
): string =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      DeckNotFound: toReadErrorMessage,
      DeckReadError: toReadErrorMessage,
      DeckParseError: toReadErrorMessage,
      DeckWriteError: (error) => `Could not save the deck: ${error.message}`,
      CardNotFound: () => "The card no longer exists in its deck.",
      ItemValidationError: (error) => error.message,
    }),
  );
