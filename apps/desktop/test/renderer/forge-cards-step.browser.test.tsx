import { userEvent } from "@vitest/browser/context";
import { describe, expect, it, vi } from "vitest";

import { ForgePage } from "@/components/forge/forge-page";
import { renderWithIpcProviders } from "./render-with-providers";
import { mockDesktopGlobals, uploadPdf } from "./forge-test-helpers";

type TopicDef = {
  readonly chunkId: number;
  readonly sequenceOrder: number;
  readonly topicIndex: number;
  readonly topicText: string;
  readonly topicId: number;
};

type Card = {
  readonly id: number;
  readonly question: string;
  readonly answer: string;
};

type TopicState = {
  readonly topic: TopicDef;
  status: "idle" | "generating" | "generated" | "error";
  errorMessage: string | null;
  generationRevision: number;
  cards: Array<Card>;
};

type InitialTopicState = {
  readonly status?: TopicState["status"];
  readonly errorMessage?: string | null;
  readonly generationRevision?: number;
  readonly cards?: ReadonlyArray<{
    readonly id?: number;
    readonly question: string;
    readonly answer: string;
  }>;
};

type SnapshotSummaryOverride = {
  readonly status?: TopicState["status"];
  readonly errorMessage?: string | null;
  readonly cardCount?: number;
  readonly generationRevision?: number;
};

const TOPICS: ReadonlyArray<TopicDef> = [
  { chunkId: 101, sequenceOrder: 0, topicIndex: 0, topicText: "alpha", topicId: 1001 },
  { chunkId: 101, sequenceOrder: 0, topicIndex: 1, topicText: "beta", topicId: 1002 },
  { chunkId: 102, sequenceOrder: 1, topicIndex: 0, topicText: "gamma", topicId: 1003 },
  { chunkId: 102, sequenceOrder: 1, topicIndex: 1, topicText: "delta", topicId: 1004 },
];

const topicKey = (topic: Pick<TopicDef, "chunkId" | "topicIndex">) =>
  `${topic.chunkId}:${topic.topicIndex}`;

const groupTopicsByChunk = () => [
  {
    chunkId: 101,
    sequenceOrder: 0,
    topics: ["alpha", "beta"],
  },
  {
    chunkId: 102,
    sequenceOrder: 1,
    topics: ["gamma", "delta"],
  },
];

const createCardsInvoke = (options?: {
  readonly sessionId?: number;
  readonly initialByTopicKey?: Readonly<Record<string, InitialTopicState>>;
  readonly snapshotSummaryOverridesByTopicKey?: Readonly<Record<string, SnapshotSummaryOverride>>;
  readonly topicGenerationDelayByTopicKey?: Readonly<Record<string, number>>;
  readonly topicGenerationFailureByTopicKey?: Readonly<Record<string, string>>;
  readonly permutationsGenerationDelayMs?: number;
  readonly clozeGenerationDelayMs?: number;
}) => {
  const sessionId = options?.sessionId ?? 77;
  let nextCardId = 9_000;
  let nextPermutationId = 12_000;
  const permutationsGenerationDelayMs = options?.permutationsGenerationDelayMs ?? 0;
  const clozeGenerationDelayMs = options?.clozeGenerationDelayMs ?? 0;

  const topicByKey = new Map<string, TopicState>();
  TOPICS.forEach((topic) => {
    const key = topicKey(topic);
    const initial = options?.initialByTopicKey?.[key];
    const cards =
      initial?.cards?.map((card) => ({
        id: card.id ?? nextCardId++,
        question: card.question,
        answer: card.answer,
      })) ?? [];

    topicByKey.set(key, {
      topic,
      status: initial?.status ?? "idle",
      errorMessage: initial?.errorMessage ?? null,
      generationRevision: initial?.generationRevision ?? 0,
      cards,
    });
  });

  const permutationsByCardId = new Map<
    number,
    Array<{ id: number; question: string; answer: string }>
  >();
  const clozeByCardId = new Map<number, string>();

  const findTopicState = (input: { chunkId: number; topicIndex: number }) => {
    return topicByKey.get(`${input.chunkId}:${input.topicIndex}`) ?? null;
  };

  const findTopicStateByCardId = (cardId: number) => {
    for (const state of topicByKey.values()) {
      if (state.cards.some((card) => card.id === cardId)) return state;
    }
    return null;
  };

  const toSummary = (state: TopicState) => ({
    topicId: state.topic.topicId,
    chunkId: state.topic.chunkId,
    sequenceOrder: state.topic.sequenceOrder,
    topicIndex: state.topic.topicIndex,
    topicText: state.topic.topicText,
    status: state.status,
    errorMessage: state.errorMessage,
    cardCount: state.cards.length,
    generationRevision: state.generationRevision,
  });

  const withSnapshotOverride = (
    summary: ReturnType<typeof toSummary>,
    override?: SnapshotSummaryOverride,
  ) => {
    if (!override) return summary;

    return {
      ...summary,
      status: override.status ?? summary.status,
      errorMessage:
        override.errorMessage !== undefined ? override.errorMessage : summary.errorMessage,
      cardCount: override.cardCount ?? summary.cardCount,
      generationRevision: override.generationRevision ?? summary.generationRevision,
    };
  };

  const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
    if (method === "ForgePreviewChunks") {
      return {
        type: "success",
        data: { textLength: 230, totalPages: 4, chunkCount: 2 },
      };
    }

    if (method === "ForgeStartTopicExtraction") {
      return {
        type: "success",
        data: {
          session: {
            id: sessionId,
            sourceKind: "pdf",
            sourceFilePath: "/forge/source.pdf",
            deckPath: null,
            sourceFingerprint: "fp",
            status: "topics_extracted",
            errorMessage: null,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
          },
          duplicateOfSessionId: null,
          extraction: {
            sessionId,
            textLength: 230,
            preview: "preview",
            totalPages: 4,
            chunkCount: 2,
          },
          topicsByChunk: groupTopicsByChunk(),
        },
      };
    }

    if (method === "ForgeGetTopicExtractionSnapshot") {
      return {
        type: "success",
        data: {
          session: null,
          topicsByChunk: [],
        },
      };
    }

    if (method === "ForgeGetCardsSnapshot") {
      return {
        type: "success",
        data: {
          topics: TOPICS.map((topic) => {
            const state = topicByKey.get(topicKey(topic));
            if (!state) {
              throw new Error(`Missing topic state for ${topic.chunkId}:${topic.topicIndex}`);
            }
            return withSnapshotOverride(
              toSummary(state),
              options?.snapshotSummaryOverridesByTopicKey?.[topicKey(topic)],
            );
          }),
        },
      };
    }

    if (method === "ForgeGetTopicCards") {
      const input = payload as { chunkId: number; topicIndex: number };
      const state = findTopicState(input);
      if (!state) {
        return {
          type: "failure",
          error: {
            _tag: "topic_not_found",
            sessionId,
            chunkId: input.chunkId,
            topicIndex: input.topicIndex,
          },
        };
      }

      return {
        type: "success",
        data: {
          topic: toSummary(state),
          cards: state.cards.map((card) => ({
            id: card.id,
            question: card.question,
            answer: card.answer,
          })),
        },
      };
    }

    if (method === "ForgeGenerateTopicCards") {
      const input = payload as { chunkId: number; topicIndex: number };
      const state = findTopicState(input);
      if (!state) {
        return {
          type: "failure",
          error: {
            _tag: "topic_not_found",
            sessionId,
            chunkId: input.chunkId,
            topicIndex: input.topicIndex,
          },
        };
      }
      const generationDelayMs =
        options?.topicGenerationDelayByTopicKey?.[topicKey(state.topic)] ?? 0;
      if (generationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, generationDelayMs));
      }
      const generationFailureMessage =
        options?.topicGenerationFailureByTopicKey?.[topicKey(state.topic)] ?? null;
      if (generationFailureMessage) {
        state.status = "error";
        state.errorMessage = generationFailureMessage;
        state.cards = [];
        state.generationRevision += 1;

        return {
          type: "failure",
          error: {
            _tag: "card_generation_error",
            sessionId,
            chunkId: state.topic.chunkId,
            topicIndex: state.topic.topicIndex,
            message: generationFailureMessage,
          },
        };
      }

      const nextRevision = state.generationRevision + 1;
      const nextCards =
        state.cards.length > 0
          ? state.cards.map((card, index) => ({
              id: card.id,
              question: `${state.topic.topicText} regenerated ${nextRevision}-${index + 1}`,
              answer: `A ${state.topic.topicText} ${nextRevision}-${index + 1}`,
            }))
          : [
              {
                id: nextCardId++,
                question: `Q ${state.topic.topicText}`,
                answer: `A ${state.topic.topicText}`,
              },
            ];

      state.status = "generated";
      state.errorMessage = null;
      state.generationRevision = nextRevision;
      state.cards = nextCards;

      return {
        type: "success",
        data: {
          topic: toSummary(state),
          cards: nextCards.map((card) => ({
            id: card.id,
            question: card.question,
            answer: card.answer,
          })),
        },
      };
    }

    if (method === "ForgeUpdateCard") {
      const input = payload as { cardId: number; question: string; answer: string };
      const state = findTopicStateByCardId(input.cardId);
      if (!state) {
        return {
          type: "failure",
          error: {
            _tag: "card_not_found",
            sourceCardId: input.cardId,
          },
        };
      }

      state.cards = state.cards.map((card) =>
        card.id === input.cardId
          ? { id: card.id, question: input.question, answer: input.answer }
          : card,
      );

      return {
        type: "success",
        data: {
          card: {
            id: input.cardId,
            question: input.question,
            answer: input.answer,
          },
        },
      };
    }

    if (method === "ForgeGetCardPermutations") {
      const input = payload as { sourceCardId: number };
      return {
        type: "success",
        data: {
          sourceCardId: input.sourceCardId,
          permutations: permutationsByCardId.get(input.sourceCardId) ?? [],
        },
      };
    }

    if (method === "ForgeGenerateCardPermutations") {
      const input = payload as { sourceCardId: number };
      if (permutationsGenerationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, permutationsGenerationDelayMs));
      }
      const permutations = [
        {
          id: nextPermutationId++,
          question: `Permutation for ${input.sourceCardId}`,
          answer: "Permutation answer",
        },
      ];
      permutationsByCardId.set(input.sourceCardId, permutations);
      return {
        type: "success",
        data: {
          sourceCardId: input.sourceCardId,
          permutations,
        },
      };
    }

    if (method === "ForgeGetCardCloze") {
      const input = payload as { sourceCardId: number };
      return {
        type: "success",
        data: {
          sourceCardId: input.sourceCardId,
          cloze: clozeByCardId.get(input.sourceCardId) ?? null,
        },
      };
    }

    if (method === "ForgeGenerateCardCloze") {
      const input = payload as { sourceCardId: number };
      if (clozeGenerationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, clozeGenerationDelayMs));
      }
      const cloze = `The answer is {{c1::${input.sourceCardId}}}.`;
      clozeByCardId.set(input.sourceCardId, cloze);
      return {
        type: "success",
        data: {
          sourceCardId: input.sourceCardId,
          cloze,
        },
      };
    }

    if (method === "ForgeListSessions") {
      return { type: "success", data: { sessions: [] } };
    }

    return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
  });

  return invoke;
};

const navigateToCards = async (screen: Awaited<ReturnType<typeof renderWithIpcProviders>>) => {
  await uploadPdf();
  await userEvent.click(screen.getByText("Begin Extraction"));
  await expect.element(screen.getByText("Select topics")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Select all", exact: true }));
  await expect.element(screen.getByText("4 topics selected")).toBeVisible();
  await userEvent.click(screen.getByText("Continue to cards"));
  await expect.element(screen.getByText("Topics · 4")).toBeVisible();
};

const defaultInteractiveState = (): Record<string, InitialTopicState> => ({
  "101:1": {
    status: "generated",
    generationRevision: 1,
    cards: [{ id: 8_001, question: "beta question", answer: "beta answer" }],
  },
});

describe("Forge cards step", () => {
  it("auto-starts first three topics when no selected topic has cards", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateTopicCards",
        ).length;
      })
      .toBe(3);

    const generatedPayloads = invoke.mock.calls
      .filter(([method]: unknown[]) => method === "ForgeGenerateTopicCards")
      .map(
        ([, payload]: unknown[]) =>
          payload as { sessionId: number; chunkId: number; topicIndex: number },
      );

    expect(generatedPayloads).toEqual([
      { sessionId: 77, chunkId: 101, topicIndex: 0 },
      { sessionId: 77, chunkId: 101, topicIndex: 1 },
      { sessionId: 77, chunkId: 102, topicIndex: 0 },
    ]);
  });

  it("skips auto-start when any selected topic already has cards", async () => {
    const invoke = createCardsInvoke({
      sessionId: 78,
      initialByTopicKey: {
        "101:0": {
          status: "generated",
          generationRevision: 3,
          cards: [
            { id: 5_001, question: "existing q1", answer: "a1" },
            { id: 5_002, question: "existing q2", answer: "a2" },
          ],
        },
      },
    });

    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await expect
      .poll(
        () =>
          invoke.mock.calls.filter(([method]: unknown[]) => method === "ForgeGenerateTopicCards")
            .length,
        { timeout: 250, interval: 50 },
      )
      .toBe(0);
  });

  it("applies all auto-start generation results when completions are out of order", async () => {
    const invoke = createCardsInvoke({
      topicGenerationDelayByTopicKey: {
        "101:0": 240,
        "101:1": 170,
        "102:0": 30,
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateTopicCards",
        ).length;
      })
      .toBe(3);

    await expect.element(screen.getByText("Q alpha")).toBeVisible();

    const betaRow = screen.getByText("beta").element().closest("button");
    const gammaRow = screen.getByText("gamma").element().closest("button");
    if (!(betaRow instanceof HTMLElement) || !(gammaRow instanceof HTMLElement)) {
      throw new Error("Expected beta and gamma sidebar rows.");
    }

    betaRow.click();
    await expect.element(screen.getByText("Q beta")).toBeVisible();

    gammaRow.click();
    await expect.element(screen.getByText("Q gamma")).toBeVisible();
  });

  it("keeps successful auto-start topics while failed topics enter error and can retry", async () => {
    const invoke = createCardsInvoke({
      topicGenerationFailureByTopicKey: {
        "101:1": "beta auto-start failed",
      },
      topicGenerationDelayByTopicKey: {
        "101:0": 80,
        "102:0": 40,
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateTopicCards",
        ).length;
      })
      .toBe(3);

    await expect.element(screen.getByText("Q alpha")).toBeVisible();

    const gammaRow = screen.getByText("gamma").element().closest("button");
    const betaRow = screen.getByText("beta").element().closest("button");
    if (!(betaRow instanceof HTMLElement) || !(gammaRow instanceof HTMLElement)) {
      throw new Error("Expected beta and gamma sidebar rows.");
    }

    gammaRow.click();
    await expect.element(screen.getByText("Q gamma")).toBeVisible();

    betaRow.click();
    await expect.element(screen.getByText("beta auto-start failed")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Retry", exact: true })).toBeVisible();

    const retryButton = screen.getByRole("button", { name: "Retry", exact: true }).element();
    if (!(retryButton instanceof HTMLButtonElement)) {
      throw new Error("Expected retry button element.");
    }
    retryButton.click();

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(([method, payload]: unknown[]) => {
          if (method !== "ForgeGenerateTopicCards") return false;
          const input = payload as { chunkId: number; topicIndex: number };
          return input.chunkId === 101 && input.topicIndex === 1;
        }).length;
      })
      .toBe(2);
  });

  it("switches topics from the sidebar and renders the selected topic cards", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 2,
          cards: [{ id: 8_100, question: "alpha question", answer: "alpha answer" }],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await expect.element(screen.getByText("alpha question")).toBeVisible();

    const betaRow = screen.getByText("beta").element().closest("button");
    if (!(betaRow instanceof HTMLElement)) {
      throw new Error("Expected beta sidebar row button.");
    }
    betaRow.click();

    await expect.element(screen.getByText("beta question")).toBeVisible();
    expect(screen.getByText("alpha question").query()).toBeNull();
  });

  it("generates cards for an idle topic from the Generate cards action", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "idle",
          cards: [],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Generate cards" }));

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateTopicCards",
        ).length;
      })
      .toBe(1);
    await expect.element(screen.getByText("Q alpha")).toBeVisible();
  });

  it("ignores duplicate Generate cards clicks while the same topic is in flight", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "idle",
          cards: [],
        },
      },
      topicGenerationDelayByTopicKey: {
        "101:0": 300,
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const generateButton = screen
      .getByRole("button", { name: "Generate cards", exact: true })
      .element();
    if (!(generateButton instanceof HTMLButtonElement)) {
      throw new Error("Expected generate cards button element.");
    }

    generateButton.click();
    generateButton.click();

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(([method, payload]: unknown[]) => {
          if (method !== "ForgeGenerateTopicCards") return false;
          const input = payload as { chunkId: number; topicIndex: number };
          return input.chunkId === 101 && input.topicIndex === 0;
        }).length;
      })
      .toBe(1);

    await expect.element(screen.getByText("Q alpha")).toBeVisible();
  });

  it("renders generated cards when the topic query is newer than the snapshot summary", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "idle",
          cards: [],
        },
      },
      snapshotSummaryOverridesByTopicKey: {
        "101:0": {
          status: "idle",
          cardCount: 0,
          generationRevision: 0,
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Generate cards" }));

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateTopicCards",
        ).length;
      })
      .toBe(1);

    await expect.element(screen.getByText("Q alpha")).toBeVisible();
  });

  it("renders generated cards when snapshot status is stale as generating", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 2,
          cards: [{ id: 8_120, question: "alpha already generated", answer: "alpha answer" }],
        },
      },
      snapshotSummaryOverridesByTopicKey: {
        "101:0": {
          status: "generating",
          cardCount: 0,
          generationRevision: 1,
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await expect.element(screen.getByText("alpha already generated")).toBeVisible();
  });

  it("keeps rendering generating when snapshot is generating and topic query is stale idle", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "idle",
          cards: [],
        },
      },
      snapshotSummaryOverridesByTopicKey: {
        "101:0": {
          status: "generating",
          cardCount: 0,
          generationRevision: 0,
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await expect.element(screen.getByText("Generating cards…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate cards" }).query()).toBeNull();
  });

  it("renders topic error state and retries generation", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "error",
          errorMessage: "topic generation failed",
          cards: [],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await expect.element(screen.getByText("topic generation failed")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
    await expect.element(screen.getByText("Q alpha")).toBeVisible();
  });

  it("persists inline card edits through ForgeUpdateCard", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [{ id: 8_200, question: "editable question", answer: "editable answer" }],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const questionField = screen.getByText("editable question").element() as HTMLElement;
    questionField.focus();
    questionField.textContent = "edited question";
    questionField.dispatchEvent(new Event("input", { bubbles: true }));
    questionField.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(([method]: unknown[]) => method === "ForgeUpdateCard")
          .length;
      })
      .toBe(1);

    const updateCall = invoke.mock.calls.find(
      ([method]: unknown[]) => method === "ForgeUpdateCard",
    ) as [string, { cardId: number; question: string; answer: string }] | undefined;
    expect(updateCall?.[1]).toEqual({
      cardId: 8_200,
      question: "edited question",
      answer: "editable answer",
    });
  });

  it("auto-generates permutations and cloze variants when panels open empty", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [{ id: 8_300, question: "variant question", answer: "variant answer" }],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Permutations" }));

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateCardPermutations",
        ).length;
      })
      .toBe(1);
    await expect.element(screen.getByText("Permutation for 8300")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Cloze" }));

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateCardCloze",
        ).length;
      })
      .toBe(1);
  });

  it("keeps permutations and cloze mutually exclusive for the same card", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [{ id: 8_400, question: "exclusive question", answer: "exclusive answer" }],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Permutations" }));
    await expect.element(screen.getByText("Permutation for 8400")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Cloze" }));
    expect(screen.getByText("Permutation for 8400").query()).toBeNull();
    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateCardCloze",
        ).length;
      })
      .toBe(1);
  });

  it("does not trigger duplicate panel generation when reopening while generation is in flight", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [{ id: 8_450, question: "in-flight question", answer: "in-flight answer" }],
        },
      },
      permutationsGenerationDelayMs: 300,
      clozeGenerationDelayMs: 300,
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Permutations" }));
    await userEvent.click(screen.getByRole("button", { name: "Cloze" }));
    await userEvent.click(screen.getByRole("button", { name: "Permutations" }));
    await userEvent.click(screen.getByRole("button", { name: "Cloze" }));

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateCardPermutations",
        ).length;
      })
      .toBe(1);
    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateCardCloze",
        ).length;
      })
      .toBe(1);

    await expect.element(screen.getByText("Cloze conversion")).toBeVisible();

    await expect
      .poll(
        () =>
          invoke.mock.calls.filter(
            ([method]: unknown[]) => method === "ForgeGenerateCardPermutations",
          ).length,
        { timeout: 700, interval: 50 },
      )
      .toBe(1);

    await expect
      .poll(
        () =>
          invoke.mock.calls.filter(([method]: unknown[]) => method === "ForgeGenerateCardCloze")
            .length,
        { timeout: 700, interval: 50 },
      )
      .toBe(1);
  });

  it("keeps an expanded panel open when switching topics away and back", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [{ id: 8_500, question: "persist question", answer: "persist answer" }],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Permutations" }));
    await expect.element(screen.getByText("Permutation for 8500")).toBeVisible();

    const sidebar = screen.getByText("Topics · 4").element().closest("aside");
    if (!(sidebar instanceof HTMLElement)) {
      throw new Error("Expected cards sidebar.");
    }

    const sidebarButtons = Array.from(sidebar.querySelectorAll("button"));
    const betaRow = sidebarButtons.find((button) => button.textContent?.includes("beta"));
    const alphaRow = sidebarButtons.find((button) => button.textContent?.includes("alpha"));
    if (!(betaRow instanceof HTMLElement) || !(alphaRow instanceof HTMLElement)) {
      throw new Error("Expected alpha and beta sidebar row buttons.");
    }

    betaRow.click();
    await expect.element(screen.getByText("beta question")).toBeVisible();

    alphaRow.click();
    await expect.element(screen.getByText("Permutation for 8500")).toBeVisible();
  });
});
