import { cn } from "@/lib/utils";

type DeckOption = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly name: string;
};

type DeckSelectorProps = {
  readonly deckPath: string | null;
  readonly decks: readonly DeckOption[];
  readonly disabled?: boolean;
  readonly onChange: (deckPath: string | null) => void;
};

export function DeckSelector({ deckPath, decks, disabled = false, onChange }: DeckSelectorProps) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Deck</span>
      <select
        value={deckPath ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        className={cn(
          "h-8 border border-border bg-background px-2 text-xs text-foreground outline-none",
          "focus:border-foreground disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        <option value="" disabled>
          {decks.length === 0 ? "No decks available" : "Select a deck"}
        </option>
        {decks.map((deck) => (
          <option key={deck.absolutePath} value={deck.absolutePath}>
            {deck.relativePath}
          </option>
        ))}
      </select>
    </label>
  );
}
