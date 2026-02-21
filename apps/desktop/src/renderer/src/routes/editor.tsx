import { createFileRoute } from "@tanstack/react-router";

import { EditorRoot } from "@/components/editor/editor-root";
import type { EditorSearchParams } from "@/hooks/useEditorSession";

const normalizeSearch = (search: Record<string, unknown>): EditorSearchParams => {
  const mode = search.mode;

  if (mode === "edit") {
    if (typeof search.deckPath === "string" && typeof search.cardId === "string") {
      return {
        mode: "edit",
        deckPath: search.deckPath,
        cardId: search.cardId,
      };
    }

    return { mode: "create" };
  }

  if (typeof search.deckPath === "string") {
    return {
      mode: "create",
      deckPath: search.deckPath,
    };
  }

  return { mode: "create" };
};

export const Route = createFileRoute("/editor")({
  validateSearch: (search): EditorSearchParams => normalizeSearch(search as Record<string, unknown>),
  component: EditorRoute,
});

function EditorRoute() {
  const search = Route.useSearch();
  return <EditorRoot search={search} />;
}
