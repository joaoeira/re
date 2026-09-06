import { useRef, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useGpuix,
  type PublicInstance,
} from "@gpuix/react";
import { colors, column, menuInputTheme, menuItem, menuSurface, menuTrigger } from "./theme";

export function DeckCombobox({
  value,
  options,
  onChange,
  open,
  onOpenChange,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const trigger = useRef<PublicInstance | null>(null);
  const restoreTriggerFocus = useRef(true);
  const { renderer } = useGpuix();
  const label = (value: string) =>
    options.find((option) => option.value === value)?.label ?? "Choose a deck…";

  return (
    <Combobox
      items={options.map((option) => option.value)}
      value={value}
      onValueChange={(value) => {
        if (typeof value === "string") onChange(value);
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setQuery("");
          restoreTriggerFocus.current = true;
        }
        onOpenChange(next);
        if (!next && restoreTriggerFocus.current)
          queueMicrotask(() => {
            if (trigger.current) renderer?.focusElement?.(trigger.current.id);
          });
      }}
      itemToStringValue={label}
      filter={(item, query, itemToString) =>
        itemToString(item).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      }
      autoHighlight
      style={{ flexGrow: 1, alignItems: "stretch" }}
    >
      <ComboboxTrigger ref={trigger} testId="deck-select" style={menuTrigger}>
        <text style={{ color: colors.text, fontSize: 13 }}>{label(value)}</text>
        <text style={{ color: colors.muted, fontSize: 13 }}>⌄</text>
      </ComboboxTrigger>
      <ComboboxContent
        onMouseDownOutside={() => {
          restoreTriggerFocus.current = false;
        }}
        style={menuSurface}
      >
        <ComboboxInput
          testId="deck-search"
          placeholder="Search decks…"
          theme={menuInputTheme}
          style={{
            height: 35,
            paddingLeft: 9,
            paddingRight: 9,
            fontSize: 13,
            color: colors.text,
            backgroundColor: colors.surface,
            borderBottomWidth: 1,
            borderColor: colors.line,
            marginBottom: 5,
          }}
        />
        <ComboboxList style={{ ...column, maxHeight: 195, overflowY: "scroll" }}>
          {(item) => (
            <ComboboxItem
              key={item}
              value={item}
              style={({ highlighted }) => menuItem(highlighted)}
            >
              <text style={{ color: colors.text, fontSize: 13 }}>{label(item)}</text>
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty style={{ padding: 9 }}>
          <text style={{ color: colors.muted, fontSize: 13 }}>No decks match</text>
        </ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}
