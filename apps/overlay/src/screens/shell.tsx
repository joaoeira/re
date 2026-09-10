import type { ReactNode } from "react";
import type { Notice } from "../notice";
import { colors, column, font, row } from "../theme";
import { Action } from "../ui/action";

export interface FooterProps {
  readonly context: string;
  readonly grading?: {
    readonly onAgain: () => void;
    readonly onHard: () => void;
    readonly onEasy: () => void;
  };
  readonly primary: {
    readonly label: string;
    readonly keys: string;
    readonly onClick: () => void;
  };
  readonly onActions: () => void;
}

export interface ShellProps {
  readonly onBack: () => void;
  readonly progress?: string;
  readonly notice: Notice | null;
  readonly footer: FooterProps;
  readonly children: ReactNode;
  readonly overlays?: ReactNode;
}

export function Shell({ onBack, progress, notice, footer, children, overlays }: ShellProps) {
  return (
    <div
      style={{
        ...column,
        height: "100%",
        backgroundColor: colors.window,
        position: "relative",
      }}
    >
      <Header onBack={onBack} progress={progress} />
      {children}
      {notice && <NoticeLine notice={notice} />}
      <Footer {...footer} />
      {overlays}
    </div>
  );
}

function Header({ onBack, progress }: Pick<ShellProps, "onBack" | "progress">) {
  return (
    <div
      style={{
        ...row,
        height: 44,
        flexShrink: 0,
        paddingLeft: 15,
        paddingRight: 18,
        justifyContent: "space-between",
      }}
    >
      <div onClick={onBack} style={{ cursor: "pointer", padding: 5 }}>
        <text style={{ color: colors.muted, fontSize: font.glyph }}>‹</text>
      </div>
      {progress && <text style={{ color: colors.muted, fontSize: font.label }}>{progress}</text>}
    </div>
  );
}

function NoticeLine({ notice }: { readonly notice: Notice }) {
  return (
    <div style={{ paddingLeft: 20, paddingRight: 20, paddingBottom: 8 }}>
      <text
        style={{
          color: notice.tone === "success" ? colors.muted : colors.error,
          fontSize: font.label,
        }}
      >
        {notice.text}
      </text>
    </div>
  );
}

function Footer({ context, grading, primary, onActions }: FooterProps) {
  return (
    <div
      style={{
        ...row,
        justifyContent: "space-between",
        height: 43,
        flexShrink: 0,
        paddingLeft: 16,
        paddingRight: 12,
        borderTopWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.footer,
      }}
    >
      <text
        style={{
          color: colors.muted,
          fontSize: font.label,
          flexShrink: 1,
          minWidth: 0,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        {context}
      </text>
      <div style={{ ...row, gap: 8 }}>
        {grading && (
          <>
            <Action label="Again" keys="1" onClick={grading.onAgain} testId="again" />
            <Action label="Hard" keys="2" onClick={grading.onHard} testId="hard" />
          </>
        )}
        <Action
          label={primary.label}
          keys={primary.keys}
          primary
          onClick={primary.onClick}
          testId="primary"
        />
        {grading && <Action label="Easy" keys="4" onClick={grading.onEasy} testId="easy" />}
        <div style={{ width: 1, height: 16, backgroundColor: colors.line }} />
        <Action label="Actions" keys="⌘ K" onClick={onActions} testId="actions" />
      </div>
    </div>
  );
}
