import { createFileRoute } from "@tanstack/react-router";

import { ReviewSession } from "@/components/review-session/review-session";
import {
  decodeReviewSessionOptionsFromSearch,
  encodeReviewSessionOptionsForSearch,
  type ReviewSessionOrder,
} from "@shared/rpc/schemas/review";

type ReviewSearchParams = {
  decks: "all" | string[];
  includeNew?: boolean;
  includeDue?: boolean;
  limit?: number;
  order?: ReviewSessionOrder;
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
  validateSearch: (search): ReviewSearchParams => {
    const rawSearch = search as Record<string, unknown>;
    return {
      decks: normalizeDeckSelection(rawSearch.decks),
      ...encodeReviewSessionOptionsForSearch(decodeReviewSessionOptionsFromSearch(rawSearch)),
    };
  },
  component: ReviewRoute,
});

function ReviewRoute() {
  const search = Route.useSearch();
  const options = decodeReviewSessionOptionsFromSearch(search as Record<string, unknown>);
  return <ReviewSession decks={search.decks} options={options} />;
}
