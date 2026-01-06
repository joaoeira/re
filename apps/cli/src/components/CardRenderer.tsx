import type { CardSpec, Grade } from "@re/core";
import type { QueueItem } from "../services/ReviewQueue";
import { useTheme } from "../ThemeContext";
import { Panel, Hint } from "./ui";
import { RGBA } from "@opentui/core";

interface CardRendererProps {
  queueItem: QueueItem;
  cardSpec: CardSpec<Grade>;
  isRevealed: boolean;
}

export function CardRenderer({
  queueItem,
  cardSpec,
  isRevealed,
}: CardRendererProps) {
  const { colors, syntax } = useTheme();

  return (
    <box flexDirection="column" gap={1}>
      <text fg={colors.textMuted}>
        {queueItem.deckName} · Card {queueItem.cardIndex + 1}
      </text>

      <Panel>
        <box flexDirection="column">
          <code
            filetype="markdown"
            content={cardSpec.prompt}
            syntaxStyle={syntax}
            conceal={true}
            drawUnstyledText={true}
            streaming={false}
            fg={RGBA.fromHex(colors.text)}
          />
        </box>
      </Panel>

      {isRevealed && (
        <Panel accent>
          <box flexDirection="column">
            <code
              filetype="markdown"
              content={cardSpec.reveal}
              syntaxStyle={syntax}
              conceal={true}
              drawUnstyledText={true}
              streaming={false}
              fg={RGBA.fromHex(colors.success)}
            />
          </box>
        </Panel>
      )}

      {!isRevealed && <Hint>Press space to reveal answer</Hint>}
    </box>
  );
}
