import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import { cn } from "@/lib/utils";
import { DESKTOP_ASSET_URL_SCHEME } from "@shared/lib/asset-url";

import "highlight.js/styles/github.css";

type MarkdownRendererProps = {
  readonly content: string;
  readonly className?: string;
};

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("review-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        urlTransform={(url) =>
          url.startsWith(`${DESKTOP_ASSET_URL_SCHEME}:`) ? url : defaultUrlTransform(url)
        }
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
