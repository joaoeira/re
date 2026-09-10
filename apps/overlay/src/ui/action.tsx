import { colors, font, row } from "../theme";
import { Key } from "./key";

export interface ActionProps {
  readonly label: string;
  readonly keys?: string;
  readonly onClick: () => void;
  readonly primary?: boolean;
  readonly testId?: string;
}

export function Action({ label, keys, onClick, primary = false, testId }: ActionProps) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        ...row,
        gap: 7,
        padding: 6,
        borderRadius: 5,
        cursor: "pointer",
        hover: { backgroundColor: colors.hover },
      }}
    >
      <text
        style={{
          color: primary ? colors.text : colors.muted,
          fontSize: font.label,
          fontWeight: primary ? 500 : 400,
        }}
      >
        {label}
      </text>
      {keys && <Key>{keys}</Key>}
    </div>
  );
}
