import { useKeyboard, useRenderer } from "@opentui/react"
import { useState, useCallback } from "react"
import { useDecks } from "./hooks/useDecks"
import { DeckTreeView } from "./components/DeckTreeView"
import { useReviewQueue } from "./hooks/useReviewQueue"
import type { Selection, ReviewQueue } from "./services/ReviewQueue"

export function App() {
  const cwd = process.cwd()
  const { loading, error, tree } = useDecks(cwd)
  const renderer = useRenderer()
  const [currentSelection, setCurrentSelection] = useState<Selection>({
    type: "all",
  })
  const [confirmedSelection, setConfirmedSelection] = useState<Selection | null>(
    null
  )

  const { queue, loading: queueLoading, error: queueError } = useReviewQueue(
    confirmedSelection,
    tree,
    cwd
  )

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy()
    }
    // Escape to go back to selection
    if (key.name === "escape" && confirmedSelection) {
      setConfirmedSelection(null)
    }
  })

  const handleSelectionChange = useCallback((selection: Selection) => {
    setCurrentSelection(selection)
  }, [])

  const handleSelectionConfirm = useCallback((selection: Selection) => {
    setConfirmedSelection(selection)
  }, [])

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

  // Show queue info if selection was confirmed
  if (confirmedSelection) {
    const selectionLabel =
      confirmedSelection.type === "all"
        ? "All"
        : confirmedSelection.type === "folder"
        ? `Folder: ${confirmedSelection.path}`
        : `Deck: ${confirmedSelection.path}`

    if (queueLoading) {
      return (
        <box padding={1} flexDirection="column">
          <text>Building review queue for {selectionLabel}...</text>
        </box>
      )
    }

    if (queueError) {
      return (
        <box padding={1} flexDirection="column">
          <text fg="#FF6666">Error building queue: {queueError}</text>
          <text fg="#666666">Press Escape to go back, q to quit</text>
        </box>
      )
    }

    return (
      <box padding={1} flexDirection="column">
        <text fg="#88FF88">Review Queue Ready</text>
        <text fg="#AAAAAA" marginTop={1}>
          Selection: {selectionLabel}
        </text>
        <text marginTop={1}>
          {queue?.totalNew ?? 0} new cards, {queue?.totalDue ?? 0} due cards
        </text>
        <text>Total: {queue?.items.length ?? 0} cards to review</text>
        <text fg="#666666" marginTop={1}>
          Press Escape to go back, q to quit
        </text>
      </box>
    )
  }

  return (
    <box padding={1} flexDirection="column">
      <text fg="#FFFFFF" marginBottom={1}>
        Select what to review (↑/↓ or j/k to navigate, Enter to confirm)
      </text>
      <DeckTreeView
        tree={tree}
        focused={true}
        onChange={handleSelectionChange}
        onSelect={handleSelectionConfirm}
      />
      <text fg="#666666" marginTop={1}>
        Press q to quit
      </text>
    </box>
  )
}
