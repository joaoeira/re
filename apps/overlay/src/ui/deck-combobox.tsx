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
import { colors, column, font, menuInputTheme, menuItem, menuSurface, menuTrigger } from "../theme";

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
      style={{ flexGrow: 1, alignItems: "stretch" }}
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
        style={{ ...menuTrigger, borderColor: focused ? colors.focus : colors.line }}
      >
        <text style={{ color: colors.text, fontSize: font.body }}>{label(value)}</text>
        <text style={{ color: colors.muted, fontSize: font.body }}>⌄</text>
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
            fontSize: font.body,
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
              <text style={{ color: colors.text, fontSize: font.body }}>{label(item)}</text>
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty style={{ padding: 9 }}>
          <text style={{ color: colors.muted, fontSize: font.body }}>No decks match</text>
        </ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}
