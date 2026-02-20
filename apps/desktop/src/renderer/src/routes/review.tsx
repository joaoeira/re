import { createFileRoute } from "@tanstack/react-router";

import { ReviewSession } from "@/components/review-session/review-session";

type ReviewSearchParams = {
  decks: "all" | string[];
};

const normalizeDeckSelection = (value: unknown): ReviewSearchParams["decks"] => {
  if (value === "all") {
    return "all";
  }

  if (Array.isArray(value)) {
    const deckPaths = value.filter((item): item is string => typeof item === "string");
    if (deckPaths.length === 0) {
      return "all";
    }
    if (deckPaths.includes("all")) {
      return "all";
    }
    return deckPaths;
  }

  if (typeof value === "string") {
    if (value === "all") {
      return "all";
    }
    return [value];
  }

  return "all";
};

export const Route = createFileRoute("/review")({
  validateSearch: (search): ReviewSearchParams => ({
    decks: normalizeDeckSelection((search as Record<string, unknown>).decks),
  }),
  component: ReviewRoute,
});

function ReviewRoute() {
  const { decks } = Route.useSearch();
  return <ReviewSession decks={decks} />;
}
