import type { CardSpec, Grade } from "@re/core"
import type { QueueItem } from "../services/ReviewQueue"
import { theme } from "../theme"
import { Panel, Hint } from "./ui"

interface CardRendererProps {
  queueItem: QueueItem
  cardSpec: CardSpec<Grade>
  isRevealed: boolean
}

export function CardRenderer({
  queueItem,
  cardSpec,
  isRevealed,
}: CardRendererProps) {
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.textMuted}>
        {queueItem.deckName} · Card {queueItem.cardIndex + 1}
      </text>

      <Panel>
        <box flexDirection="column">
          <text fg={theme.text}>{cardSpec.prompt}</text>
        </box>
      </Panel>

      {isRevealed && (
        <Panel accent>
          <box flexDirection="column">
            <text fg={theme.success}>{cardSpec.reveal}</text>
          </box>
        </Panel>
      )}

      {!isRevealed && <Hint>Press space to reveal answer</Hint>}
    </box>
  )
}
