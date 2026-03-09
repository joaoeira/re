import type { ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExpansionColumn } from "@/components/forge/cards/expansion-column";

const mockUseForgeDerivedCardsQuery = vi.fn();
const mockGenerateDerivedCards = vi.fn();
const mockReformulateCard = vi.fn();

vi.mock("@/hooks/queries/use-forge-derived-cards-query", () => ({
  useForgeDerivedCardsQuery: (...args: unknown[]) => mockUseForgeDerivedCardsQuery(...args),
}));

vi.mock("@/hooks/mutations/use-forge-cards-mutations", () => ({
  forgeCardsMutationKeys: { generateDerivedCards: ["forge", "generateDerivedCards"] },
  formatQAContent: (q: string, a: string) => `Q: ${q}\nA: ${a}`,
  isForgeDerivationConfirmationResult: (result: { confirmRequired?: boolean }) =>
    result.confirmRequired === true,
  sameDerivationParentRef: () => false,
  useForgeAddCardToDeckMutation: () => ({ mutate: vi.fn() }),
  useForgeGenerateDerivedCardsMutation: () => ({
    mutateAsync: (...args: unknown[]) => mockGenerateDerivedCards(...args),
    isPending: false,
  }),
  useForgeReformulateCardMutation: () => ({
    mutate: (...args: unknown[]) => mockReformulateCard(...args),
  }),
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

const populatedQueryResult = (instruction: string | null = "focus on key concepts") => ({
  data: {
    derivations: [
      {
        id: 1,
        rootCardId: 100,
        question: "What are the phases of mitosis?",
        answer: "Prophase, metaphase, anaphase, telophase.",
        instruction,
        addedCount: 0,
      },
    ],
  },
  isLoading: false,
  error: null,
});

const multiDerivationQueryResult = () => ({
  data: {
    derivations: [
      {
        id: 1,
        rootCardId: 100,
        question: "What are the phases of mitosis?",
        answer: "Prophase, metaphase, anaphase, telophase.",
        instruction: "focus on key concepts",
        addedCount: 0,
      },
      {
        id: 2,
        rootCardId: 100,
        question: "What triggers mitosis?",
        answer: "Cell signaling and growth factors.",
        instruction: "focus on key concepts",
        addedCount: 0,
      },
    ],
  },
  isLoading: false,
  error: null,
});

const renderExpansionColumn = async ({
  columnOverrides = {},
  onRegenerated = vi.fn(),
}: {
  columnOverrides?: Partial<ExpansionColumnProps["column"]>;
  onRegenerated?: ExpansionColumnProps["onRegenerated"];
} = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <ExpansionColumn
        topicKey="topic:1"
        column={makeColumn(columnOverrides)}
        expandedDerivationIds={new Set()}
        onClose={vi.fn()}
        onRegenerated={onRegenerated}
        onRequestExpansion={vi.fn()}
      />
    </QueryClientProvider>,
  );

  return { screen, onRegenerated };
};

beforeEach(() => {
  mockUseForgeDerivedCardsQuery.mockReset();
  mockGenerateDerivedCards.mockReset();
  mockReformulateCard.mockReset();
});

describe("ExpansionColumn", () => {
  it("does not restore instruction after user clears it", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(emptyQueryResult());

    const { screen } = await renderExpansionColumn({
      columnOverrides: { instruction: "focus on key concepts" },
    });

    const textarea = screen.getByPlaceholder("What should these cards focus on?");
    await expect.element(textarea).toHaveValue("focus on key concepts");

    await userEvent.fill(textarea, "");

    await expect.element(textarea).toHaveValue("");
  });

  it("starts with an empty instruction when column has no instruction", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(emptyQueryResult());

    const { screen } = await renderExpansionColumn();

    const textarea = screen.getByPlaceholder("What should these cards focus on?");
    await expect.element(textarea).toHaveValue("");
  });

  it("opens the regenerate dialog with the current instruction", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(populatedQueryResult());

    const { screen } = await renderExpansionColumn();

    await userEvent.click(screen.getByRole("button", { name: "regenerate", exact: true }));

    await expect.element(screen.getByText("Regeneration instruction")).toBeVisible();
    await expect
      .element(screen.getByPlaceholder("What should these cards focus on?"))
      .toHaveValue("focus on key concepts");
  });

  it("discards modal edits on cancel", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(populatedQueryResult());

    const { screen } = await renderExpansionColumn();

    await userEvent.click(screen.getByRole("button", { name: "regenerate", exact: true }));
    const textarea = screen.getByPlaceholder("What should these cards focus on?");
    await userEvent.fill(textarea, "focus on only edge cases");

    (
      screen.getByRole("button", { name: "Cancel", exact: true }).element() as HTMLButtonElement
    ).click();

    await expect.poll(() => screen.getByText("Regeneration instruction").query()).toBeNull();
    expect(mockGenerateDerivedCards).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "regenerate", exact: true }));
    await expect
      .element(screen.getByPlaceholder("What should these cards focus on?"))
      .toHaveValue("focus on key concepts");
  });

  it("sends the edited instruction when regeneration is confirmed", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(populatedQueryResult());
    mockGenerateDerivedCards.mockResolvedValue({ derivations: [] });

    const onRegenerated = vi.fn();
    const { screen } = await renderExpansionColumn({ onRegenerated });

    await userEvent.click(screen.getByRole("button", { name: "regenerate", exact: true }));
    await userEvent.fill(
      screen.getByPlaceholder("What should these cards focus on?"),
      "  focus on exceptions  ",
    );

    (
      screen.getByRole("button", { name: "Regenerate", exact: true }).element() as
        | HTMLButtonElement
        | undefined
    )?.click();

    await expect.poll(() => mockGenerateDerivedCards.mock.calls.length).toBe(1);
    expect(mockGenerateDerivedCards.mock.calls[0]?.[0]).toEqual({
      rootCardId: 100,
      parent: { cardId: 100 },
      kind: "expansion",
      instruction: "focus on exceptions",
    });
    expect(onRegenerated).toHaveBeenCalledOnce();
  });

  it("omits the instruction when the modal draft is cleared", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(populatedQueryResult());
    mockGenerateDerivedCards.mockResolvedValue({ derivations: [] });

    const onRegenerated = vi.fn();
    const { screen } = await renderExpansionColumn({ onRegenerated });

    await userEvent.click(screen.getByRole("button", { name: "regenerate", exact: true }));
    await userEvent.fill(screen.getByPlaceholder("What should these cards focus on?"), "");

    (
      screen.getByRole("button", { name: "Regenerate", exact: true }).element() as
        | HTMLButtonElement
        | undefined
    )?.click();

    await expect.poll(() => mockGenerateDerivedCards.mock.calls.length).toBe(1);
    expect(mockGenerateDerivedCards.mock.calls[0]?.[0]).toEqual({
      rootCardId: 100,
      parent: { cardId: 100 },
      kind: "expansion",
    });
    expect(onRegenerated).toHaveBeenCalledOnce();
  });

  it("opens a destructive confirmation dialog when descendants would be deleted", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(populatedQueryResult());
    mockGenerateDerivedCards
      .mockResolvedValueOnce({ confirmRequired: true, descendantCount: 3 })
      .mockResolvedValueOnce({ derivations: [] });

    const onRegenerated = vi.fn();
    const { screen } = await renderExpansionColumn({ onRegenerated });

    await userEvent.click(screen.getByRole("button", { name: "regenerate", exact: true }));
    await userEvent.fill(
      screen.getByPlaceholder("What should these cards focus on?"),
      "reword the focus",
    );

    (
      screen.getByRole("button", { name: "Regenerate", exact: true }).element() as
        | HTMLButtonElement
        | undefined
    )?.click();

    await expect.element(screen.getByText("Delete descendant cards?")).toBeVisible();
    expect(mockGenerateDerivedCards.mock.calls[0]?.[0]).toEqual({
      rootCardId: 100,
      parent: { cardId: 100 },
      kind: "expansion",
      instruction: "reword the focus",
    });

    (
      screen.getByRole("button", { name: "Delete and regenerate", exact: true }).element() as
        | HTMLButtonElement
        | undefined
    )?.click();

    await expect.poll(() => mockGenerateDerivedCards.mock.calls.length).toBe(2);
    expect(mockGenerateDerivedCards.mock.calls[1]?.[0]).toEqual({
      rootCardId: 100,
      parent: { cardId: 100 },
      kind: "expansion",
      instruction: "reword the focus",
      confirmed: true,
    });
    expect(onRegenerated).toHaveBeenCalledOnce();
  });

  it("does not run the confirmed regeneration when the destructive dialog is cancelled", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(populatedQueryResult());
    mockGenerateDerivedCards.mockResolvedValueOnce({ confirmRequired: true, descendantCount: 2 });

    const onRegenerated = vi.fn();
    const { screen } = await renderExpansionColumn({ onRegenerated });

    await userEvent.click(screen.getByRole("button", { name: "regenerate", exact: true }));

    (
      screen.getByRole("button", { name: "Regenerate", exact: true }).element() as
        | HTMLButtonElement
        | undefined
    )?.click();

    await expect.element(screen.getByText("Delete descendant cards?")).toBeVisible();

    (
      screen.getByRole("button", { name: "Keep current cards", exact: true }).element() as
        | HTMLButtonElement
        | undefined
    )?.click();

    await expect.poll(() => mockGenerateDerivedCards.mock.calls.length).toBe(1);
    expect(onRegenerated).not.toHaveBeenCalled();
  });

  it("bypasses the dialog when there is no existing instruction", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(populatedQueryResult(null));
    mockGenerateDerivedCards.mockResolvedValue({ derivations: [] });

    const onRegenerated = vi.fn();
    const { screen } = await renderExpansionColumn({ onRegenerated });

    await userEvent.click(screen.getByRole("button", { name: "regenerate", exact: true }));

    await expect.poll(() => mockGenerateDerivedCards.mock.calls.length).toBe(1);
    expect(screen.getByText("Regeneration instruction").query()).toBeNull();
    expect(mockGenerateDerivedCards.mock.calls[0]?.[0]).toEqual({
      rootCardId: 100,
      parent: { cardId: 100 },
      kind: "expansion",
    });
    expect(onRegenerated).toHaveBeenCalledOnce();
  });

  it("removes a derivation card from the list when its delete button is clicked", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(multiDerivationQueryResult());

    const { screen } = await renderExpansionColumn();

    await expect.element(screen.getByText("What are the phases of mitosis?")).toBeVisible();
    await expect.element(screen.getByText("What triggers mitosis?")).toBeVisible();

    const firstDeleteButton = screen.container.querySelector(".lucide-trash-2")?.closest("button");
    firstDeleteButton?.click();

    await expect.poll(() => screen.getByText("What are the phases of mitosis?").query()).toBeNull();
    await expect.element(screen.getByText("What triggers mitosis?")).toBeVisible();
  });

  it("calls reformulate mutation for a derivation card", async () => {
    mockUseForgeDerivedCardsQuery.mockReturnValue(populatedQueryResult());

    const { screen } = await renderExpansionColumn();

    await userEvent.click(screen.getByRole("button", { name: "Reformulate card" }));

    expect(mockReformulateCard).toHaveBeenCalledOnce();
    expect(mockReformulateCard.mock.calls[0]?.[0]).toEqual({
      source: { derivationId: 1 },
      sourceQuestion: "What are the phases of mitosis?",
      sourceAnswer: "Prophase, metaphase, anaphase, telophase.",
    });
  });
});
