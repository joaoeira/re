import type { ReactNode } from "react";
import { colors, column, editorTheme, type } from "../theme";

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
    <div style={{ ...column, gap: 6, flexShrink: 0 }}>
      <text style={{ ...type.label, color: colors.muted }}>{label}</text>
      {children}
      {error && <text style={{ ...type.label, color: colors.error }}>{error}</text>}
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
          ...type.input,
          color: colors.text,
          backgroundColor: colors.field,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: error ? colors.error : focused ? colors.focus : colors.fieldBorder,
          paddingTop: 13,
          paddingBottom: 13,
          paddingLeft: 14,
          paddingRight: 14,
        }}
      />
    </Field>
  );
}
