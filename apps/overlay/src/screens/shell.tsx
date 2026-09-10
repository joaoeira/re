import type { ReactNode } from "react";
import type { Notice } from "../notice";
import { colors, column, layout, row, type } from "../theme";
import { Action } from "../ui/action";
import { Icon, type IconName } from "../ui/icons";

export interface Command {
  readonly label: string;
  readonly keys?: string;
  readonly primary?: boolean;
  readonly tone?: "danger";
  readonly onClick: () => void;
  readonly testId?: string;
}

export interface FooterProps {
  readonly context?: string;
  readonly selectors?: ReactNode;
  readonly commands: readonly Command[];
}

export interface ShellProps {
  readonly onBack: () => void;
  readonly onUndo?: () => void;
  readonly onActions: () => void;
  readonly notice: Notice | null;
  readonly footer: FooterProps;
  readonly children: ReactNode;
  readonly overlays?: ReactNode;
}

export function Shell({
  onBack,
  onUndo,
  onActions,
  notice,
  footer,
  children,
  overlays,
}: ShellProps) {
  return (
    <div
      style={{
        ...row,
        alignItems: "stretch",
        height: "100%",
        backgroundColor: colors.ground,
        position: "relative",
      }}
    >
      <Rail onBack={onBack} onUndo={onUndo} onActions={onActions} />
      <div style={{ ...column, flexGrow: 1, minWidth: 0 }}>
        {children}
        <Footer {...footer} />
      </div>
      {notice && <NoticeLine notice={notice} />}
      {overlays}
    </div>
  );
}

function RailButton({
  icon,
  top,
  bottom,
  onClick,
  testId,
}: {
  readonly icon: IconName;
  readonly top?: number;
  readonly bottom?: number;
  readonly onClick: () => void;
  readonly testId?: string;
}) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        ...row,
        justifyContent: "center",
        position: "absolute",
        left: 7,
        top,
        bottom,
        width: 28,
        height: 28,
        borderRadius: 5,
        cursor: "pointer",
        hover: { backgroundColor: colors.hover },
      }}
    >
      <Icon name={icon} />
    </div>
  );
}

function Rail({ onBack, onUndo, onActions }: Pick<ShellProps, "onBack" | "onUndo" | "onActions">) {
  return (
    <div
      style={{
        width: layout.rail,
        flexShrink: 0,
        position: "relative",
        borderRightWidth: 1,
        borderColor: colors.railBorder,
      }}
    >
      <RailButton icon="back" top={12} onClick={onBack} testId="back" />
      {onUndo && <RailButton icon="undo" top={56} onClick={onUndo} testId="undo" />}
      <RailButton icon="actions" bottom={9} onClick={onActions} testId="actions" />
    </div>
  );
}

function NoticeLine({ notice }: { readonly notice: Notice }) {
  return (
    <div
      style={{
        position: "absolute",
        left: layout.rail + layout.contentLeft,
        right: layout.contentRight,
        bottom: layout.footer + 5,
      }}
    >
      <text
        style={{
          ...type.label,
          color: notice.tone === "success" ? colors.muted : colors.error,
        }}
      >
        {notice.text}
      </text>
    </div>
  );
}

function Footer({ context, selectors, commands }: FooterProps) {
  return (
    <div
      style={{
        ...row,
        justifyContent: "space-between",
        height: layout.footer,
        flexShrink: 0,
        paddingLeft: 18,
        paddingRight: 18,
        borderTopWidth: 1,
        borderColor: colors.footerBorder,
      }}
    >
      {selectors ?? (
        <text
          style={{
            ...type.caption,
            color: colors.muted,
            flexShrink: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {context ?? ""}
        </text>
      )}
      <div style={{ ...row, gap: 8, flexShrink: 0 }}>
        {commands.map((command) => (
          <Action key={command.label} {...command} />
        ))}
      </div>
    </div>
  );
}
