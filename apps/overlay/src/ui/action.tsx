import { colors, row, type } from "../theme";
import { Key } from "./key";

export interface ActionProps {
  readonly label: string;
  readonly keys?: string;
  readonly onClick: () => void;
  readonly primary?: boolean;
  readonly tone?: "danger";
  readonly testId?: string;
}

export function Action({ label, keys, onClick, primary = false, tone, testId }: ActionProps) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        ...row,
        gap: 6,
        height: 30,
        flexShrink: 0,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: 5,
        cursor: "pointer",
        hover: { backgroundColor: colors.hover },
      }}
    >
      <text
        style={{
          ...type.command,
          color: tone === "danger" ? colors.error : primary ? colors.text : colors.muted,
          fontWeight: primary ? 500 : 400,
        }}
      >
        {label}
      </text>
      {keys && <Key>{keys}</Key>}
    </div>
  );
}
