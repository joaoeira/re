export const theme = {
  background: "#0D1117",
  backgroundPanel: "#161B22",
  backgroundElevated: "#21262D",
  backgroundSelected: "#1F3A5F",
  backgroundHover: "#1C2128",

  text: "#E6EDF3",
  textMuted: "#7D8590",
  textSubtle: "#484F58",

  border: "#30363D",
  borderSubtle: "#21262D",
  borderFocus: "#58A6FF",

  primary: "#58A6FF",
  success: "#3FB950",
  warning: "#D29922",
  error: "#F85149",

  cardNew: "#58A6FF",
  cardDue: "#D29922",
  cardLearning: "#A371F7",

  accent: "#79C0FF",
  accentSubtle: "#388BFD33",
} as const;

export const glyphs = {
  // Status indicators
  dot: "●",
  dotHollow: "○",
  diamond: "◆",
  diamondSmall: "⬥",
  diamondHollow: "◇",

  // Navigation & hierarchy
  chevronRight: "›",
  chevronDown: "⌄",
  arrowRight: "→",
  bullet: "•",

  // Structural elements
  verticalBar: "│",
  verticalBarHeavy: "┃",
  horizontalBar: "─",
  corner: "└",
  tee: "├",

  // Icons
  folder: "▸",
  folderOpen: "▾",
  file: "◦",
  stack: "≡",

  // Decorative
  capTop: "╻",
  capBottom: "╹",
  block: "█",
  blockLight: "░",
} as const;

/**
 * Consistent spacing values (in characters).
 */
export const spacing = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
} as const;
