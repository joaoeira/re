#!/usr/bin/env bun
/**
 * Preview script for markdown theme colors.
 * Run with: bun run apps/cli/src/preview-theme.tsx
 */
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { RGBA } from "@opentui/core";

const sampleMarkdown = `# Heading 1
## Heading 2
### Heading 3

Regular paragraph text with ** text** and *italic text* mixed in.

Here is some \`inline code\` within a paragraph.

> This is a blockquote.
> It can span multiple lines.

- Unordered list item 1
- Unordered list item 2
  - Nested item
- Unordered list item 3

1. Ordered list item
2. Another ordered item

[Link text](https://example.com)

---

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`
}
\`\`\`

~~Strikethrough text~~

- [x] Completed task
- [ ] Incomplete task
`;

function ThemePreview() {
  const { colors, syntax } = useTheme();
  const renderer = useRenderer();

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy();
    }
  });

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <box flexDirection="row" gap={2} marginBottom={1}>
        <text fg={colors.accent}>◆</text>
        <text fg={colors.text}>Markdown Theme Preview</text>
      </box>

      <text fg={colors.textMuted} marginBottom={1}>
        Press q to quit
      </text>

      <box
        border={["left"]}
        borderColor={colors.primary}
        paddingLeft={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <code
          filetype="markdown"
          content={sampleMarkdown}
          syntaxStyle={syntax}
          conceal={true}
          drawUnstyledText={true}
          streaming={false}
          fg={RGBA.fromHex(colors.text)}
        />
      </box>

      {/* Text Colors */}
      <box marginTop={2} flexDirection="column" gap={1}>
        <text fg={colors.accent}>─── Text Colors ───</text>
        <box flexDirection="row" gap={4}>
          <text fg={colors.text}>text (main)</text>
          <text fg={colors.textMuted}>textMuted (secondary)</text>
          <text fg={colors.textSubtle}>textSubtle (disabled)</text>
        </box>
      </box>

      {/* Accent Colors */}
      <box marginTop={1} flexDirection="column" gap={1}>
        <text fg={colors.accent}>─── Accent Colors ───</text>
        <box flexDirection="row" gap={4}>
          <text fg={colors.accent}>accent (highlights)</text>
          <text fg={colors.accentSubtle}>accentSubtle (soft bg)</text>
          <text fg={colors.primary}>primary (interactive)</text>
        </box>
      </box>

      {/* Status Colors */}
      <box marginTop={1} flexDirection="column" gap={1}>
        <text fg={colors.accent}>─── Status Colors ───</text>
        <box flexDirection="row" gap={4}>
          <text fg={colors.success}>● success</text>
          <text fg={colors.warning}>● warning</text>
          <text fg={colors.error}>● error</text>
        </box>
      </box>

      {/* Card State Colors */}
      <box marginTop={1} flexDirection="column" gap={1}>
        <text fg={colors.accent}>─── Card States ───</text>
        <box flexDirection="row" gap={4}>
          <text fg={colors.cardNew}>◆ cardNew (new cards)</text>
          <text fg={colors.cardDue}>◆ cardDue (review)</text>
          <text fg={colors.cardLearning}>◆ cardLearning (learning)</text>
        </box>
      </box>

      {/* Border Colors */}
      <box marginTop={1} flexDirection="column" gap={1}>
        <text fg={colors.accent}>─── Border Colors ───</text>
        <box flexDirection="row" gap={4}>
          <text fg={colors.border}>border (default)</text>
          <text fg={colors.borderSubtle}>borderSubtle (subtle)</text>
          <text fg={colors.borderFocus}>borderFocus (focus state)</text>
        </box>
      </box>

      {/* Markdown Colors */}
      <box marginTop={1} flexDirection="column" gap={1}>
        <text fg={colors.accent}>─── Markdown Colors ───</text>
        <box flexDirection="row" gap={3}>
          <text fg={colors.markdownHeading}>Heading</text>
          <text fg={colors.markdownStrong}>Strong</text>
          <text fg={colors.markdownEmph}>Emphasis</text>
          <text fg={colors.markdownCode}>Code</text>
        </box>
        <box flexDirection="row" gap={3}>
          <text fg={colors.markdownLink}>Link</text>
          <text fg={colors.markdownLinkText}>LinkText</text>
          <text fg={colors.markdownBlockQuote}>Quote</text>
          <text fg={colors.markdownListItem}>ListItem</text>
        </box>
        <box flexDirection="row" gap={3}>
          <text fg={colors.markdownListEnumeration}>ListEnum</text>
          <text fg={colors.markdownHorizontalRule}>HrRule</text>
        </box>
      </box>

      {/* Syntax Colors */}
      <box marginTop={1} flexDirection="column" gap={1}>
        <text fg={colors.accent}>─── Syntax Colors ───</text>
        <box flexDirection="row" gap={3}>
          <text fg={colors.syntaxKeyword}>keyword</text>
          <text fg={colors.syntaxFunction}>function</text>
          <text fg={colors.syntaxVariable}>variable</text>
          <text fg={colors.syntaxString}>string</text>
        </box>
        <box flexDirection="row" gap={3}>
          <text fg={colors.syntaxNumber}>number</text>
          <text fg={colors.syntaxType}>type</text>
          <text fg={colors.syntaxOperator}>operator</text>
          <text fg={colors.syntaxComment}>comment</text>
        </box>
      </box>
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(
  <ThemeProvider>
    <ThemePreview />
  </ThemeProvider>,
);
