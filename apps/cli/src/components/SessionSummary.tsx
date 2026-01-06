import { useKeyboard } from "@opentui/react"
import { Header, Panel, Footer } from "./ui"
import { theme } from "../theme"

interface SessionSummaryProps {
  stats: {
    reviewed: number
    again: number
    hard: number
    good: number
    easy: number
  }
  canUndo: boolean
  onUndo: () => void
  onDone: () => void
}

export function SessionSummary({
  stats,
  canUndo,
  onUndo,
  onDone,
}: SessionSummaryProps) {
  useKeyboard((key) => {
    if (key.name === "return" || key.name === "q") {
      onDone()
    }
    if (key.name === "u" && canUndo) {
      onUndo()
    }
  })

  return (
    <box
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
    >
      <Header title="Session Complete" />

      <Panel accent>
        <box flexDirection="column" gap={1}>
          <text fg={theme.success}>
            Reviewed {stats.reviewed} card{stats.reviewed !== 1 ? "s" : ""}
          </text>

          <box flexDirection="row" gap={2}>
            <text fg={theme.error}>Again: {stats.again}</text>
            <text fg={theme.warning}>Hard: {stats.hard}</text>
            <text fg={theme.success}>Good: {stats.good}</text>
            <text fg={theme.primary}>Easy: {stats.easy}</text>
          </box>
        </box>
      </Panel>

      <box marginTop={2}>
        <Footer
          bindings={[
            ...(canUndo ? [{ keys: "u", action: "undo last" }] : []),
            { keys: "enter", action: "done" },
          ]}
        />
      </box>
    </box>
  )
}
