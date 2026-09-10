import { useMemo, type ReactNode } from "react";
import type { StyleDesc } from "@gpuix/react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Nodes, Root, Definition, Paragraph } from "mdast";
import { MediaView } from "./card-media-view";
import { InlineParagraph } from "./card-inline";
import { cardsPath } from "./storage";
import { cardTheme, cardTypography, colors, column } from "./theme";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const stack: StyleDesc = { ...column, gap: 12, flexShrink: 0 };

function flowDiagramLines(node: Paragraph, source: string) {
  const lines = source.split(/\r?\n/);
  // An explicit vertical flow, not an arbitrary soft-wrapped paragraph. Only
  // top-level paragraphs are candidates; lists and fenced code keep Markdown's
  // semantics. Do not split emphasis, links, code or math spanning source lines.
  if (
    lines.length < 3 ||
    lines.length % 2 === 0 ||
    node.children.some(
      (child) =>
        child.type !== "text" &&
        child.type !== "break" &&
        child.position?.start.line !== child.position?.end.line,
    ) ||
    !lines.every((line, index) =>
      index % 2 === 0 ? /^\S/.test(line) : /^[ \t]+[↓↑↕⇓⇑⇕](?:[ \t]|$)/u.test(line),
    )
  )
    return undefined;
  return lines.map((line) => {
    const whitespace = line.match(/^[ \t]*/)![0];
    // Markdown tab stops are four columns; preserve mixed tabs/spaces too.
    let indent = 0;
    for (const character of whitespace) indent += character === "\t" ? 4 - (indent % 4) : 1;
    return { indent, content: line.slice(whitespace.length) };
  });
}

function special(node: Nodes): boolean {
  return (
    node.type === "image" ||
    node.type === "imageReference" ||
    node.type === "math" ||
    node.type === "inlineMath" ||
    (node.type === "code" && (node.lang === "math" || node.lang === "latex")) ||
    ("children" in node && node.children.some(special))
  );
}

export function CardMarkdown({
  source,
  deckPath = cardsPath,
  testId,
}: {
  source: string;
  deckPath?: string;
  testId?: string;
}) {
  const tree = useMemo(() => parser.parse(source) as Root, [source]);
  const definitions = new Map<string, Definition>();
  for (const node of tree.children)
    if (node.type === "definition") definitions.set(node.identifier.toLowerCase(), node);
  const raw = (node: Nodes) => source.slice(node.position?.start.offset, node.position?.end.offset);
  const definitionSource = [...definitions.values()].map(raw).join("\n");
  const diagrams = new Map(
    tree.children
      .filter((node): node is Paragraph => node.type === "paragraph")
      .map((node) => [node, flowDiagramLines(node, raw(node))] as const),
  );

  function block(node: Nodes): ReactNode {
    const key = node.position?.start.offset;
    if (node.type === "definition") return null;
    const diagram = node.type === "paragraph" ? diagrams.get(node) : undefined;
    if (diagram)
      return (
        <div key={key} style={{ ...column, flexShrink: 0 }}>
          {diagram.map((line, index) => (
            <div key={index} style={{ display: "flex", flexDirection: "row" }}>
              {line.indent > 0 && (
                <text
                  style={{
                    fontFamily: cardTypography.fontFamily,
                    fontSize: cardTypography.fontSize,
                    lineHeight: cardTypography.lineHeight,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {"\u00a0".repeat(line.indent)}
                </text>
              )}
              <div style={{ ...column, flexGrow: 1, minWidth: 0 }}>
                <CardMarkdown
                  source={`${line.content}\n\n${definitionSource}`}
                  deckPath={deckPath}
                />
              </div>
            </div>
          ))}
        </div>
      );
    if (!special(node))
      return (
        <markdown key={key} source={`${raw(node)}\n\n${definitionSource}`} theme={cardTheme} />
      );
    if (
      node.type === "math" ||
      (node.type === "code" && (node.lang === "math" || node.lang === "latex"))
    )
      return (
        <div key={key} style={{ ...stack, alignItems: "center" }}>
          <MediaView source={node.value} formula display deckPath={deckPath} />
        </div>
      );
    if (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell") {
      const heading = node.type === "heading" ? Math.min(node.depth - 1, 3) : undefined;
      return (
        <InlineParagraph
          key={key}
          nodes={node.children}
          definitions={definitions}
          deckPath={deckPath}
          fontSize={
            heading === undefined ? cardTypography.fontSize : cardTypography.headingSizes[heading]!
          }
          lineHeight={
            heading === undefined
              ? cardTypography.lineHeight
              : cardTypography.headingLineHeights[heading]!
          }
          bold={heading !== undefined}
        />
      );
    }
    if (node.type === "list")
      return (
        <div key={key} style={stack}>
          {node.children.map((item, i) => (
            <div
              key={item.position?.start.offset}
              style={{ display: "flex", flexDirection: "row", gap: 10 }}
            >
              <text
                style={{
                  color: colors.text,
                  fontFamily: cardTypography.fontFamily,
                  fontSize: cardTypography.fontSize,
                  lineHeight: cardTypography.lineHeight,
                }}
              >
                {node.ordered ? `${(node.start ?? 1) + i}.` : "•"}
              </text>
              <div style={{ ...stack, flexGrow: 1, minWidth: 0 }}>{item.children.map(block)}</div>
            </div>
          ))}
        </div>
      );
    if (node.type === "table")
      return (
        <div key={key} style={stack}>
          {node.children.map((row) => (
            <div
              key={row.position?.start.offset}
              style={{ display: "flex", flexDirection: "row", gap: 12 }}
            >
              {row.children.map((cell) => (
                <div
                  key={cell.position?.start.offset}
                  style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}
                >
                  {block(cell)}
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    if ("children" in node)
      return (
        <div
          key={key}
          style={{
            ...stack,
            ...(node.type === "blockquote"
              ? { borderLeftWidth: 2, borderColor: colors.quote, paddingLeft: 12 }
              : {}),
          }}
        >
          {node.children.map(block)}
        </div>
      );
    return (
      <text key={key} style={{ color: colors.text, fontSize: cardTypography.fontSize }}>
        {"value" in node ? node.value : raw(node)}
      </text>
    );
  }
  return (
    <div testId={testId} style={stack}>
      {tree.children.map(block)}
    </div>
  );
}
