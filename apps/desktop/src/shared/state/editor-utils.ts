import { Option } from "effect";

import { QA_SEPARATOR } from "@shared/state/editorStore";

type DeckEntry = {
  readonly absolutePath: string;
  readonly relativePath: string;
};

type ContentContext = {
  readonly cardType: "qa" | "cloze";
  readonly frontContent: string;
  readonly backContent: string;
};

export type DuplicateStatus = {
  readonly isDuplicate: boolean;
  readonly matchingDeckPath: string | null;
};

export const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const normalizeDeckPathFromSearch = (
  value: string | undefined,
  decks: readonly DeckEntry[],
): string | null => {
  if (!value) {
    return null;
  }

  const byAbsolute = decks.find((deck) => deck.absolutePath === value);
  if (byAbsolute) {
    return byAbsolute.absolutePath;
  }

  const byRelative = decks.find((deck) => deck.relativePath === value);
  if (byRelative) {
    return byRelative.absolutePath;
  }

  return value;
};

export const buildEditorContent = (context: ContentContext): string | null => {
  if (context.cardType === "qa") {
    const front = context.frontContent.trim();
    const back = context.backContent.trim();

    if (front.length === 0 || back.length === 0) {
      return null;
    }

    return `${front}${QA_SEPARATOR}${back}`;
  }

  const cloze = context.frontContent.trim();
  return cloze.length === 0 ? null : cloze;
};

export const toDuplicateStatus = (value: {
  readonly isDuplicate: boolean;
  readonly matchingDeckPath: Option.Option<string>;
}): DuplicateStatus => ({
  isDuplicate: value.isDuplicate,
  matchingDeckPath: Option.isSome(value.matchingDeckPath) ? value.matchingDeckPath.value : null,
});

export const isSameEditorRequest = (
  incoming: { mode: string; deckPath?: string | undefined; cardId?: string | undefined },
  current: { mode: string; deckPath?: string | undefined; cardId?: string | undefined },
): boolean =>
  incoming.mode === current.mode &&
  (incoming.mode === "create"
    ? (incoming.deckPath ?? null) === (current.deckPath ?? null)
    : incoming.deckPath === current.deckPath && incoming.cardId === current.cardId);
