import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

type DeckOption = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly name: string;
};

type DeckComboboxProps = {
  readonly deckPath: string | null;
  readonly decks: readonly DeckOption[];
  readonly disabled?: boolean;
  readonly onChange: (deckPath: string | null) => void;
  readonly onCreateDeck: (relativePath: string) => void;
};

type CreateAction = { readonly __action: "create"; readonly relativePath: string };
type ComboboxValue = DeckOption | CreateAction;

const isCreateAction = (v: ComboboxValue): v is CreateAction => "__action" in v;

export function DeckCombobox({
  deckPath,
  decks,
  disabled = false,
  onChange,
  onCreateDeck,
}: DeckComboboxProps) {
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);

  const selectedDeck = useMemo(
    () => decks.find((d) => d.absolutePath === deckPath) ?? null,
    [decks, deckPath],
  );

  const filteredDecks = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return decks;
    return decks.filter((d) => d.relativePath.toLowerCase().includes(q));
  }, [decks, inputValue]);

  const canCreate = useMemo(() => {
    if (!inputValue.trim()) return false;
    const q = inputValue.toLowerCase().trim();
    return !decks.some(
      (d) => d.relativePath.toLowerCase() === q || d.relativePath.toLowerCase() === `${q}.md`,
    );
  }, [decks, inputValue]);

  const createRelativePath = useMemo(() => {
    const trimmed = inputValue.trim();
    return trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  }, [inputValue]);

  const handleValueChange = useCallback(
    (value: ComboboxValue | null) => {
      if (value && isCreateAction(value)) {
        onCreateDeck(value.relativePath);
        setInputValue("");
        setOpen(false);
        return;
      }
      onChange(value ? (value as DeckOption).absolutePath : null);
      setInputValue("");
    },
    [onChange, onCreateDeck],
  );

  return (
    <Combobox<ComboboxValue>
      value={selectedDeck}
      onValueChange={handleValueChange}
      onInputValueChange={(value) => setInputValue(value)}
      itemToStringLabel={(item) =>
        isCreateAction(item) ? `Create ${item.relativePath}` : item.relativePath
      }
      isItemEqualToValue={(a, b) => {
        if (isCreateAction(a) || isCreateAction(b)) return false;
        return a.absolutePath === b.absolutePath;
      }}
      filter={null}
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground/60">in</span>
        <ComboboxInput
          placeholder="select deck"
          className="max-w-64 font-mono text-xs text-muted-foreground"
        />
      </div>
      <ComboboxContent align="start" sideOffset={6}>
        <ComboboxList>
          {filteredDecks.map((deck) => (
            <ComboboxItem key={deck.absolutePath} value={deck}>
              <span className="truncate font-mono">{deck.relativePath}</span>
            </ComboboxItem>
          ))}
          {canCreate && (
            <ComboboxItem value={{ __action: "create" as const, relativePath: createRelativePath }}>
              <Plus className="size-3 shrink-0" />
              <span>
                Create <span className="font-mono">{createRelativePath}</span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
        {filteredDecks.length === 0 && !canCreate && <ComboboxEmpty>No decks found</ComboboxEmpty>}
      </ComboboxContent>
    </Combobox>
  );
}
