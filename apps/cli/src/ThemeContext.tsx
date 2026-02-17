import { createContext, useContext, useMemo, type ReactNode } from "react";
import { SyntaxStyle, type ThemeTokenStyle } from "@opentui/core";

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

export const spacing = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
} as const;

/**
 * Theme colors including markdown-specific colors.
 */
export interface ThemeColors {
  // Base colors
  background: string;
  backgroundPanel: string;
  backgroundElevated: string;
  backgroundSelected: string;
  backgroundHover: string;

  text: string;
  textMuted: string;
  textSubtle: string;

  border: string;
  borderSubtle: string;
  borderFocus: string;

  primary: string;
  success: string;
  warning: string;
  error: string;

  cardNew: string;
  cardDue: string;
  cardLearning: string;

  accent: string;
  accentSubtle: string;

  // Markdown colors
  markdownText: string;
  markdownHeading: string;
  markdownLink: string;
  markdownLinkText: string;
  markdownCode: string;
  markdownBlockQuote: string;
  markdownEmph: string;
  markdownStrong: string;
  markdownHorizontalRule: string;
  markdownListItem: string;
  markdownListEnumeration: string;

  // Syntax colors (for code blocks within markdown)
  syntaxComment: string;
  syntaxKeyword: string;
  syntaxFunction: string;
  syntaxVariable: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxType: string;
  syntaxOperator: string;
  syntaxPunctuation: string;
}

/**
 * GitHub Dark theme with markdown colors.
 */
export const themeColors: ThemeColors = {
  // Base colors (from existing theme)
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

  // Markdown colors
  markdownText: "#E6EDF3",
  markdownHeading: "#79C0FF",
  markdownLink: "#58A6FF",
  markdownLinkText: "#56D4DD",
  markdownCode: "#7EE787",
  markdownBlockQuote: "#D29922",
  markdownEmph: "#D29922",
  markdownStrong: "#FFA657",
  markdownHorizontalRule: "#30363D",
  markdownListItem: "#7D8590",
  markdownListEnumeration: "#56D4DD",

  // Syntax colors
  syntaxComment: "#7D8590",
  syntaxKeyword: "#FF7B72",
  syntaxFunction: "#D2A8FF",
  syntaxVariable: "#E6EDF3",
  syntaxString: "#A5D6FF",
  syntaxNumber: "#79C0FF",
  syntaxType: "#FFA657",
  syntaxOperator: "#FF7B72",
  syntaxPunctuation: "#E6EDF3",
} as const;

/**
 * Creates the syntax rules for Tree-sitter highlighting.
 */
function getSyntaxRules(colors: ThemeColors): ThemeTokenStyle[] {
  return [
    // Default text
    {
      scope: ["default"],
      style: { foreground: colors.markdownText },
    },

    // Markdown headings
    {
      scope: ["markup.heading"],
      style: { foreground: colors.markdownHeading, bold: true },
    },
    {
      scope: ["markup.heading.1"],
      style: { foreground: colors.markdownHeading, bold: true },
    },
    {
      scope: ["markup.heading.2"],
      style: { foreground: colors.markdownHeading, bold: true },
    },
    {
      scope: ["markup.heading.3"],
      style: { foreground: colors.markdownHeading, bold: true },
    },
    {
      scope: ["markup.heading.4"],
      style: { foreground: colors.markdownHeading, bold: true },
    },
    {
      scope: ["markup.heading.5"],
      style: { foreground: colors.markdownHeading, bold: true },
    },
    {
      scope: ["markup.heading.6"],
      style: { foreground: colors.markdownHeading, bold: true },
    },

    // Bold and strong
    {
      scope: ["markup.bold", "markup.strong"],
      style: { foreground: colors.markdownStrong, bold: true },
    },

    // Italic and emphasis
    {
      scope: ["markup.italic"],
      style: { foreground: colors.markdownEmph, italic: true },
    },

    // Lists
    {
      scope: ["markup.list"],
      style: { foreground: colors.markdownListItem },
    },
    {
      scope: ["markup.list.checked"],
      style: { foreground: colors.success },
    },
    {
      scope: ["markup.list.unchecked"],
      style: { foreground: colors.textMuted },
    },

    // Blockquotes
    {
      scope: ["markup.quote"],
      style: { foreground: colors.markdownBlockQuote, italic: true },
    },

    // Code (inline and block)
    {
      scope: ["markup.raw", "markup.raw.block"],
      style: { foreground: colors.markdownCode },
    },
    {
      scope: ["markup.raw.inline"],
      style: { foreground: colors.markdownCode },
    },

    // Links
    {
      scope: ["markup.link"],
      style: { foreground: colors.markdownLink, underline: true },
    },
    {
      scope: ["markup.link.label"],
      style: { foreground: colors.markdownLinkText, underline: true },
    },
    {
      scope: ["markup.link.url"],
      style: { foreground: colors.markdownLink, underline: true },
    },

    // Strikethrough and underline
    {
      scope: ["markup.strikethrough"],
      style: { foreground: colors.textMuted },
    },
    {
      scope: ["markup.underline"],
      style: { foreground: colors.text, underline: true },
    },

    // Labels and references
    {
      scope: ["label"],
      style: { foreground: colors.markdownLinkText },
    },

    // Spell/nospell (for text content)
    {
      scope: ["spell", "nospell"],
      style: { foreground: colors.markdownText },
    },

    // Conceal (syntax characters to hide)
    {
      scope: ["conceal"],
      style: { foreground: colors.textMuted },
    },

    // Code syntax highlighting (for fenced code blocks)
    {
      scope: ["comment"],
      style: { foreground: colors.syntaxComment, italic: true },
    },
    {
      scope: ["keyword"],
      style: { foreground: colors.syntaxKeyword, italic: true },
    },
    {
      scope: ["keyword.function", "function.method"],
      style: { foreground: colors.syntaxFunction },
    },
    {
      scope: ["string", "symbol"],
      style: { foreground: colors.syntaxString },
    },
    {
      scope: ["number", "boolean"],
      style: { foreground: colors.syntaxNumber },
    },
    {
      scope: ["variable", "variable.parameter"],
      style: { foreground: colors.syntaxVariable },
    },
    {
      scope: ["variable.member", "function", "constructor"],
      style: { foreground: colors.syntaxFunction },
    },
    {
      scope: ["type", "module"],
      style: { foreground: colors.syntaxType },
    },
    {
      scope: ["operator", "keyword.operator"],
      style: { foreground: colors.syntaxOperator },
    },
    {
      scope: ["punctuation", "punctuation.bracket"],
      style: { foreground: colors.syntaxPunctuation },
    },
  ];
}

interface ThemeContextValue {
  colors: ThemeColors;
  syntax: SyntaxStyle;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => {
    const syntax = SyntaxStyle.fromTheme(getSyntaxRules(themeColors));
    return {
      colors: themeColors,
      syntax,
    };
  }, []);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
