import { CardMarkdown } from "../card-markdown";
import { colors, column, font, row } from "../theme";
import { Action } from "../ui/action";

export interface PreviewScreenProps {
  readonly cards: readonly { readonly question: string; readonly answer: string }[];
  readonly index: number;
  readonly deckPath?: string;
  readonly onEdit: () => void;
  readonly onIndexChange: (index: number) => void;
}

export function PreviewScreen({
  cards,
  index,
  deckPath,
  onEdit,
  onIndexChange,
}: PreviewScreenProps) {
  const card = cards[index]!;
  return (
    <div
      style={{
        ...column,
        flexGrow: 1,
        minHeight: 0,
        overflowY: "scroll",
        padding: 30,
        gap: 16,
      }}
    >
      <text style={{ color: colors.muted, fontSize: font.body }}>
        {`Card Preview ${index + 1}/${cards.length}`}
      </text>
      <CardMarkdown source={card.question} deckPath={deckPath} />
      <div style={{ height: 1, backgroundColor: colors.line }} />
      <CardMarkdown source={card.answer} deckPath={deckPath} />
      <div style={row}>
        <Action label="Edit Card" keys="⌘ P" onClick={onEdit} />
        {index > 0 && (
          <Action label="Previous" keys="⌥ ←" onClick={() => onIndexChange(index - 1)} />
        )}
        {index < cards.length - 1 && (
          <Action label="Next" keys="⌥ →" onClick={() => onIndexChange(index + 1)} />
        )}
      </div>
    </div>
  );
}
