import type { DeckEntry } from "@re/workspace";
import { DeckCombobox } from "@/components/editor/deck-combobox";

type CardsFooterProps = {
  readonly addedCount: number;
  readonly deckPath: string | null;
  readonly decks: ReadonlyArray<DeckEntry>;
  readonly disabled?: boolean;
  readonly deckErrorMessage?: string | null;
  readonly onDeckPathChange: (deckPath: string | null) => void;
  readonly onCreateDeck: (relativePath: string) => void;
};

export function CardsFooter({
  addedCount,
  deckPath,
  decks,
  disabled = false,
  deckErrorMessage = null,
  onDeckPathChange,
  onCreateDeck,
}: CardsFooterProps) {
  return (
    <div className="shrink-0 border-t border-border bg-muted/30 px-6 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          <span className="font-mono font-medium text-primary">{addedCount}</span>{" "}
          {addedCount === 1 ? "card" : "cards"} added to deck
        </p>
        <div className="flex items-center gap-3">
          {deckErrorMessage ? (
            <span className="max-w-72 truncate text-xs text-destructive">{deckErrorMessage}</span>
          ) : null}
          <DeckCombobox
            deckPath={deckPath}
            decks={decks}
            disabled={disabled}
            onChange={onDeckPathChange}
            onCreateDeck={onCreateDeck}
          />
        </div>
      </div>
    </div>
  );
}
