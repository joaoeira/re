import type { ReactNode } from "react";
import { colors, row, type } from "../theme";
import { Icon } from "./icons";

// The footer's compact picker trigger: a caption label with a chevron.
export function SelectorLabel({
  children,
  focused,
}: {
  readonly children: ReactNode;
  readonly focused: boolean;
}) {
  return (
    <div style={{ ...row, gap: 7, height: 30 }}>
      <text
        style={{
          ...type.caption,
          color: focused ? colors.text : colors.muted,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          maxWidth: 220,
        }}
      >
        {children}
      </text>
      <Icon name="chevron" />
    </div>
  );
}
