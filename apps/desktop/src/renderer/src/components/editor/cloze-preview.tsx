import type { ReactNode } from "react";

type ClozePreviewProps = {
  readonly content: string;
};

const CLOZE_PATTERN = /(\{\{c\d+::[\s\S]*?\}\})/;
const CLOZE_PARSE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/;

export function ClozePreview({ content }: ClozePreviewProps) {
  const parts = content.split(CLOZE_PATTERN);
  if (parts.length === 1) return null;

  const rendered: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const match = CLOZE_PARSE.exec(part);
    if (match) {
      rendered.push(
        <span key={i} className="border border-dashed border-muted-foreground/20 bg-muted/30 px-1">
          {match[2]}
          {match[3] && (
            <span className="ml-1 text-[10px] text-muted-foreground/50">&middot; {match[3]}</span>
          )}
        </span>,
      );
    } else if (part) {
      rendered.push(<span key={i}>{part}</span>);
    }
  }

  return <div className="text-xs leading-6 text-muted-foreground">{rendered}</div>;
}
