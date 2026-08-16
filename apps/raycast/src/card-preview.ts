import { Path } from "@effect/platform";
import { ContentParseError } from "@re/core";
import { Effect } from "effect";

import {
  CardFieldError,
  formatContentParseError,
  prepareCard,
  type CardField,
  type CreateCardInput,
} from "./card-creation";
import { prepareMarkdownForRaycast, RaycastMarkdownTransformError } from "./raycast-markdown";

export interface CardPreviewInput extends CreateCardInput {
  readonly workspacePath: string;
}

export interface PreviewCard {
  readonly prompt: string;
  readonly reveal: string;
}

export const renderCardPreviewMarkdown = (card: PreviewCard): string =>
  `${card.prompt}\n\n---\n\n${card.reveal}`;

export type CardPreviewUiResult =
  | {
      readonly _tag: "PreviewReady";
      readonly cards: readonly PreviewCard[];
    }
  | {
      readonly _tag: "FieldError";
      readonly field: CardField;
      readonly message: string;
    }
  | {
      readonly _tag: "OperationError";
      readonly message: string;
    };

const prepareCardPreview = Effect.fn("Raycast.prepareCardPreview")(function* (
  input: CardPreviewInput,
) {
  const prepared = yield* prepareCard(input);
  const parsedContent = yield* prepared.itemType.parse(prepared.content);
  const cardSpecs = prepared.itemType.cards(parsedContent);

  const cards = yield* Effect.forEach(cardSpecs, (cardSpec) =>
    Effect.all({
      prompt: prepareMarkdownForRaycast(
        { rootPath: input.workspacePath, deckPath: prepared.deckPath },
        cardSpec.prompt,
      ),
      reveal: prepareMarkdownForRaycast(
        { rootPath: input.workspacePath, deckPath: prepared.deckPath },
        cardSpec.reveal,
      ),
    }).pipe(
      Effect.map(({ prompt, reveal }): PreviewCard => ({ prompt, reveal })),
    ),
  );

  return cards;
});

export const prepareCardPreviewForUi = (
  input: CardPreviewInput,
): Effect.Effect<CardPreviewUiResult, never, Path.Path> =>
  prepareCardPreview(input).pipe(
    Effect.map(
      (cards): CardPreviewUiResult => ({
        _tag: "PreviewReady",
        cards,
      }),
    ),
    Effect.catchTags({
      CardFieldError: (error: CardFieldError) =>
        Effect.succeed<CardPreviewUiResult>({
          _tag: "FieldError",
          field: error.field,
          message: error.message,
        }),
      ContentParseError: (error: ContentParseError) =>
        Effect.succeed<CardPreviewUiResult>({
          _tag: "FieldError",
          field: input.cardType === "cloze" ? "content" : "question",
          message: formatContentParseError(error),
        }),
      RaycastMarkdownTransformError: (error: RaycastMarkdownTransformError) =>
        Effect.succeed<CardPreviewUiResult>({
          _tag: "OperationError",
          message: `Could not prepare the preview: ${error.message}`,
        }),
    }),
  );
