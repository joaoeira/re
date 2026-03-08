import type { ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { ExpansionColumn } from "@/components/forge/cards/expansion-column";

const mockUseForgeDerivedCardsQuery = vi.fn();

vi.mock("@/hooks/queries/use-forge-derived-cards-query", () => ({
  useForgeDerivedCardsQuery: (...args: unknown[]) => mockUseForgeDerivedCardsQuery(...args),
}));

vi.mock("@/hooks/mutations/use-forge-cards-mutations", () => ({
  forgeCardsMutationKeys: { generateDerivedCards: ["forge", "generateDerivedCards"] },
  formatQAContent: (q: string, a: string) => `Q: ${q}\nA: ${a}`,
  isForgeDerivationConfirmationResult: () => false,
  sameDerivationParentRef: () => false,
  useForgeAddCardToDeckMutation: () => ({ mutate: vi.fn() }),
  useForgeGenerateDerivedCardsMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useForgeGenerateClozeMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useForgeUpdateCardMutation: () => ({ mutate: vi.fn() }),
  useForgeUpdateDerivationMutation: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/components/forge/forge-page-context", () => ({
  useForgeTargetDeckPath: () => "/test/deck.md",
}));

type ExpansionColumnProps = ComponentProps<typeof ExpansionColumn>;

const makeColumn = (
  overrides: Partial<ExpansionColumnProps["column"]> = {},
): ExpansionColumnProps["column"] => ({
  id: "card:100",
  parent: { cardId: 100 },
  rootCardId: 100,
  parentQuestion: "What is mitosis?",
  parentAnswer: "Cell division process.",
  ...overrides,
});

const emptyQueryResult = () => ({
  data: { derivations: [] },
  isLoading: false,
  error: null,
});

const renderExpansionColumn = async (
  columnOverrides: Partial<ExpansionColumnProps["column"]> = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ExpansionColumn
        topicKey="topic:1"
        column={makeColumn(columnOverrides)}
        expandedDerivationIds={new Set()}
        onClose={vi.fn()}
        onRegenerated={vi.fn()}
        onRequestExpansion={vi.fn()}
      />
    </QueryClientProvider>,
  );
};

describe("ExpansionColumn instruction", () => {
  it("does not restore instruction after user clears it", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(emptyQueryResult());

    const screen = await renderExpansionColumn({ instruction: "focus on key concepts" });

    const textarea = screen.getByPlaceholder("What should these cards focus on?");
    await expect.element(textarea).toHaveValue("focus on key concepts");

    await userEvent.fill(textarea, "");

    await expect.element(textarea).toHaveValue("");
  });

  it("starts with an empty instruction when column has no instruction", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(emptyQueryResult());

    const screen = await renderExpansionColumn();

    const textarea = screen.getByPlaceholder("What should these cards focus on?");
    await expect.element(textarea).toHaveValue("");
  });
});
