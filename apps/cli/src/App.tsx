import { useKeyboard, useRenderer } from "@opentui/react"
import { useDecks } from "./hooks/useDecks"
import { DeckTreeView } from "./components/DeckTreeView"

export function App() {
  const cwd = process.cwd()
  const { loading, error, tree } = useDecks(cwd)
  const renderer = useRenderer()

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy()
    }
  })

  if (loading) {
    return (
      <box padding={1}>
        <text>Loading decks...</text>
      </box>
    )
  }

  if (error) {
    return (
      <box padding={1} flexDirection="column">
        <text fg="#FF6666">Error: {error}</text>
        <text fg="#666666">Press q to quit</text>
      </box>
    )
  }

  if (tree.length === 0) {
    return (
      <box padding={1} flexDirection="column">
        <text fg="#666666">No decks found in {cwd}</text>
        <text fg="#666666">Press q to quit</text>
      </box>
    )
  }

  return (
    <box padding={1} flexDirection="column">
      <DeckTreeView tree={tree} />
      <text fg="#666666" marginTop={1}>
        Press q to quit
      </text>
    </box>
  )
}
