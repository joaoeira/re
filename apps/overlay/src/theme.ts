import type { StyleDesc } from "@gpuix/react";

export const colors = {
  ground: "#282828",
  text: "#eeeeee",
  muted: "#a4a4a4",
  error: "#e5a09a",
  link: "#b9d7ff",
  field: "#2b2b2b",
  fieldBorder: "#414141",
  focus: "#737373",
  line: "#414141",
  railBorder: "#363636",
  footerBorder: "#3b3b3b",
  surface: "#303030",
  surfaceBorder: "#505050",
  highlight: "#3b3b3b",
  hover: "#ffffff0b",
  scrim: "#00000088",
  shadow: "#00000055",
  quote: "#ffffff44",
  code: "#ffffff10",
} as const;

const face = (fontSize: number, lineHeight: number, fontWeight = 400): StyleDesc => ({
  fontSize,
  lineHeight,
  fontWeight,
});

export const type = {
  caption: face(11, 16),
  label: face(12, 17),
  command: face(12, 18),
  body: face(13, 20),
  note: face(14, 21),
  input: face(14, 22),
  heading: face(18, 27),
  title: face(20, 28, 500),
  display: face(22, 30, 500),
} as const satisfies Record<string, StyleDesc>;

export const layout = {
  rail: 42,
  footer: 47,
  contentLeft: 28,
  contentRight: 24,
  formTop: 34,
  cardTop: 66,
} as const;

export const editorTheme = {
  bg: colors.field,
  text: colors.text,
  textMuted: colors.muted,
  caret: colors.text,
  accent: "#a8a8a8",
};
export const menuInputTheme = { ...editorTheme, bg: colors.surface };

// Keep the native Markdown renderer and mixed text/math paragraphs on one scale.
export const cardTypography = {
  fontFamily: "Helvetica",
  fontSize: 14,
  lineHeight: 22,
  headingSizes: [19, 16, 15, 14],
  headingLineHeights: [27, 24, 22, 22],
};
export const cardTheme = {
  ...editorTheme,
  bg: "#343434",
  fontSans: cardTypography.fontFamily,
  metrics: {
    mdTextSize: cardTypography.fontSize,
    mdLineHeight: cardTypography.lineHeight,
    mdHeadingSizes: cardTypography.headingSizes,
    mdHeadingLineHeights: cardTypography.headingLineHeights,
  },
};

export const row: StyleDesc = { display: "flex", flexDirection: "row", alignItems: "center" };
export const column: StyleDesc = { display: "flex", flexDirection: "column" };

export const divider: StyleDesc = { height: 1, flexShrink: 0, backgroundColor: colors.line };

export const popover: StyleDesc = {
  ...column,
  padding: 5,
  borderRadius: 7,
  borderWidth: 1,
  borderColor: colors.surfaceBorder,
  backgroundColor: colors.surface,
  boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 22, spreadRadius: 0, color: colors.shadow },
};
export const popoverItem = (highlighted: boolean): StyleDesc => ({
  ...row,
  justifyContent: "space-between",
  height: 34,
  flexShrink: 0,
  paddingLeft: 8,
  paddingRight: 8,
  borderRadius: 4,
  cursor: "pointer",
  backgroundColor: highlighted ? colors.highlight : colors.surface,
});
