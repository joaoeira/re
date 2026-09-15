import { colors, row, type } from "../theme";
import { Key } from "./key";

export interface ActionProps {
  readonly label: string;
  readonly keys?: string;
  readonly onClick: () => void;
  readonly primary?: boolean;
  readonly tone?: "danger";
  readonly testId?: string;
  readonly disabled?: boolean;
}

export function Action({
  label,
  keys,
  onClick,
  primary = false,
  tone,
  testId,
  disabled = false,
}: ActionProps) {
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        ...row,
        gap: 6,
        height: 30,
        flexShrink: 0,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: 5,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        hover: disabled ? undefined : { backgroundColor: colors.hover },
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
