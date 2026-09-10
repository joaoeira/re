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
import { colors, column, menuInputTheme, popover, popoverItem, type } from "../theme";
import { SelectorLabel } from "./selector";

export interface DeckComboboxProps {
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function DeckCombobox({ value, options, onChange, open, onOpenChange }: DeckComboboxProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
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
    >
      <ComboboxTrigger
        ref={trigger}
        testId="deck-select"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (
            (event.key === "enter" || event.key === "space") &&
            !event.modifiers?.cmd &&
            !event.modifiers?.ctrl &&
            !event.modifiers?.alt
          ) {
            setQuery("");
            restoreTriggerFocus.current = true;
            onOpenChange(true);
          }
        }}
        style={{ cursor: "pointer" }}
      >
        <SelectorLabel focused={focused}>{label(value)}</SelectorLabel>
      </ComboboxTrigger>
      <ComboboxContent
        side="top"
        align="start"
        sideOffset={8}
        onMouseDownOutside={() => {
          restoreTriggerFocus.current = false;
        }}
        style={{ ...popover, width: 350 }}
      >
        <ComboboxInput
          testId="deck-search"
          placeholder="Search decks…"
          theme={menuInputTheme}
          style={{
            ...type.body,
            height: 40,
            padding: 8,
            color: colors.text,
            backgroundColor: colors.surface,
            borderBottomWidth: 1,
            borderColor: colors.fieldBorder,
          }}
        />
        <ComboboxList style={{ ...column, maxHeight: 170, overflowY: "scroll" }}>
          {(item) => (
            <ComboboxItem
              key={item}
              value={item}
              style={({ highlighted }) => popoverItem(highlighted)}
            >
              <text style={{ ...type.label, color: colors.text }}>{label(item)}</text>
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty style={popoverItem(false)}>
          <text style={{ ...type.label, color: colors.muted }}>No decks match</text>
        </ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}
