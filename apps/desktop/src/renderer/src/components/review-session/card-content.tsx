import type { CardContent as ReviewCardContent } from "@/machines/desktopReviewSession";

import { MarkdownRenderer } from "@/components/markdown-renderer";

type CardContentProps = {
  readonly card: ReviewCardContent;
  readonly isRevealed: boolean;
};

export function CardContent({ card, isRevealed }: CardContentProps) {
  if (card.cardType === "cloze") {
    return (
      <div className="mx-auto w-full max-w-[70ch]">
        <MarkdownRenderer content={isRevealed ? card.reveal : card.prompt} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[70ch]">
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
