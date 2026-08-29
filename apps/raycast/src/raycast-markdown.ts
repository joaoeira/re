import { Path } from "@effect/platform";
import { resolveDeckImagePath } from "@re/workspace";
import type { Nodes } from "mdast";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { Data, Effect } from "effect";
import { unified } from "unified";

export class RaycastMarkdownTransformError extends Data.TaggedError(
  "RaycastMarkdownTransformError",
)<{
  readonly message: string;
}> {}

export interface DeckMarkdownContext {
  readonly rootPath: string;
  readonly deckPath: string;
}

export type MarkdownTransform<E = never, R = never> = (
  markdown: string,
) => Effect.Effect<string, E, R>;

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

const markdownParser = unified().use(remarkParse).use(remarkMath).freeze();
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const CURRENCY_AMOUNT_PATTERN = /^\$\d[\d,.]*(?:[kKmMbBtT])?\b/;

const startsWithCurrencyAmount = (markdown: string, dollarOffset: number): boolean =>
  CURRENCY_AMOUNT_PATTERN.test(markdown.slice(dollarOffset));

// remark-math pairs repeated currency markers as delimiters: "$150 ... $150".
const isCurrencyPairMisparsedAsInlineMath = (
  markdown: string,
  start: number,
  end: number,
): boolean =>
  startsWithCurrencyAmount(markdown, start) && startsWithCurrencyAmount(markdown, end - 1);

const escapeInlineMathDelimiters = (source: string): string => `\\${source.slice(0, -1)}\\$`;

const rewriteInlineMath = (markdown: string, tree: Nodes): string => {
  const replacements: Replacement[] = [];

  const visit = (node: Nodes): void => {
    if (node.type === "inlineMath") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;

      if (start !== undefined && end !== undefined) {
        const source = markdown.slice(start, end);

        if (isCurrencyPairMisparsedAsInlineMath(markdown, start, end)) {
          replacements.push({
            start,
            end,
            value: escapeInlineMathDelimiters(source),
          });
        } else if (
          source.startsWith("$") &&
          !source.startsWith("$$") &&
          source.endsWith("$") &&
          !source.endsWith("$$")
        ) {
          replacements.push({
            start,
            end,
            value: `\\(${source.slice(1, -1)}\\)`,
          });
        }
      }
    }

    if ("children" in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  visit(tree);
  replacements.sort((left, right) => right.start - left.start);

  let output = markdown;
  for (const replacement of replacements) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  }
  return output;
};

export const rewriteMathForRaycast = Effect.fn("RaycastMarkdown.rewriteMath")(function* (
  markdown: string,
) {
  return yield* Effect.try({
    try: () => rewriteInlineMath(markdown, markdownParser.parse(markdown)),
    catch: (cause) =>
      new RaycastMarkdownTransformError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
});

export const rewriteImagesForRaycast = (
  context: DeckMarkdownContext,
): MarkdownTransform<never, Path.Path> =>
  Effect.fn("RaycastMarkdown.rewriteImages")(function* (markdown: string) {
    let cursor = 0;
    let output = "";

    for (const match of markdown.matchAll(MARKDOWN_IMAGE_PATTERN)) {
      const index = match.index ?? 0;
      const fullMatch = match[0] ?? "";
      const altText = match[1] ?? "";
      const rawUrl = (match[2] ?? "").trim();

      output += markdown.slice(cursor, index);

      if (URI_SCHEME_PATTERN.test(rawUrl) || rawUrl.startsWith("//")) {
        output += fullMatch;
      } else {
        const resolved = yield* resolveDeckImagePath({
          rootPath: context.rootPath,
          deckPath: context.deckPath,
          imagePath: rawUrl,
        }).pipe(Effect.either);

        output +=
          resolved._tag === "Left"
            ? `![${altText}]()`
            : `![${altText}](${encodeURI(resolved.right.absolutePath)})`;
      }

      cursor = index + fullMatch.length;
    }

    output += markdown.slice(cursor);
    return output;
  });

export const prepareMarkdownForRaycast = (
  context: DeckMarkdownContext,
  markdown: string,
): Effect.Effect<string, RaycastMarkdownTransformError, Path.Path> =>
  Effect.succeed(markdown).pipe(
    Effect.flatMap(rewriteImagesForRaycast(context)),
    Effect.flatMap(rewriteMathForRaycast),
  );
