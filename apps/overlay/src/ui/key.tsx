import type { ReactNode } from "react";
import { colors, font, row } from "../theme";

export function Key({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        ...row,
        justifyContent: "center",
        minWidth: 19,
        height: 20,
        paddingLeft: 4,
        paddingRight: 4,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.field,
      }}
    >
      <text style={{ color: colors.muted, fontSize: font.caption }}>{children}</text>
    </div>
  );
}
