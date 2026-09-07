import { useEffect, useMemo, useState } from "react";
import type { Definition, Nodes } from "mdast";
import { mediaScale, renderFormula, type Formula } from "./card-media";
import { MediaView } from "./card-media-view";
import { textBaseline } from "./panel";
import { toErrorMessage } from "./error-message";
import { onSettled } from "./on-settled";
import { cardTypography, colors } from "./theme";

type TextStyle = { bold?: boolean; italic?: boolean; code?: boolean; link?: boolean };
type Run = TextStyle &
  (
    | { type: "text"; value: string }
    | { type: "math"; value: string }
    | { type: "image"; value: string }
  );
type Word = Run[];

function fontFamily(run: TextStyle): string {
  if (run.code) return "Menlo";
  if (run.bold && run.italic) return "Helvetica-BoldOblique";
  if (run.bold) return "Helvetica-Bold";
  if (run.italic) return "Helvetica-Oblique";
  return cardTypography.fontFamily;
}

// Break at source whitespace, never at a markup boundary. In particular, the
// comma in `$x$,` and the suffix in `pre**fix**` must travel with their word.
function inlineLines(
  nodes: Nodes[],
  definitions: Map<string, Definition>,
  bold: boolean,
): Word[][] {
  const lines: Word[][] = [[]];
  let word: Word = [];
  const append = (run: Run) => word.push(run);
  const finish = () => {
    if (word.length) lines[lines.length - 1]!.push(word);
    word = [];
  };
  function visit(node: Nodes, style: TextStyle) {
    if (node.type === "break") {
      finish();
      lines.push([]);
    } else if (node.type === "text" || node.type === "inlineCode") {
      for (const part of node.value.split(/(\s+)/).filter(Boolean)) {
        if (/^\s+$/.test(part)) {
          if (word.length) append({ ...style, type: "text", value: "\u00a0" });
          finish();
        } else append({ ...style, code: node.type === "inlineCode", type: "text", value: part });
      }
    } else if (node.type === "inlineMath") {
      append({ ...style, type: "math", value: node.value });
    } else if (node.type === "image" || node.type === "imageReference") {
      const url =
        node.type === "image" ? node.url : definitions.get(node.identifier.toLowerCase())?.url;
      append({
        ...style,
        type: url ? "image" : "text",
        value: url ?? node.alt ?? "Image reference missing",
      });
    } else if ("children" in node) {
      for (const child of node.children)
        visit(child, {
          ...style,
          bold: style.bold || node.type === "strong",
          italic: style.italic || node.type === "emphasis",
          link: style.link || node.type === "link" || node.type === "linkReference",
        });
    } else if ("value" in node) append({ ...style, type: "text", value: node.value });
  }
  for (const node of nodes) visit(node, { bold });
  finish();
  return lines;
}

type FormulaResult = Formula | string;
export function InlineParagraph({
  nodes,
  definitions,
  deckPath,
  fontSize,
  lineHeight,
  bold = false,
}: {
  nodes: Nodes[];
  definitions: Map<string, Definition>;
  deckPath: string;
  fontSize: number;
  lineHeight: number;
  bold?: boolean;
}) {
  const lines = useMemo(() => inlineLines(nodes, definitions, bold), [nodes, definitions, bold]);
  const runs = lines.flat(2);
  const formulaKey = JSON.stringify([
    fontSize,
    [...new Set(runs.filter((r) => r.type === "math").map((r) => r.value))],
  ]);
  const [loaded, setLoaded] = useState<{ key: string; formulas: Map<string, FormulaResult> }>();
  useEffect(() => {
    const [size, sources] = JSON.parse(formulaKey) as [number, string[]];
    return onSettled(
      Promise.all(
        sources.map(
          async (source) =>
            [source, await renderFormula(source, false, size).catch(toErrorMessage)] as const,
        ),
      ).then((entries) => ({ key: formulaKey, formulas: new Map(entries) })),
      setLoaded,
    );
  }, [formulaKey]);
  const formulas = loaded?.key === formulaKey ? loaded.formulas : new Map<string, FormulaResult>();
  // Taffy does not receive text baselines from GPUI. Align the bottom edges of
  // explicitly padded line boxes instead, using real font and SVG metrics.
  const descent = Math.max(
    lineHeight - textBaseline(cardTypography.fontFamily, fontSize, lineHeight),
    ...runs.map((run) => lineHeight - textBaseline(fontFamily(run), fontSize, lineHeight)),
    ...[...formulas.values()].map((result) =>
      typeof result === "string" ? 0 : (result.height - result.baseline) * mediaScale(result, 200),
    ),
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      {lines.map((words, lineIndex) => (
        <div
          key={lineIndex}
          style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "flex-end",
            minHeight: lineHeight,
          }}
        >
          {words.map((word, wordIndex) => (
            <div
              key={wordIndex}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "flex-end",
                flexShrink: 0,
                maxWidth: "100%",
              }}
            >
              {word.map((run, runIndex) => {
                const family = fontFamily(run);
                const baseline = textBaseline(family, fontSize, lineHeight);
                if (run.type === "image")
                  return <MediaView key={runIndex} source={run.value} deckPath={deckPath} />;
                const result = run.type === "math" ? formulas.get(run.value) : undefined;
                if (result && typeof result !== "string") {
                  const scale = mediaScale(result, 200);
                  return (
                    <img
                      key={runIndex}
                      src={result.path}
                      objectFit="contain"
                      style={{
                        width: result.width * scale,
                        height: result.height * scale,
                        flexShrink: 0,
                        marginTop: Math.max(0, baseline - result.baseline * scale),
                        marginBottom: descent - (result.height - result.baseline) * scale,
                      }}
                    />
                  );
                }
                return (
                  <text
                    key={runIndex}
                    style={{
                      fontFamily: family,
                      fontSize,
                      lineHeight,
                      fontWeight: run.bold ? 600 : 400,
                      color:
                        typeof result === "string"
                          ? colors.error
                          : run.link
                            ? colors.link
                            : colors.text,
                      backgroundColor: run.code ? "#ffffff10" : undefined,
                      marginBottom: descent - (lineHeight - baseline),
                    }}
                  >
                    {run.type === "math"
                      ? typeof result === "string"
                        ? `LaTeX: ${run.value} — ${result}`
                        : "…"
                      : run.value}
                  </text>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
