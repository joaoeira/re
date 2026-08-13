import { describe, expect, it } from "@effect/vitest";
import type { ItemMetadata, UntypedItemType } from "@re/core";
import {
  DeckNotFound,
  type DeckEntry,
  type ItemValidationError,
  type WriteError,
} from "@re/workspace";
import { Effect, Layer } from "effect";

import {
  createCardForUi,
  loadDecksForUi,
  prepareCard,
  type CreateCardInput,
} from "../src/card-creation";
import { DeckStore, type DeckStore as DeckStoreService } from "../src/deck-store";

interface AppendCall {
  readonly deckPath: string;
  readonly item: {
    readonly cards: readonly ItemMetadata[];
    readonly content: string;
  };
  readonly itemType: UntypedItemType;
}

const createTestLayer = (options?: {
  readonly decks?: readonly DeckEntry[];
  readonly appendError?: WriteError | ItemValidationError;
  readonly onAppend?: (call: AppendCall) => void;
}): Layer.Layer<DeckStoreService> =>
  Layer.succeed(DeckStore, {
    listDecks: () => Effect.succeed(options?.decks ?? []),
    appendItem: (deckPath, item, itemType) => {
      options?.onAppend?.({ deckPath, item, itemType });
      return options?.appendError === undefined ? Effect.void : Effect.fail(options.appendError);
    },
    importImageFromBytes: () => Effect.dieMessage("Image import is not used in card tests."),
  });

const validQa: CreateCardInput = {
  cardType: "qa",
  deckPath: "/decks/computing.md",
  question: "What is an effect?",
  answer: "A description of a computation.",
  content: "",
};

describe("prepareCard", () => {
  it.effect("builds canonical Q&A content and one metadata record", () =>
    Effect.gen(function* () {
      const prepared = yield* prepareCard({
        ...validQa,
        question: "  What is an effect?  ",
        answer: "  A description of a computation.  ",
      });

      expect(prepared.content).toBe("What is an effect?\n---\nA description of a computation.");
      expect(prepared.cardCount).toBe(1);
      expect(prepared.item.cards).toHaveLength(1);
      expect(prepared.itemType.name).toBe("qa");
    }),
  );

  it.effect("creates one metadata record per unique cloze index", () =>
    Effect.gen(function* () {
      const prepared = yield* prepareCard({
        cardType: "cloze",
        deckPath: "/decks/geography.md",
        question: "",
        answer: "",
        content: "{{c1::Lisbon}} is in {{c2::Portugal}}. {{c1::Lisbon}} is coastal.",
      });

      expect(prepared.cardCount).toBe(2);
      expect(prepared.item.cards).toHaveLength(2);
      expect(prepared.itemType.name).toBe("cloze");
    }),
  );

  it.effect("preserves cloze text so parser positions match the form input", () =>
    Effect.gen(function* () {
      const prepared = yield* prepareCard({
        cardType: "cloze",
        deckPath: "/decks/geography.md",
        question: "",
        answer: "",
        content: "  The city is {{c1::Lisbon}}.\n",
      });

      expect(prepared.content).toBe("  The city is {{c1::Lisbon}}.\n");
    }),
  );
});

describe("createCardForUi", () => {
  it.effect("appends a valid card to the selected deck", () => {
    let appendCall: AppendCall | undefined;

    return Effect.gen(function* () {
      const result = yield* createCardForUi(validQa);

      expect(result).toEqual({ _tag: "Created", cardCount: 1 });
      expect(appendCall?.deckPath).toBe(validQa.deckPath);
      expect(appendCall?.item.content).toBe(
        "What is an effect?\n---\nA description of a computation.",
      );
    }).pipe(
      Effect.provide(
        createTestLayer({
          onAppend: (call) => {
            appendCall = call;
          },
        }),
      ),
    );
  });

  it.effect("returns a content-field error and does not write malformed cloze content", () => {
    let appended = false;

    return Effect.gen(function* () {
      const result = yield* createCardForUi({
        cardType: "cloze",
        deckPath: "/decks/geography.md",
        question: "",
        answer: "",
        content: "The capital is {{cx::Lisbon}}.",
      });

      expect(result._tag).toBe("FieldError");
      if (result._tag === "FieldError") {
        expect(result.field).toBe("content");
        expect(result.message).toContain("character 15");
        expect(result.message).toContain("{{cx::");
      }
      expect(appended).toBe(false);
    }).pipe(
      Effect.provide(
        createTestLayer({
          onAppend: () => {
            appended = true;
          },
        }),
      ),
    );
  });

  it.effect("maps a missing selected deck to the deck field", () =>
    Effect.gen(function* () {
      const result = yield* createCardForUi(validQa);

      expect(result).toEqual({
        _tag: "FieldError",
        field: "deckPath",
        message: "The selected deck no longer exists. Refresh the deck list.",
      });
    }).pipe(
      Effect.provide(
        createTestLayer({
          appendError: new DeckNotFound({ deckPath: validQa.deckPath }),
        }),
      ),
    ),
  );
});

describe("loadDecksForUi", () => {
  it.effect("returns the scanned decks", () => {
    const decks: readonly DeckEntry[] = [
      {
        absolutePath: "/decks/geography.md",
        relativePath: "geography.md",
        name: "geography",
      },
    ];

    return Effect.gen(function* () {
      const result = yield* loadDecksForUi("/decks");
      expect(result).toEqual({ _tag: "DecksLoaded", decks });
    }).pipe(Effect.provide(createTestLayer({ decks })));
  });
});
