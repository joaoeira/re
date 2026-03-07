import { Extension, InputRule } from "@tiptap/react";
import type { NodeType } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block";
import type StateInline from "markdown-it/lib/rules_inline/state_inline";
import {
  MathView,
  mathBackspaceCmd,
  mathPlugin,
  REGEX_BLOCK_MATH_DOLLARS,
  REGEX_INLINE_MATH_DOLLARS_ESCAPED,
} from "@benrbray/prosemirror-math";
import katex from "katex";
import { replaceClozeDeletions } from "@re/core";

const preprocessClozeForKatex = (tex: string): string =>
  replaceClozeDeletions(tex, (d) => `[${d.hidden}]`);

const originalRenderMath = MathView.prototype.renderMath;

if (typeof originalRenderMath === "function") {
  MathView.prototype.renderMath = function (this: MathView) {
    const self = this as unknown as {
      _node: { content: { firstChild: { textContent: string } | null } };
      _mathRenderElt: HTMLElement | undefined;
      _katexOptions: katex.KatexOptions;
    };

    if (!("_mathRenderElt" in self) || !("_node" in self) || !("_katexOptions" in self)) {
      originalRenderMath.call(this);
      return;
    }

    if (!self._mathRenderElt) return;

    const firstChild = self._node.content.firstChild;
    const texString = firstChild ? firstChild.textContent.trim() : "";

    if (texString.length < 1) {
      this.dom.classList.add("empty-math");
      while (self._mathRenderElt.firstChild) {
        self._mathRenderElt.firstChild.remove();
      }
      return;
    }

    this.dom.classList.remove("empty-math");

    try {
      katex.render(preprocessClozeForKatex(texString), self._mathRenderElt, self._katexOptions);
      self._mathRenderElt.classList.remove("parse-error");
      this.dom.setAttribute("title", "");
    } catch (err) {
      self._mathRenderElt.classList.add("parse-error");
      this.dom.setAttribute("title", String(err));
    }
  };
}

const DOLLAR_SIGN = "$".charCodeAt(0);
const BACKSLASH = "\\".charCodeAt(0);
const NEW_LINE = "\n".charCodeAt(0);

type MarkdownItWithMath = MarkdownIt & {
  __reProseMirrorMathInstalled?: boolean;
};

const trimEdgeBlankLines = (content: string): string => content.replace(/^\n+|\n+$/g, "");

const hasOddNumberOfBackslashesBefore = (content: string, index: number): boolean => {
  let backslashCount = 0;
  let cursor = index - 1;

  while (cursor >= 0 && content.charCodeAt(cursor) === BACKSLASH) {
    backslashCount += 1;
    cursor -= 1;
  }

  return backslashCount % 2 === 1;
};

const selectPreviousMathNode = (
  state: EditorState,
  dispatch?: ((transaction: Transaction) => void) | undefined,
): boolean => {
  const { $from } = state.selection;
  const nodeBefore = $from.nodeBefore;

  if (
    !nodeBefore ||
    (nodeBefore.type.name !== "math_inline" && nodeBefore.type.name !== "math_display")
  ) {
    return false;
  }

  const index = $from.index($from.depth);
  const beforePosition = state.doc.resolve($from.posAtIndex(index - 1));

  dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, beforePosition.pos)));
  return true;
};

const createInlineMathInputRule = (nodeType: NodeType): InputRule =>
  new InputRule({
    find: REGEX_INLINE_MATH_DOLLARS_ESCAPED,
    handler: ({ state, range, match }) => {
      const mathContent = match[1];
      if (!mathContent) {
        return null;
      }

      const { from, to } = range;
      const $from = state.doc.resolve(from);
      const $to = state.doc.resolve(to);
      const index = $from.index();

      if (!$from.parent.canReplaceWith(index, $to.index(), nodeType)) {
        return null;
      }

      state.tr.replaceRangeWith(from, to, nodeType.create(null, state.schema.text(mathContent)));
    },
  });

const createBlockMathInputRule = (nodeType: NodeType): InputRule =>
  new InputRule({
    find: REGEX_BLOCK_MATH_DOLLARS,
    handler: ({ state, range }) => {
      const { from, to } = range;
      const $start = state.doc.resolve(from);

      if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), nodeType)) {
        return null;
      }

      const transaction = state.tr.delete(from, to).setBlockType(from, from, nodeType);
      transaction.setSelection(
        NodeSelection.create(transaction.doc, transaction.mapping.map($start.pos - 1)),
      );
    },
  });

const parseInlineMath = (state: StateInline, silent: boolean): boolean => {
  if (state.src.charCodeAt(state.pos) !== DOLLAR_SIGN) {
    return false;
  }

  if (state.src.charCodeAt(state.pos + 1) === DOLLAR_SIGN) {
    return false;
  }

  const nextChar = state.src.charCodeAt(state.pos + 1);
  if (Number.isNaN(nextChar) || nextChar === NEW_LINE) {
    return false;
  }

  let end = state.pos + 1;
  while (end < state.posMax) {
    const code = state.src.charCodeAt(end);

    if (code === NEW_LINE) {
      return false;
    }

    if (code === DOLLAR_SIGN && !hasOddNumberOfBackslashesBefore(state.src, end)) {
      break;
    }

    end += 1;
  }

  if (end >= state.posMax || end === state.pos + 1) {
    return false;
  }

  if (!silent) {
    const token = state.push("math_inline", "math-inline", 0);
    token.content = state.src.slice(state.pos + 1, end);
  }

  state.pos = end + 1;
  return true;
};

const parseBlockMath = (
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean => {
  const lineStart = state.bMarks[startLine];
  const lineShift = state.tShift[startLine];
  const lineEnd = state.eMarks[startLine];

  if (lineStart === undefined || lineShift === undefined || lineEnd === undefined) {
    return false;
  }

  const start = lineStart + lineShift;
  const max = lineEnd;
  const firstLine = state.src.slice(start, max);
  const trimmedFirstLine = firstLine.trim();

  if (!trimmedFirstLine.startsWith("$$")) {
    return false;
  }

  let content = "";
  let nextLine = startLine;
  const singleLineContent = trimmedFirstLine.slice(2, -2).trim();

  if (trimmedFirstLine.length >= 4 && trimmedFirstLine.endsWith("$$")) {
    content = singleLineContent;
  } else {
    const lines: string[] = [];
    const firstLineRemainder = firstLine.slice(firstLine.indexOf("$$") + 2);
    if (firstLineRemainder.trim().length > 0) {
      lines.push(firstLineRemainder);
    }

    let foundClosing = false;
    nextLine = startLine + 1;

    for (; nextLine < endLine; nextLine += 1) {
      const nextLineStart = state.bMarks[nextLine];
      const nextLineShift = state.tShift[nextLine];
      const nextLineEnd = state.eMarks[nextLine];

      if (nextLineStart === undefined || nextLineShift === undefined || nextLineEnd === undefined) {
        return false;
      }

      const line = state.src.slice(nextLineStart + nextLineShift, nextLineEnd);
      const trimmedLine = line.trim();

      if (trimmedLine === "$$") {
        foundClosing = true;
        break;
      }

      lines.push(line);
    }

    if (!foundClosing) {
      return false;
    }

    content = trimEdgeBlankLines(lines.join("\n"));
  }

  if (silent) {
    return true;
  }

  state.line = nextLine + 1;

  const token = state.push("math_display", "math-display", 0);
  token.block = true;
  token.content = content;
  token.map = [startLine, state.line];

  return true;
};

const setupMarkdownMath = (markdownIt: MarkdownIt): void => {
  const markdownItWithMath = markdownIt as MarkdownItWithMath;

  if (markdownItWithMath.__reProseMirrorMathInstalled) {
    return;
  }

  markdownItWithMath.__reProseMirrorMathInstalled = true;

  markdownIt.block.ruler.before("fence", "math_display", parseBlockMath, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  markdownIt.inline.ruler.after("escape", "math_inline", parseInlineMath);

  markdownIt.renderer.rules.math_inline = (tokens, index) => {
    const token = tokens[index];
    return `<math-inline class="math-node">${markdownIt.utils.escapeHtml(token?.content ?? "")}</math-inline>`;
  };

  markdownIt.renderer.rules.math_display = (tokens, index) => {
    const token = tokens[index];
    return `<math-display class="math-node">${markdownIt.utils.escapeHtml(token?.content ?? "")}</math-display>\n`;
  };
};

export const ProseMirrorMath = Extension.create({
  name: "prosemirrorMath",
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        selectPreviousMathNode(this.editor.state, this.editor.view.dispatch) ||
        mathBackspaceCmd(this.editor.state, this.editor.view.dispatch, this.editor.view),
    };
  },

  addProseMirrorPlugins() {
    return [mathPlugin];
  },

  addInputRules() {
    const inlineMathNode = this.editor.schema.nodes.math_inline;
    const blockMathNode = this.editor.schema.nodes.math_display;

    if (!inlineMathNode || !blockMathNode) {
      throw new Error("prosemirror-math requires math_inline and math_display nodes.");
    }

    return [createInlineMathInputRule(inlineMathNode), createBlockMathInputRule(blockMathNode)];
  },

  addStorage() {
    return {
      markdown: {
        parse: {
          setup(markdownIt: MarkdownIt) {
            setupMarkdownMath(markdownIt);
          },
        },
      },
    };
  },
});
