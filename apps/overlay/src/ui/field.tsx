import type { ReactNode } from "react";
import { colors, column, editorTheme, font, row } from "../theme";

export type DraftFieldName = "question" | "answer" | "content";

export interface DraftFieldState {
  readonly focused: boolean;
  readonly error?: string;
  readonly readOnly: boolean;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
}

export interface DraftFieldProps extends DraftFieldState {
  readonly label: string;
  readonly testId: string;
  readonly value: string;
  readonly placeholder: string;
  readonly rows: number;
  readonly autoFocus?: boolean;
  readonly onChange: (value: string) => void;
}

export function Field({
  label,
  children,
  error,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly error?: string;
}) {
  return (
    <div style={{ ...row, gap: 20 }}>
      <text style={{ width: 70, textAlign: "right", color: colors.muted, fontSize: font.label }}>
        {label}
      </text>
      <div style={{ ...column, flexGrow: 1, minWidth: 0, gap: 5 }}>
        {children}
        {error && <text style={{ color: colors.error, fontSize: font.label }}>{error}</text>}
      </div>
    </div>
  );
}

export function DraftField({
  label,
  testId,
  value,
  placeholder,
  rows,
  autoFocus = false,
  focused,
  readOnly,
  onChange,
  onFocus,
  onBlur,
  error,
}: DraftFieldProps) {
  return (
    <Field label={label} error={error}>
      <textarea
        readOnly={readOnly}
        testId={testId}
        autoFocus={autoFocus || undefined}
        value={value}
        onChange={(event) => onChange(event.value ?? "")}
        onFocus={onFocus}
        onClick={onFocus}
        onKeyDown={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        minRows={rows}
        maxRows={rows}
        theme={editorTheme}
        style={{
          flexGrow: 1,
          color: colors.text,
          backgroundColor: colors.field,
          borderRadius: 7,
          borderWidth: 1,
          borderColor: error ? colors.error : focused ? colors.focus : colors.line,
          padding: 12,
          fontSize: font.input,
        }}
      />
    </Field>
  );
}
