import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { StyleDesc } from "@gpuix/react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Nodes, Root, Definition } from "mdast";
import { loadImage, renderFormula, type Media } from "./card-media";
import { toErrorMessage } from "./error-message";
import { onSettled } from "./on-settled";
import { cardsPath } from "./storage";
import { colors, column, editorTheme } from "./theme";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const stack: StyleDesc = { ...column, gap: 12, flexShrink: 0 };

function MediaView({
  source,
  deckPath,
  formula,
  display = false,
}: {
  source: string;
  deckPath: string;
  formula?: boolean;
  display?: boolean;
}) {
  const [result, setResult] = useState<Media | string | null>(null);
  useEffect(() => {
    setResult(null);
    const operation = formula ? renderFormula(source, display) : loadImage(source, deckPath);
    return onSettled(
      operation.then((media) => media, toErrorMessage),
      setResult,
    );
  }, [source, deckPath, formula, display]);
  if (typeof result === "string")
    return (
      <text style={{ color: colors.error, fontSize: 13 }}>
        {formula ? `LaTeX: ${source}` : `Image unavailable: ${source}`} — {result}
      </text>
    );
  if (!result)
    return (
      <text style={{ color: colors.muted, fontSize: 13 }}>{formula ? "…" : "Loading image…"}</text>
    );
  const scale = Math.min(1, 500 / result.width, (formula ? 200 : 250) / result.height);
  return (
    <img
      src={result.path}
      objectFit="contain"
      style={{
        width: result.width * scale,
        height: result.height * scale,
        maxWidth: "100%",
        flexShrink: 0,
        marginTop: 3,
        marginBottom: 3,
      }}
    />
  );
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

  function inline(node: Nodes, style: StyleDesc = {}): ReactNode {
    const key = node.position?.start.offset;
    if (node.type === "inlineMath")
      return <MediaView key={key} source={node.value} formula deckPath={deckPath} />;
    if (node.type === "image" || node.type === "imageReference") {
      const url =
        node.type === "image" ? node.url : definitions.get(node.identifier.toLowerCase())?.url;
      return url ? (
        <MediaView key={key} source={url} deckPath={deckPath} />
      ) : (
        <text key={key}>{node.alt || "Image reference missing"}</text>
      );
    }
    if (node.type === "break") return <div key={key} style={{ width: "100%", height: 1 }} />;
    if (node.type === "text" || node.type === "inlineCode") {
      // Word-sized runs let GPUI's flex layout wrap around inline formula images.
      const words = node.value.split(/(\s+)/).filter(Boolean);
      return (
        <Fragment key={key}>
          {words.map((word, i) => (
            <text
              key={i}
              style={{
                color: colors.text,
                fontSize: 18,
                lineHeight: 26,
                ...style,
                ...(node.type === "inlineCode"
                  ? { fontFamily: "Menlo", backgroundColor: "#ffffff10" }
                  : {}),
              }}
            >
              {/^\s+$/.test(word) ? "\u00a0" : word}
            </text>
          ))}
        </Fragment>
      );
    }
    if ("children" in node)
      return (
        <Fragment key={key}>
          {node.children.map((child) =>
            inline(child, {
              ...style,
              ...(node.type === "strong" ? { fontWeight: 700 } : {}),
              ...(node.type === "emphasis" ? { fontFamily: "Helvetica Oblique" } : {}),
              ...(node.type === "link" ? { color: colors.link } : {}),
            }),
          )}
        </Fragment>
      );
    return (
      <text key={key} style={{ color: colors.text, fontSize: 18 }}>
        {"value" in node ? node.value : raw(node)}
      </text>
    );
  }

  function block(node: Nodes): ReactNode {
    const key = node.position?.start.offset;
    if (node.type === "definition") return null;
    if (!special(node))
      return (
        <markdown
          key={key}
          source={`${raw(node)}\n\n${[...definitions.values()].map(raw).join("\n")}`}
          theme={editorTheme}
        />
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
    if (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell")
      return (
        <div
          key={key}
          style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            rowGap: 3,
          }}
        >
          {node.children.map((child) =>
            inline(
              child,
              node.type === "heading" ? { fontSize: 26 - node.depth * 2, fontWeight: 700 } : {},
            ),
          )}
        </div>
      );
    if (node.type === "list")
      return (
        <div key={key} style={stack}>
          {node.children.map((item, i) => (
            <div
              key={item.position?.start.offset}
              style={{ display: "flex", flexDirection: "row", gap: 10 }}
            >
              <text style={{ color: colors.text, fontSize: 18 }}>
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
              ? { borderLeftWidth: 2, borderColor: "#ffffff44", paddingLeft: 12 }
              : {}),
          }}
        >
          {node.children.map(block)}
        </div>
      );
    return inline(node);
  }
  return (
    <div testId={testId} style={stack}>
      {tree.children.map(block)}
    </div>
  );
}
