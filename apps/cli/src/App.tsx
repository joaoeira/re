import { useKeyboard, useRenderer } from "@opentui/react";
import { useState, useCallback } from "react";
import { useDecks } from "./hooks/useDecks";
import { DeckTreeView } from "./components/DeckTreeView";
import { useReviewQueue } from "./hooks/useReviewQueue";
import { ReviewSession } from "./components/ReviewSession";
import { Loading } from "./components/Spinner";
import {
  Header,
  Panel,
  StatsRow,
  Footer,
  ErrorDisplay,
  EmptyState,
  Hint,
} from "./components/ui";
import { themeColors as theme } from "./ThemeContext";
import type { Selection } from "./services/ReviewQueue";

export function App() {
  const cwd = process.cwd();
  const renderer = useRenderer();
  const [confirmedSelection, setConfirmedSelection] =
    useState<Selection | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const { loading, error, tree, refresh: refreshDecks } = useDecks(cwd);

  const {
    queue,
    loading: queueLoading,
    error: queueError,
  } = useReviewQueue(confirmedSelection, tree, cwd);

  useKeyboard((key) => {
    // Don't handle keys when in review session (it handles its own keys)
    if (isReviewing) return;

    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy();
    }
    if (key.name === "escape" && confirmedSelection) {
      setConfirmedSelection(null);
    }
    // Start review when Enter or Space is pressed on confirmed selection with cards
    if (
      (key.name === "return" || key.name === "space") &&
      confirmedSelection &&
      queue &&
      queue.items.length > 0
    ) {
      setIsReviewing(true);
    }
  });

  const handleSelectionConfirm = useCallback((selection: Selection) => {
    setConfirmedSelection(selection);
  }, []);

  if (loading) {
    return (
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <Header title="re" subtitle="spaced repetition" />
        <Loading
          message="Discovering decks..."
          hint="Scanning for markdown files"
        />
      </box>
    );
  }

  if (error) {
    return (
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={2}
      >
        <Header title="re" />
        <ErrorDisplay title="Failed to load decks" message={error} />
        <Footer bindings={[{ keys: "q", action: "quit" }]} />
      </box>
    );
  }

  if (tree.length === 0) {
    return (
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={2}
      >
        <Header title="re" subtitle="spaced repetition" />
        <EmptyState message="No decks found" hint={`Looking in ${cwd}`} />
        <Footer bindings={[{ keys: "q", action: "quit" }]} />
      </box>
    );
  }

  if (isReviewing && confirmedSelection && queue) {
    return (
      <ReviewSession
        queue={queue.items}
        onComplete={() => {
          setIsReviewing(false);
          setConfirmedSelection(null); // Go back to deck selection
          refreshDecks();
        }}
        onQuit={() => {
          setIsReviewing(false);
          setConfirmedSelection(null);
          refreshDecks();
        }}
      />
    );
  }

  if (confirmedSelection) {
    const selectionLabel =
      confirmedSelection.type === "all"
        ? "All decks"
        : confirmedSelection.type === "folder"
        ? confirmedSelection.path.split("/").pop() || confirmedSelection.path
        : confirmedSelection.path.split("/").pop()?.replace(/\.md$/, "") ||
          confirmedSelection.path;

    if (queueLoading) {
      return (
        <box
          flexDirection="column"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
        >
          <Header title="re" subtitle={selectionLabel} />
          <Loading message="Building review queue..." />
        </box>
      );
    }

    if (queueError) {
      return (
        <box
          flexDirection="column"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          gap={2}
        >
          <Header title="re" subtitle={selectionLabel} />
          <ErrorDisplay title="Queue error" message={queueError} />
          <Footer
            bindings={[
              { keys: "esc", action: "back" },
              { keys: "q", action: "quit" },
            ]}
          />
        </box>
      );
    }

    const totalCards = queue?.items.length ?? 0;
    const hasCards = totalCards > 0;

    return (
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <Header title="re" subtitle={selectionLabel} />

        <Panel accent>
          <box flexDirection="column" gap={1}>
            <text fg={hasCards ? theme.success : theme.textMuted}>
              {hasCards ? "Ready to review" : "Nothing to review"}
            </text>

            {hasCards && (
              <StatsRow
                total={totalCards}
                newCards={queue?.totalNew ?? 0}
                dueCards={queue?.totalDue ?? 0}
              />
            )}

            {!hasCards && <Hint>All cards are up to date</Hint>}
          </box>
        </Panel>

        <box marginTop={2}>
          <Footer
            bindings={[
              ...(hasCards ? [{ keys: "enter/space", action: "start" }] : []),
              { keys: "esc", action: "back" },
              { keys: "q", action: "quit" },
            ]}
          />
        </box>
      </box>
    );
  }

  return (
    <box
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <Header title="re" subtitle="select what to review" />

      <DeckTreeView
        tree={tree}
        focused={true}
        onSelect={handleSelectionConfirm}
      />

      <Footer
        bindings={[
          { keys: "j/k", action: "navigate" },
          { keys: "enter/space", action: "select" },
          { keys: "q", action: "quit" },
        ]}
      />
    </box>
  );
}
