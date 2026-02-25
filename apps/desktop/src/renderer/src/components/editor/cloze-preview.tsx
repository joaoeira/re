import type { ReactNode } from "react";
import { parseClozeDeletions } from "@re/core";

type ClozePreviewProps = {
  readonly content: string;
};

export function ClozePreview({ content }: ClozePreviewProps) {
  const deletions = parseClozeDeletions(content);
  if (deletions.length === 0) return null;

  const rendered: ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < deletions.length; i++) {
    const deletion = deletions[i]!;
    const before = content.slice(cursor, deletion.start);
    if (before) {
      rendered.push(<span key={`text-${i}-${cursor}`}>{before}</span>);
    }

    rendered.push(
      <span
        key={`cloze-${i}-${deletion.start}`}
        className="border border-dashed border-muted-foreground/20 bg-muted/30 px-1"
      >
        {deletion.hidden}
        {deletion.hint && (
          <span className="ml-1 text-[10px] text-muted-foreground/50">
            &middot; {deletion.hint}
          </span>
        )}
      </span>,
    );

    cursor = deletion.end;
  }

  const trailing = content.slice(cursor);
  if (trailing) {
    rendered.push(<span key={`text-tail-${cursor}`}>{trailing}</span>);
  }

  return <div className="text-xs leading-6 text-muted-foreground">{rendered}</div>;
}
