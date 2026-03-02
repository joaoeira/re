import type { CardContent as ReviewCardContent } from "@/machines/desktopReviewSession";

import { MarkdownRenderer } from "@/components/markdown-renderer";

type CardContentProps = {
  readonly card: ReviewCardContent;
  readonly deckName: string;
  readonly isRevealed: boolean;
};

function formatDeckLabel(deckName: string): string {
  return deckName.replace(/[-_]/g, " ").toUpperCase();
}

export function CardContent({ card, deckName, isRevealed }: CardContentProps) {
  if (card.cardType === "cloze") {
    return (
      <div className="mx-auto w-full max-w-[70ch]">
        <p className="mb-4 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/40">
          {formatDeckLabel(deckName)}
        </p>
        <MarkdownRenderer content={isRevealed ? card.reveal : card.prompt} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[70ch]">
      <p className="mb-4 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/40">
        {formatDeckLabel(deckName)}
      </p>
      <MarkdownRenderer content={card.prompt} />
      {isRevealed && (
        <>
          <hr className="my-8 border-border" />
          <MarkdownRenderer content={card.reveal} />
        </>
      )}
    </div>
  );
}
