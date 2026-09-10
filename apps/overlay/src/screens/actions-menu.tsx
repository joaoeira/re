import { colors, font, menuItem, menuSurface } from "../theme";
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
        ...menuSurface,
        position: "absolute",
        bottom: 49,
        right: 12,
        width: 285,
        maxHeight: 350,
        overflowY: "scroll",
        padding: 6,
        gap: 2,
        borderRadius: 10,
        boxShadow: {
          offsetX: 0,
          offsetY: 6,
          blurRadius: 24,
          spreadRadius: 0,
          color: colors.shadow,
        },
      }}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          onClick={() => onSelect(item)}
          onMouseEnter={() => onActivate(index)}
          style={{ ...menuItem(activeIndex === index), justifyContent: "space-between" }}
        >
          <text style={{ color: colors.text, fontSize: font.body }}>{item.label}</text>
          {item.key && <Key>{item.key}</Key>}
        </div>
      ))}
    </div>
  );
}
