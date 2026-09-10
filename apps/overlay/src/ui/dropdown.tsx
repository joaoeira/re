import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@gpuix/react";
import { colors, popover, popoverItem, type } from "../theme";
import { Key } from "./key";
import { SelectorLabel } from "./selector";

export interface DropdownProps {
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly testId: string;
  readonly triggerLabel?: (value: string) => string;
}

export function Dropdown({
  value,
  options,
  onChange,
  open,
  onOpenChange,
  testId,
  triggerLabel,
}: DropdownProps) {
  const [focused, setFocused] = useState(false);
  const label = options.find((option) => option.value === value)?.label ?? "Choose…";
  return (
    <Select value={value} onValueChange={onChange} open={open} onOpenChange={onOpenChange}>
      <SelectTrigger
        testId={testId}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ cursor: "pointer" }}
      >
        <SelectorLabel focused={focused}>
          {triggerLabel ? triggerLabel(value) : label}
        </SelectorLabel>
      </SelectTrigger>
      <SelectContent
        side="top"
        align="start"
        sideOffset={8}
        style={{ ...popover, width: 230, maxHeight: 300, overflowY: "scroll" }}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            textValue={option.label}
            style={({ highlighted }) => popoverItem(highlighted)}
          >
            <text style={{ ...type.label, color: colors.text }}>{option.label}</text>
            {option.value === value && <Key>✓</Key>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
