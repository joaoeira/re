import type { CardSpec, Grade } from "@re/core";
import type { QueueItem } from "@re/workspace";
import { useTheme } from "../ThemeContext";
import { Panel, Hint } from "./ui";
import { RGBA } from "@opentui/core";
import { Match } from "effect";

interface CardRendererProps {
  queueItem: QueueItem;
  cardSpec: CardSpec<Grade>;
  isRevealed: boolean;
}

export function CardRenderer({ queueItem, cardSpec, isRevealed }: CardRendererProps) {
  const { colors, syntax } = useTheme();

  const renderCard = Match.value(cardSpec.cardType).pipe(
    Match.when("cloze", () => (
      <Panel>
        <box flexDirection="column">
          <code
            filetype="markdown"
            content={isRevealed ? cardSpec.reveal : cardSpec.prompt}
            syntaxStyle={syntax}
            conceal={true}
            drawUnstyledText={true}
            streaming={false}
            fg={RGBA.fromHex(colors.text)}
          />
        </box>
      </Panel>
    )),
    Match.orElse(() => (
      <>
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
      </>
    )),
  );

  return (
    <box flexDirection="column" gap={1}>
      <text fg={colors.textMuted}>{queueItem.relativePath}</text>

      {renderCard}

      {!isRevealed && <Hint>Press space to reveal answer</Hint>}
    </box>
  );
}
