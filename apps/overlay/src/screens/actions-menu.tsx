import { colors, column, layout, popover, popoverItem, type } from "../theme";
import { Key } from "../ui/key";

export interface MenuItem {
  readonly label: string;
  readonly key: string;
  readonly run: () => void;
}

export interface ActionsMenuProps {
  readonly items: readonly MenuItem[];
  readonly activeIndex: number;
  readonly onActivate: (index: number) => void;
  readonly onSelect: (item: MenuItem) => void;
}

export function ActionsMenu({ items, activeIndex, onActivate, onSelect }: ActionsMenuProps) {
  return (
    <div
      style={{
        ...popover,
        padding: 0,
        position: "absolute",
        left: layout.rail + 6,
        bottom: 8,
        width: 285,
        maxHeight: 400,
        overflowY: "scroll",
      }}
    >
      <div style={{ ...column, padding: 5 }}>
        {items.map((item, index) => (
          <div
            key={item.label}
            onClick={() => onSelect(item)}
            onMouseEnter={() => onActivate(index)}
            style={popoverItem(activeIndex === index)}
          >
            <text style={{ ...type.label, color: colors.text }}>{item.label}</text>
            {item.key && <Key>{item.key}</Key>}
          </div>
        ))}
      </div>
    </div>
  );
}
