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

Regular paragraph text with **bold text** and *italic text* mixed in.

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

      <box marginTop={2} flexDirection="column" gap={1}>
        <text fg={colors.textMuted}>Color Reference:</text>
        <box flexDirection="row" gap={3}>
          <text fg={colors.markdownHeading}>Heading</text>
          <text fg={colors.markdownStrong}>Strong</text>
          <text fg={colors.markdownEmph}>Emphasis</text>
          <text fg={colors.markdownCode}>Code</text>
        </box>
        <box flexDirection="row" gap={3}>
          <text fg={colors.markdownLink}>Link</text>
          <text fg={colors.markdownBlockQuote}>Quote</text>
          <text fg={colors.markdownListItem}>List</text>
          <text fg={colors.success}>Checked</text>
        </box>
      </box>
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(
  <ThemeProvider>
    <ThemePreview />
  </ThemeProvider>
);
