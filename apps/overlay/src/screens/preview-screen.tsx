import { CardMarkdown } from "../card-markdown";
import { column, divider, layout } from "../theme";

export const cardBody = {
  ...column,
  flexGrow: 1,
  minHeight: 0,
  overflowY: "scroll",
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
    <div style={cardBody}>
      <CardMarkdown source={card.question} deckPath={deckPath} scale="prompt" />
      <div style={divider} />
      <CardMarkdown source={card.answer} deckPath={deckPath} scale="reveal" />
    </div>
  );
}
