import { CardMarkdown } from "../card-markdown";
import { column, divider, layout } from "../theme";
import { scroller } from "./create-screen";

export const cardContent = {
  ...column,
  paddingLeft: layout.contentLeft,
  paddingRight: layout.contentRight,
  paddingTop: layout.cardTop,
  paddingBottom: 24,
  gap: 24,
} as const;

export interface PreviewScreenProps {
  readonly cards: readonly { readonly question: string; readonly answer: string }[];
  readonly index: number;
  readonly deckPath?: string;
}

export function PreviewScreen({ cards, index, deckPath }: PreviewScreenProps) {
  const card = cards[index]!;
  return (
    <div style={scroller}>
      <div style={cardContent}>
        <CardMarkdown source={card.question} deckPath={deckPath} />
        <div style={divider} />
        <CardMarkdown source={card.answer} deckPath={deckPath} />
      </div>
    </div>
  );
}
