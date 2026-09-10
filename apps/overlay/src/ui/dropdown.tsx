import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@gpuix/react";
import { colors, font, menuItem, menuSurface, menuTrigger } from "../theme";

export interface DropdownProps {
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly testId: string;
}

export function Dropdown({ value, options, onChange, open, onOpenChange, testId }: DropdownProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Select
      value={value}
      onValueChange={onChange}
      open={open}
      onOpenChange={onOpenChange}
      style={{ flexGrow: 1, alignItems: "stretch" }}
    >
      <SelectTrigger
        testId={testId}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ ...menuTrigger, borderColor: focused ? colors.focus : colors.line }}
      >
        <text style={{ color: colors.text, fontSize: font.body }}>
          {options.find((option) => option.value === value)?.label ?? "Choose a deck…"}
        </text>
        <text style={{ color: colors.muted, fontSize: font.body }}>⌄</text>
      </SelectTrigger>
      <SelectContent style={{ ...menuSurface, maxHeight: 235, overflowY: "scroll" }}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            textValue={option.label}
            style={({ highlighted }) => menuItem(highlighted)}
          >
            <text style={{ color: colors.text, fontSize: font.body }}>{option.label}</text>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
