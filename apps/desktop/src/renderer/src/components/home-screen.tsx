import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import { useDeckSelectionStore } from "@shared/state/stores-context";

import { DeckList } from "./deck-list";
import { ReviewFooter } from "./review-footer";
import { useSettingsQuery } from "@/hooks/queries/use-settings-query";
import { useWorkspaceSnapshotQuery } from "@/hooks/queries/use-workspace-snapshot-query";

export function HomeScreen() {
  const navigate = useNavigate();
  const deckSelectionStore = useDeckSelectionStore();

  const selectedDecks = useSelector(deckSelectionStore, (s) => s.context.selected);
  const settingsQuery = useSettingsQuery();
  const rootPath = settingsQuery.data?.workspace.rootPath ?? null;

  const workspaceSnapshotQuery = useWorkspaceSnapshotQuery(rootPath);

  const isLoading = settingsQuery.isPending || (rootPath !== null && workspaceSnapshotQuery.isPending);
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading workspace...
      </div>
    );
  }

  const workspaceErrorMessage = (() => {
    if (settingsQuery.isError) return settingsQuery.error.message;
    if (workspaceSnapshotQuery.isError) return workspaceSnapshotQuery.error.message;

    return null;
  })();

  if (workspaceErrorMessage) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        {workspaceErrorMessage}
      </div>
    );
  }

  const snapshotResult = workspaceSnapshotQuery.data ?? null;
  if (!snapshotResult) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No workspace configured. Set a workspace root path in settings.
      </div>
    );
  }

  const selectedDeckPaths = Object.keys(selectedDecks);
  const decksByRelativePath = new Map(
    snapshotResult.decks.map((deckSnapshot) => [deckSnapshot.relativePath, deckSnapshot]),
  );
  const validSelectedDeckPaths = selectedDeckPaths.filter((relativePath) =>
    decksByRelativePath.has(relativePath),
  );

  const allMetrics = snapshotResult.decks.reduce(
    (acc, snapshot) => {
      if (snapshot.status !== "ok") return acc;
      return {
        newCount: acc.newCount + snapshot.stateCounts.new,
        dueCount: acc.dueCount + snapshot.dueCards,
      };
    },
    { newCount: 0, dueCount: 0 },
  );

  const selectedMetrics = validSelectedDeckPaths.reduce(
    (acc, relativePath) => {
      const snapshot = decksByRelativePath.get(relativePath);
      if (!snapshot || snapshot.status !== "ok") return acc;
      return {
        newCount: acc.newCount + snapshot.stateCounts.new,
        dueCount: acc.dueCount + snapshot.dueCards,
      };
    },
    { newCount: 0, dueCount: 0 },
  );

  const hasSelectedDecks = validSelectedDeckPaths.length > 0;
  const metrics = hasSelectedDecks ? selectedMetrics : allMetrics;
  const totalReviewableCards = metrics.newCount + metrics.dueCount;
  const reviewEnabled = totalReviewableCards > 0;

  const selectedDeckNames = validSelectedDeckPaths.map((path) => {
    const snapshot = decksByRelativePath.get(path);
    return snapshot?.name ?? path;
  });

  return (
    <>
      <div className="flex-1 overflow-auto">
        <DeckList snapshots={snapshotResult.decks} />
      </div>

      <ReviewFooter
        selectedCount={validSelectedDeckPaths.length}
        selectedDeckNames={selectedDeckNames}
        metrics={metrics}
        totalReviewableCards={totalReviewableCards}
        reviewDisabled={!reviewEnabled}
        onReview={() => {
          if (!reviewEnabled) return;

          void navigate({
            to: "/review",
            search: {
              decks: hasSelectedDecks ? validSelectedDeckPaths : "all",
            },
          });
        }}
      />
    </>
  );
}
