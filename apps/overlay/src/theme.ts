import type { StyleDesc } from "@gpuix/react";

export const colors = {
  text: "#eeeeee",
  muted: "#a1a1a1",
  error: "#f0aca5",
  link: "#b9d7ff",
  field: "#ffffff08",
  line: "#ffffff16",
  hover: "#ffffff0b",
  highlight: "#ffffff18",
  surface: "#3b3b3b",
  surfaceBorder: "#ffffff22",
} as const;

export const editorTheme = {
  bg: "#343434",
  text: colors.text,
  textMuted: colors.muted,
  caret: colors.text,
  accent: "#a8a8a8",
};
export const menuInputTheme = { ...editorTheme, bg: colors.surface };

export const row: StyleDesc = { display: "flex", flexDirection: "row", alignItems: "center" };
export const column: StyleDesc = { display: "flex", flexDirection: "column" };

export const menuTrigger: StyleDesc = {
  ...row,
  width: "100%",
  justifyContent: "space-between",
  height: 33,
  paddingLeft: 12,
  paddingRight: 12,
  borderRadius: 7,
  borderWidth: 1,
  borderColor: colors.line,
  backgroundColor: colors.field,
  cursor: "pointer",
};
export const menuSurface: StyleDesc = {
  ...column,
  width: 490,
  padding: 5,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: colors.surfaceBorder,
  backgroundColor: colors.surface,
};
export const menuItem = (highlighted: boolean): StyleDesc => ({
  ...row,
  padding: 9,
  borderRadius: 5,
  cursor: "pointer",
  backgroundColor: highlighted ? colors.highlight : colors.surface,
});
