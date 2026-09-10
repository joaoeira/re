import type { ReactNode } from "react";
import { colors, row, type } from "../theme";

export function Key({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        ...row,
        justifyContent: "center",
        minWidth: 20,
        height: 21,
        flexShrink: 0,
        paddingLeft: 5,
        paddingRight: 5,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <text style={{ ...type.caption, color: colors.muted }}>{children}</text>
    </div>
  );
}
