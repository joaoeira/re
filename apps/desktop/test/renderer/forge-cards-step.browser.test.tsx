import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { ForgePage } from "@/components/forge/forge-page";
import { renderWithIpcProviders } from "./render-with-providers";
import {
  DEFAULT_FORGE_DECKS,
  FORGE_WORKSPACE_ROOT_PATH,
  forgeSettingsSuccess,
  mockDesktopGlobals,
  toDeckEntry,
  uploadPdf,
  type ForgeDeckEntry,
} from "./forge-test-helpers";

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
  readonly addedToDeck: boolean;
};

type Derivation = {
  readonly id: number;
  readonly rootCardId: number;
  readonly parentDerivationId: number | null;
  readonly kind: "permutation" | "expansion";
  readonly derivationOrder: number;
  readonly question: string;
  readonly answer: string;
  readonly instruction: string | null;
  readonly addedCount: number;
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
    readonly addedToDeck?: boolean;
  }>;
};

type SnapshotSummaryOverride = {
  readonly status?: TopicState["status"];
  readonly errorMessage?: string | null;
  readonly cardCount?: number;
  readonly addedCount?: number;
  readonly generationRevision?: number;
};

const TOPICS: ReadonlyArray<TopicDef> = [
  {
    chunkId: 101,
    sequenceOrder: 0,
    topicIndex: 0,
    topicText: "alpha",
    topicId: 1001,
  },
  {
    chunkId: 101,
    sequenceOrder: 0,
    topicIndex: 1,
    topicText: "beta",
    topicId: 1002,
  },
  {
    chunkId: 102,
    sequenceOrder: 1,
    topicIndex: 0,
    topicText: "gamma",
    topicId: 1003,
  },
  {
    chunkId: 102,
    sequenceOrder: 1,
    topicIndex: 1,
    topicText: "delta",
    topicId: 1004,
  },
];

const topicKey = (topic: Pick<TopicDef, "chunkId" | "topicIndex">) =>
  `${topic.chunkId}:${topic.topicIndex}`;

const typedFailure = <T extends { readonly _tag: string }>(data: T) => ({
  type: "failure" as const,
  error: {
    tag: data._tag,
    data,
  },
});

const createCardsInvoke = (options?: {
  readonly sessionId?: number;
  readonly initialByTopicKey?: Readonly<Record<string, InitialTopicState>>;
  readonly snapshotSummaryOverridesByTopicKey?: Readonly<Record<string, SnapshotSummaryOverride>>;
  readonly topicGenerationDelayByTopicKey?: Readonly<Record<string, number>>;
  readonly topicGenerationFailureByTopicKey?: Readonly<Record<string, string>>;
  readonly derivedGenerationFailureMessageByKind?: Readonly<
    Partial<Record<"permutation" | "expansion", string>>
  >;
  readonly permutationsGenerationDelayMs?: number;
  readonly clozeGenerationDelayMs?: number;
  readonly reformulationDelayMs?: number;
  readonly reformulationFailureMessage?: string;
  readonly initialDecks?: ReadonlyArray<ForgeDeckEntry>;
  readonly scanDecksByCall?: ReadonlyArray<ReadonlyArray<ForgeDeckEntry>>;
  readonly createDeckFailureMessage?: string;
  readonly deckPathPersistFailuresBeforeSuccess?: number;
  readonly deckPathPersistFailuresByDeckPath?: Readonly<Record<string, number>>;
}) => {
  const sessionId = options?.sessionId ?? 77;
  const workspaceRootPath = FORGE_WORKSPACE_ROOT_PATH;
  let nextCardId = 9_000;
  let nextPermutationId = 12_000;
  let decks = [...(options?.initialDecks ?? DEFAULT_FORGE_DECKS)];
  let scanDecksCallCount = 0;
  let remainingDeckPathPersistFailures = options?.deckPathPersistFailuresBeforeSuccess ?? 0;
  const remainingDeckPathPersistFailuresByDeckPath = new Map(
    Object.entries(options?.deckPathPersistFailuresByDeckPath ?? {}),
  );
  const derivedGenerationFailureMessageByKind =
    options?.derivedGenerationFailureMessageByKind ?? {};
  const permutationsGenerationDelayMs = options?.permutationsGenerationDelayMs ?? 0;
  const clozeGenerationDelayMs = options?.clozeGenerationDelayMs ?? 0;
  const reformulationDelayMs = options?.reformulationDelayMs ?? 0;
  const reformulationFailureMessage = options?.reformulationFailureMessage ?? null;

  const topicByKey = new Map<string, TopicState>();
  TOPICS.forEach((topic) => {
    const key = topicKey(topic);
    const initial = options?.initialByTopicKey?.[key];
    const cards =
      initial?.cards?.map((card) => ({
        id: card.id ?? nextCardId++,
        question: card.question,
        answer: card.answer,
        addedToDeck: card.addedToDeck ?? false,
      })) ?? [];

    topicByKey.set(key, {
      topic,
      status: initial?.status ?? "idle",
      errorMessage: initial?.errorMessage ?? null,
      generationRevision: initial?.generationRevision ?? 0,
      cards,
    });
  });

  const derivationsByParentKey = new Map<string, Array<Derivation>>();
  const clozeBySourceKey = new Map<string, string>();
  const clozeAddedCountBySourceKey = new Map<string, number>();

  const derivationParentKey = (
    parent: { readonly cardId: number } | { readonly derivationId: number },
    kind: "permutation" | "expansion",
  ) =>
    `${kind}:${"cardId" in parent ? `card:${parent.cardId}` : `derivation:${parent.derivationId}`}`;

  const sourceKey = (source: { readonly cardId: number } | { readonly derivationId: number }) =>
    "cardId" in source ? `card:${source.cardId}` : `derivation:${source.derivationId}`;

  const findTopicStateById = (topicId: number) => {
    for (const state of topicByKey.values()) {
      if (state.topic.topicId === topicId) return state;
    }
    return null;
  };

  const findTopicStateByCardId = (cardId: number) => {
    for (const state of topicByKey.values()) {
      if (state.cards.some((card) => card.id === cardId)) return state;
    }
    return null;
  };

  const findDerivationById = (derivationId: number): Derivation | null => {
    for (const derivations of derivationsByParentKey.values()) {
      const derivation = derivations.find((entry) => entry.id === derivationId);
      if (derivation) return derivation;
    }
    return null;
  };

  const resolveCardById = (cardId: number): Card | null =>
    findTopicStateByCardId(cardId)?.cards.find((card) => card.id === cardId) ?? null;

  const toSummary = (state: TopicState) => ({
    topicId: state.topic.topicId,
    sessionId,
    family: "detail" as const,
    chunkId: state.topic.chunkId,
    chunkSequenceOrder: state.topic.sequenceOrder,
    topicIndex: state.topic.topicIndex,
    topicText: state.topic.topicText,
    status: state.status,
    errorMessage: state.errorMessage,
    cardCount: state.cards.length,
    addedCount: state.cards.filter((card) => card.addedToDeck).length,
    generationRevision: state.generationRevision,
    selected: true,
  });
  const topicGroups = [
    {
      groupId: "chunk:101",
      groupKind: "chunk" as const,
      family: "detail" as const,
      title: "Chunk 1",
      displayOrder: 0,
      chunkId: 101,
      topics: TOPICS.filter((topic) => topic.chunkId === 101).map((topic) => ({
        topicId: topic.topicId,
        sessionId,
        family: "detail" as const,
        chunkId: topic.chunkId,
        chunkSequenceOrder: topic.sequenceOrder,
        topicIndex: topic.topicIndex,
        topicText: topic.topicText,
        selected: false,
      })),
    },
    {
      groupId: "chunk:102",
      groupKind: "chunk" as const,
      family: "detail" as const,
      title: "Chunk 2",
      displayOrder: 1,
      chunkId: 102,
      topics: TOPICS.filter((topic) => topic.chunkId === 102).map((topic) => ({
        topicId: topic.topicId,
        sessionId,
        family: "detail" as const,
        chunkId: topic.chunkId,
        chunkSequenceOrder: topic.sequenceOrder,
        topicIndex: topic.topicIndex,
        topicText: topic.topicText,
        selected: false,
      })),
    },
  ] as const;

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
      addedCount: override.addedCount ?? summary.addedCount,
      generationRevision: override.generationRevision ?? summary.generationRevision,
    };
  };

  const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
    if (method === "GetSettings") {
      return forgeSettingsSuccess(workspaceRootPath);
    }

    if (method === "ScanDecks") {
      const decksForCall = options?.scanDecksByCall?.[scanDecksCallCount] ?? decks;
      scanDecksCallCount += 1;
      return {
        type: "success",
        data: {
          rootPath: workspaceRootPath,
          decks: decksForCall.map((deck) => ({ ...deck })),
        },
      };
    }

    if (method === "CreateDeck") {
      const input = payload as { relativePath: string };
      if (options?.createDeckFailureMessage) {
        return typedFailure({
          _tag: "InvalidDeckPath",
          inputPath: input.relativePath,
          reason: "invalid_file_name",
          message: options.createDeckFailureMessage,
        });
      }
      const createdDeck = toDeckEntry(workspaceRootPath, input.relativePath);
      if (!decks.some((deck) => deck.absolutePath === createdDeck.absolutePath)) {
        decks = [...decks, createdDeck].sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath),
        );
      }
      return {
        type: "success",
        data: {
          absolutePath: createdDeck.absolutePath,
        },
      };
    }

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
            sourceLabel: "source.pdf",
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
          outcomes: [{ family: "detail", status: "extracted", errorMessage: null }],
          groups: topicGroups,
        },
      };
    }

    if (method === "ForgeGetTopicExtractionSnapshot") {
      return {
        type: "success",
        data: {
          session: {
            id: sessionId,
            sourceKind: "pdf",
            sourceLabel: "source.pdf",
            sourceFilePath: "/forge/source.pdf",
            deckPath: null,
            sourceFingerprint: "fp",
            status: "topics_extracted",
            errorMessage: null,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
          },
          outcomes: [{ family: "detail", status: "extracted", errorMessage: null }],
          groups: topicGroups,
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
      const input = payload as { topicId: number };
      const state = findTopicStateById(input.topicId);
      if (!state) {
        return typedFailure({
          _tag: "topic_not_found",
          sessionId,
          topicId: input.topicId,
        });
      }

      return {
        type: "success",
        data: {
          topic: toSummary(state),
          cards: state.cards.map((card) => ({
            id: card.id,
            question: card.question,
            answer: card.answer,
            addedToDeck: card.addedToDeck,
          })),
          angles: [],
        },
      };
    }

    if (method === "ForgeGenerateTopicCards") {
      const input = payload as { topicId: number };
      const state = findTopicStateById(input.topicId);
      if (!state) {
        return typedFailure({
          _tag: "topic_not_found",
          sessionId,
          topicId: input.topicId,
        });
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

        return typedFailure({
          _tag: "card_generation_error",
          sessionId,
          chunkId: state.topic.chunkId,
          topicIndex: state.topic.topicIndex,
          message: generationFailureMessage,
        });
      }

      const nextRevision = state.generationRevision + 1;
      const nextCards =
        state.cards.length > 0
          ? state.cards.map((card, index) => ({
              id: card.id,
              question: `${state.topic.topicText} regenerated ${nextRevision}-${index + 1}`,
              answer: `A ${state.topic.topicText} ${nextRevision}-${index + 1}`,
              addedToDeck: false,
            }))
          : [
              {
                id: nextCardId++,
                question: `Q ${state.topic.topicText}`,
                answer: `A ${state.topic.topicText}`,
                addedToDeck: false,
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
            addedToDeck: card.addedToDeck,
          })),
          angles: [],
        },
      };
    }

    if (method === "ForgeUpdateCard") {
      const input = payload as {
        cardId: number;
        question: string;
        answer: string;
      };
      const state = findTopicStateByCardId(input.cardId);
      if (!state) {
        return typedFailure({
          _tag: "card_not_found",
          sourceCardId: input.cardId,
        });
      }

      state.cards = state.cards.map((card) =>
        card.id === input.cardId
          ? {
              id: card.id,
              question: input.question,
              answer: input.answer,
              addedToDeck: card.addedToDeck,
            }
          : card,
      );

      return {
        type: "success",
        data: {
          card: {
            id: input.cardId,
            question: input.question,
            answer: input.answer,
            addedToDeck: state.cards.find((card) => card.id === input.cardId)?.addedToDeck ?? false,
          },
        },
      };
    }

    if (method === "ForgeUpdateDerivation") {
      const input = payload as {
        derivationId: number;
        question: string;
        answer: string;
      };
      for (const [parentKey, derivations] of derivationsByParentKey.entries()) {
        const index = derivations.findIndex((entry) => entry.id === input.derivationId);
        if (index >= 0) {
          const current = derivations[index]!;
          const nextDerivation = {
            ...current,
            question: input.question,
            answer: input.answer,
          };
          derivationsByParentKey.set(parentKey, [
            ...derivations.slice(0, index),
            nextDerivation,
            ...derivations.slice(index + 1),
          ]);
          return {
            type: "success",
            data: {
              derivation: nextDerivation,
            },
          };
        }
      }
      return {
        ...typedFailure({
          _tag: "derivation_not_found",
          derivationId: input.derivationId,
        }),
      };
    }

    if (method === "ForgeGetDerivedCards") {
      const input = payload as {
        parent: { readonly cardId: number } | { readonly derivationId: number };
        kind: "permutation" | "expansion";
      };
      return {
        type: "success",
        data: {
          derivations:
            derivationsByParentKey.get(derivationParentKey(input.parent, input.kind)) ?? [],
        },
      };
    }

    if (method === "ForgeGenerateDerivedCards") {
      const input = payload as {
        parent: { readonly cardId: number } | { readonly derivationId: number };
        kind: "permutation" | "expansion";
        instruction?: string;
      };
      const failureMessage = derivedGenerationFailureMessageByKind[input.kind];
      if (failureMessage) {
        return typedFailure({
          _tag: "derivation_generation_error",
          parent: input.parent,
          kind: input.kind,
          message: failureMessage,
        });
      }
      if (permutationsGenerationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, permutationsGenerationDelayMs));
      }
      const parentDerivation =
        "derivationId" in input.parent ? findDerivationById(input.parent.derivationId) : null;
      const rootCardId =
        "cardId" in input.parent
          ? input.parent.cardId
          : (parentDerivation?.rootCardId ?? input.parent.derivationId);
      const sourceCard = "cardId" in input.parent ? resolveCardById(input.parent.cardId) : null;
      const derivations = [
        {
          id: nextPermutationId++,
          rootCardId,
          parentDerivationId: "derivationId" in input.parent ? input.parent.derivationId : null,
          kind: input.kind,
          derivationOrder: 0,
          question:
            input.kind === "permutation"
              ? `Permutation for ${"cardId" in input.parent ? input.parent.cardId : input.parent.derivationId}`
              : `Expansion for ${(sourceCard?.question ?? parentDerivation?.question ?? rootCardId).toString()}`,
          answer:
            input.kind === "permutation"
              ? "Permutation answer"
              : (sourceCard?.answer ?? parentDerivation?.answer ?? "Expansion answer"),
          instruction: input.instruction ?? null,
          addedCount: 0,
        },
      ];
      derivationsByParentKey.set(derivationParentKey(input.parent, input.kind), derivations);
      return {
        type: "success",
        data: {
          derivations,
        },
      };
    }

    if (method === "ForgeGetCardCloze") {
      const input = payload as {
        source: { readonly cardId: number } | { readonly derivationId: number };
      };
      const key = sourceKey(input.source);
      return {
        type: "success",
        data: {
          source: input.source,
          cloze: clozeBySourceKey.get(key) ?? null,
          addedCount: clozeAddedCountBySourceKey.get(key) ?? 0,
        },
      };
    }

    if (method === "ForgeGenerateCardCloze") {
      const input = payload as {
        source: { readonly cardId: number } | { readonly derivationId: number };
        sourceQuestion?: string;
        sourceAnswer?: string;
      };
      if (clozeGenerationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, clozeGenerationDelayMs));
      }
      const fallbackAnswer =
        "cardId" in input.source
          ? (resolveCardById(input.source.cardId)?.answer ?? String(input.source.cardId))
          : (findDerivationById(input.source.derivationId)?.answer ??
            String(input.source.derivationId));
      const answerToken = (input.sourceAnswer ?? fallbackAnswer).trim().split(/\s+/)[0];
      const cloze = `The answer is {{c1::${answerToken}}}.`;
      const key = sourceKey(input.source);
      const previousCloze = clozeBySourceKey.get(key);
      clozeBySourceKey.set(key, cloze);
      if (previousCloze !== cloze) {
        clozeAddedCountBySourceKey.set(key, 0);
      }
      return {
        type: "success",
        data: {
          source: input.source,
          cloze,
          addedCount: clozeAddedCountBySourceKey.get(key) ?? 0,
        },
      };
    }

    if (method === "ForgeReformulateCard") {
      const input = payload as {
        source: { readonly cardId: number } | { readonly derivationId: number };
        sourceQuestion?: string;
        sourceAnswer?: string;
      };
      const source = input.source;
      if (reformulationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, reformulationDelayMs));
      }
      if (reformulationFailureMessage) {
        return typedFailure({
          _tag: "card_reformulation_error",
          source,
          message: reformulationFailureMessage,
        });
      }

      if ("cardId" in source) {
        const { cardId } = source;
        const state = findTopicStateByCardId(cardId);
        if (!state) {
          return typedFailure({
            _tag: "card_not_found",
            sourceCardId: cardId,
          });
        }

        const currentCard = state.cards.find((card) => card.id === cardId);
        if (!currentCard) {
          return typedFailure({
            _tag: "card_not_found",
            sourceCardId: cardId,
          });
        }

        const rewrittenCard = {
          ...currentCard,
          question: `Reformulated: ${input.sourceQuestion ?? currentCard.question}`,
          answer: `Reformulated: ${input.sourceAnswer ?? currentCard.answer}`,
        };
        state.cards = state.cards.map((card) => (card.id === cardId ? rewrittenCard : card));

        return {
          type: "success",
          data: {
            source,
            card: rewrittenCard,
          },
        };
      }

      const { derivationId } = source;
      for (const [parentKey, derivations] of derivationsByParentKey.entries()) {
        const index = derivations.findIndex((entry) => entry.id === derivationId);
        if (index < 0) continue;

        const current = derivations[index]!;
        const rewrittenDerivation = {
          ...current,
          question: `Reformulated: ${input.sourceQuestion ?? current.question}`,
          answer: `Reformulated: ${input.sourceAnswer ?? current.answer}`,
        };
        derivationsByParentKey.set(parentKey, [
          ...derivations.slice(0, index),
          rewrittenDerivation,
          ...derivations.slice(index + 1),
        ]);

        return {
          type: "success",
          data: {
            source,
            derivation: rewrittenDerivation,
          },
        };
      }

      return typedFailure({
        _tag: "derivation_not_found",
        derivationId,
      });
    }

    if (method === "ForgeListSessions") {
      return { type: "success", data: { sessions: [] } };
    }

    if (method === "ForgeAddCardToDeck") {
      const input = payload as {
        sourceCardId?: number;
        derivationId?: number;
        cardType: "qa" | "cloze";
        content: string;
      };
      const clozeCardCountFromContent = (content: string): number => {
        const indices = new Set(
          Array.from(content.matchAll(/\{\{c(\d+)::/g), (match) => Number(match[1])),
        );
        return Math.max(1, indices.size);
      };
      if (typeof input.sourceCardId === "number") {
        if (input.cardType === "qa") {
          const state = findTopicStateByCardId(input.sourceCardId);
          if (state) {
            state.cards = state.cards.map((card) =>
              card.id === input.sourceCardId ? { ...card, addedToDeck: true } : card,
            );
          }
        }
        if (input.cardType === "cloze") {
          const clozeCardCount = clozeCardCountFromContent(input.content);
          clozeAddedCountBySourceKey.set(
            sourceKey({ cardId: input.sourceCardId }),
            (clozeAddedCountBySourceKey.get(sourceKey({ cardId: input.sourceCardId })) ?? 0) +
              clozeCardCount,
          );
        }
      }
      if (typeof input.derivationId === "number") {
        if (input.cardType === "cloze") {
          const clozeCardCount = clozeCardCountFromContent(input.content);
          clozeAddedCountBySourceKey.set(
            sourceKey({ derivationId: input.derivationId }),
            (clozeAddedCountBySourceKey.get(sourceKey({ derivationId: input.derivationId })) ?? 0) +
              clozeCardCount,
          );
        }

        if (input.cardType === "qa") {
          for (const [parentKey, derivations] of derivationsByParentKey.entries()) {
            const index = derivations.findIndex((entry) => entry.id === input.derivationId);
            if (index < 0) continue;
            const current = derivations[index]!;
            const next = {
              ...current,
              addedCount: current.addedCount + 1,
            };
            derivationsByParentKey.set(parentKey, [
              ...derivations.slice(0, index),
              next,
              ...derivations.slice(index + 1),
            ]);
            break;
          }
        }
      }
      const cardCountForResult =
        input.cardType === "cloze" ? clozeCardCountFromContent(input.content) : 1;
      return {
        type: "success",
        data: {
          cardIds: Array.from({ length: cardCountForResult }, () => `forge-added-${nextCardId++}`),
        },
      };
    }

    if (method === "ForgeSetSessionDeckPath") {
      const input = payload as { sessionId: number; deckPath: string | null };
      const remainingFailuresForDeck =
        input.deckPath === null
          ? undefined
          : remainingDeckPathPersistFailuresByDeckPath.get(input.deckPath);
      if ((remainingFailuresForDeck ?? 0) > 0 && input.deckPath !== null) {
        remainingDeckPathPersistFailuresByDeckPath.set(
          input.deckPath,
          (remainingFailuresForDeck ?? 0) - 1,
        );
        return typedFailure({
          _tag: "session_operation_error",
          sessionId,
          message: "temporary sqlite lock",
        });
      }

      if (remainingDeckPathPersistFailures > 0) {
        remainingDeckPathPersistFailures -= 1;
        return typedFailure({
          _tag: "session_operation_error",
          sessionId,
          message: "temporary sqlite lock",
        });
      }
      return { type: "success", data: {} };
    }

    return {
      type: "failure",
      error: { code: "UNKNOWN_METHOD", message: method },
    };
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
  await expect
    .element(screen.getByRole("complementary").getByText("alpha", { exact: true }))
    .toBeVisible();
};

const openDeckCombobox = () => {
  const trigger = document.querySelector("[data-slot='combobox-trigger']");
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("Expected deck combobox trigger.");
  }
  trigger.click();
};

const getDeckSelectionText = (): string => {
  const trigger = document.querySelector("[data-slot='combobox-trigger']");
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("Expected deck combobox trigger.");
  }
  return trigger.textContent?.replace(/\s+/g, " ").trim() ?? "";
};

const setDeckComboboxInputValue = async (value: string) => {
  await expect
    .poll(() => document.querySelector("[data-slot='combobox-input']") instanceof HTMLInputElement)
    .toBe(true);
  const input = document.querySelector("[data-slot='combobox-input']") as HTMLInputElement;
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await userEvent.type(input, value);
};

const findDeckOption = (relativePath: string) => {
  const options = Array.from(document.querySelectorAll("[data-slot='combobox-item']"));
  return options.find((option) => option.textContent?.includes(relativePath)) ?? null;
};

const selectDeckOption = async (relativePath: string) => {
  await expect.poll(() => Boolean(findDeckOption(relativePath))).toBe(true);
  const option = findDeckOption(relativePath);
  if (!(option instanceof HTMLElement)) {
    throw new Error(`Expected deck option for "${relativePath}".`);
  }
  option.click();
};

const defaultInteractiveState = (): Record<string, InitialTopicState> => ({
  "101:1": {
    status: "generated",
    generationRevision: 1,
    cards: [{ id: 8_001, question: "beta question", answer: "beta answer" }],
  },
});

describe("Forge cards step", () => {
  it("renders the deck combobox in the footer instead of Save to deck", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await expect
      .poll(() => Boolean(document.querySelector("[data-slot='combobox-trigger']")))
      .toBe(true);
    expect(screen.getByText("Save to deck").query()).toBeNull();
  });

  it("auto-selects the first scanned deck on first cards-step entry", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await expect.poll(() => getDeckSelectionText()).toContain("decks/alpha.md");
  });

  it("persists manual deck selection while switching topics", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [{ id: 8_700, question: "alpha question", answer: "alpha answer" }],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    openDeckCombobox();
    await selectDeckOption("decks/beta.md");
    await expect.poll(() => getDeckSelectionText()).toContain("decks/beta.md");
    await expect
      .poll(() =>
        invoke.mock.calls.some(
          ([method, payload]: unknown[]) =>
            method === "ForgeSetSessionDeckPath" &&
            (payload as { sessionId: number; deckPath: string | null })?.sessionId === 77 &&
            (payload as { sessionId: number; deckPath: string | null })?.deckPath ===
              `${FORGE_WORKSPACE_ROOT_PATH}/decks/beta.md`,
        ),
      )
      .toBe(true);

    const sidebar = screen.getByRole("complementary").element();
    if (!(sidebar instanceof HTMLElement)) {
      throw new Error("Expected cards sidebar.");
    }
    const sidebarButtons = Array.from(sidebar.querySelectorAll("button"));
    const betaRow = sidebarButtons.find((button) => button.textContent?.includes("beta"));
    const alphaRow = sidebarButtons.find((button) => button.textContent?.includes("alpha"));
    if (!(betaRow instanceof HTMLElement) || !(alphaRow instanceof HTMLElement)) {
      throw new Error("Expected alpha and beta topic rows.");
    }

    betaRow.click();
    await expect.element(screen.getByText("beta question")).toBeVisible();
    alphaRow.click();
    await expect.element(screen.getByText("alpha question")).toBeVisible();
    await expect.poll(() => getDeckSelectionText()).toContain("decks/beta.md");
  });

  it("retries persisting deck selection after a transient failure", async () => {
    const invoke = createCardsInvoke({
      deckPathPersistFailuresByDeckPath: {
        [`${FORGE_WORKSPACE_ROOT_PATH}/decks/beta.md`]: 1,
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    openDeckCombobox();
    await selectDeckOption("decks/beta.md");
    await expect.poll(() => getDeckSelectionText()).toContain("decks/beta.md");

    await expect
      .poll(
        () =>
          invoke.mock.calls.filter(([method, payload]: unknown[]) => {
            if (method !== "ForgeSetSessionDeckPath") return false;
            const typedPayload = payload as { sessionId: number; deckPath: string | null };
            return (
              typedPayload.sessionId === 77 &&
              typedPayload.deckPath === `${FORGE_WORKSPACE_ROOT_PATH}/decks/beta.md`
            );
          }).length,
      )
      .toBeGreaterThanOrEqual(2);
  });

  it("creates a deck from the combobox and selects it", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    openDeckCombobox();
    await setDeckComboboxInputValue("new-forge");

    await selectDeckOption("new-forge.md");

    await expect.poll(() => getDeckSelectionText()).toContain("new-forge.md");
    await expect
      .poll(
        () =>
          invoke.mock.calls.find(([method]: unknown[]) => method === "CreateDeck") as
            | [string, { relativePath: string; createParents?: boolean }]
            | undefined,
      )
      .toBeTruthy();

    const createDeckCall = invoke.mock.calls.find(
      ([method]: unknown[]) => method === "CreateDeck",
    ) as [string, { relativePath: string; createParents?: boolean }] | undefined;
    expect(createDeckCall?.[1]).toEqual({
      relativePath: "new-forge.md",
      createParents: true,
    });
  });

  it("shows a create deck error when creation fails", async () => {
    const invoke = createCardsInvoke({
      createDeckFailureMessage: "permission denied",
    });
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    openDeckCombobox();
    await setDeckComboboxInputValue("broken-deck");
    await selectDeckOption("broken-deck.md");

    await expect
      .poll(() => invoke.mock.calls.filter(([method]: unknown[]) => method === "CreateDeck").length)
      .toBe(1);
    await expect
      .poll(() => {
        const error = document.querySelector("span.text-destructive");
        return error?.textContent?.trim() ?? "";
      })
      .not.toBe("");
    await expect.poll(() => getDeckSelectionText()).toContain("decks/alpha.md");
  });

  it("clears target deck when a selected deck is missing after rescan", async () => {
    const invoke = createCardsInvoke({
      scanDecksByCall: [DEFAULT_FORGE_DECKS, DEFAULT_FORGE_DECKS],
    });
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    openDeckCombobox();
    await setDeckComboboxInputValue("disappears-deck");
    await selectDeckOption("disappears-deck.md");

    await expect.poll(() => getDeckSelectionText()).toContain("select deck");
    await expect.poll(() => getDeckSelectionText().includes("decks/alpha.md")).toBe(false);
    await expect
      .poll(() =>
        invoke.mock.calls.some(
          ([method, payload]: unknown[]) =>
            method === "ForgeSetSessionDeckPath" &&
            (payload as { sessionId: number; deckPath: string | null })?.sessionId === 77 &&
            (payload as { sessionId: number; deckPath: string | null })?.deckPath === null,
        ),
      )
      .toBe(true);
  });

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
      .map(([, payload]: unknown[]) => payload as { sessionId: number; topicId: number });

    expect(generatedPayloads).toEqual([
      { sessionId: 77, topicId: 1001 },
      { sessionId: 77, topicId: 1002 },
      { sessionId: 77, topicId: 1003 },
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

    const betaRow = screen.getByText("beta", { exact: true }).element().closest("button");
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
    const betaRow = screen.getByText("beta", { exact: true }).element().closest("button");
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
          const input = payload as { topicId: number };
          return input.topicId === 1002;
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

    const betaRow = screen.getByText("beta", { exact: true }).element().closest("button");
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
          const input = payload as { topicId: number };
          return input.topicId === 1001;
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
          cards: [
            {
              id: 8_120,
              question: "alpha already generated",
              answer: "alpha answer",
            },
          ],
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

    await expect.element(screen.getByText("Generating cards...")).toBeVisible();
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
          cards: [
            {
              id: 8_200,
              question: "editable question",
              answer: "editable answer",
            },
          ],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const questionEditor = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".editor-prosemirror[contenteditable='true']");
      if (!el) throw new Error("tiptap editor not found");
      return el;
    });
    questionEditor.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement API for contenteditable editing in tests
    document.execCommand("selectAll");
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand("insertText", false, "edited question");

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(([method]: unknown[]) => method === "ForgeUpdateCard")
          .length;
      })
      .toBeGreaterThanOrEqual(1);

    const updateCall = invoke.mock.calls.findLast(
      ([method]: unknown[]) => method === "ForgeUpdateCard",
    ) as [string, { cardId: number; question: string; answer: string }] | undefined;
    expect(updateCall?.[1]).toEqual({
      cardId: 8_200,
      question: "edited question",
      answer: "editable answer",
    });
  });

  it("uses edited source card content when regenerating permutations", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [
            {
              id: 8_210,
              question: "editable source question",
              answer: "editable source answer",
            },
          ],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const questionEditor = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".editor-prosemirror[contenteditable='true']");
      if (!el) throw new Error("tiptap editor not found");
      return el;
    });
    questionEditor.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement API for contenteditable editing in tests
    document.execCommand("selectAll");
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand("insertText", false, "edited source question");

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(([method]: unknown[]) => method === "ForgeUpdateCard")
          .length;
      })
      .toBeGreaterThanOrEqual(1);

    const sourceUpdateCall = invoke.mock.calls.findLast(
      ([method]: unknown[]) => method === "ForgeUpdateCard",
    ) as [string, { cardId: number; question: string; answer: string }] | undefined;
    expect(sourceUpdateCall?.[1]).toEqual({
      cardId: 8_210,
      question: "edited source question",
      answer: "editable source answer",
    });

    await userEvent.click(screen.getByRole("button", { name: "Permutations" }));

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateDerivedCards",
        ).length;
      })
      .toBe(1);

    const firstGenerateCall = invoke.mock.calls.find(
      ([method]: unknown[]) => method === "ForgeGenerateDerivedCards",
    ) as [string, { parent: { cardId: number }; kind: "permutation" }];
    expect(firstGenerateCall[1]).toEqual({
      parent: { cardId: 8_210 },
      kind: "permutation",
    });

    await expect.element(screen.getByText("variations generated")).toBeVisible();
    const panelRegenerateButton = screen
      .getByText("variations generated")
      .element()
      .closest("div")!
      .querySelector("button")!;
    (panelRegenerateButton as HTMLElement).click();

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateDerivedCards",
        ).length;
      })
      .toBe(2);

    const regenerateCall = invoke.mock.calls
      .filter(([method]: unknown[]) => method === "ForgeGenerateDerivedCards")
      .at(-1) as [string, { parent: { cardId: number }; kind: "permutation" }];

    expect(regenerateCall[1]).toEqual({
      parent: { cardId: 8_210 },
      kind: "permutation",
    });
  });

  it("uses edited source card content when regenerating cloze", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [
            {
              id: 8_220,
              question: "editable cloze question",
              answer: "editable cloze answer",
            },
          ],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const answerEditor = await vi.waitFor(() => {
      const editors = Array.from(
        document.querySelectorAll<HTMLElement>(".editor-prosemirror[contenteditable='true']"),
      );
      const sourceEditor = editors.find((editor) =>
        editor.textContent?.includes("editable cloze answer"),
      );
      if (!sourceEditor) throw new Error("cloze answer editor not found");
      return sourceEditor;
    });
    answerEditor.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement API for contenteditable editing in tests
    document.execCommand("selectAll");
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand("insertText", false, "edited cloze answer");

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(([method]: unknown[]) => method === "ForgeUpdateCard")
          .length;
      })
      .toBeGreaterThanOrEqual(1);

    await userEvent.click(screen.getByRole("button", { name: "Cloze" }));

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateCardCloze",
        ).length;
      })
      .toBe(1);

    const firstGenerateCall = invoke.mock.calls.find(
      ([method]: unknown[]) => method === "ForgeGenerateCardCloze",
    ) as [string, { source: { cardId: number }; sourceQuestion: string; sourceAnswer: string }];
    expect(firstGenerateCall[1]).toEqual({
      source: { cardId: 8_220 },
      sourceQuestion: "editable cloze question",
      sourceAnswer: "edited cloze answer",
    });

    await expect.element(screen.getByText("Cloze conversion")).toBeVisible();
    const panelRegenerateButton = screen
      .getByText("Cloze conversion")
      .element()
      .closest("div")!
      .querySelector("button")!;
    (panelRegenerateButton as HTMLElement).click();

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateCardCloze",
        ).length;
      })
      .toBe(2);

    const regenerateCall = invoke.mock.calls
      .filter(([method]: unknown[]) => method === "ForgeGenerateCardCloze")
      .at(-1) as [
      string,
      { source: { cardId: number }; sourceQuestion: string; sourceAnswer: string },
    ];

    expect(regenerateCall[1]).toEqual({
      source: { cardId: 8_220 },
      sourceQuestion: "editable cloze question",
      sourceAnswer: "edited cloze answer",
    });
  });

  it("reformulates a root card with the latest visible content and disables the row while pending", async () => {
    const invoke = createCardsInvoke({
      reformulationDelayMs: 150,
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [
            {
              id: 8_225,
              question: "editable reformulate question",
              answer: "editable reformulate answer",
            },
          ],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const questionEditor = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".editor-prosemirror[contenteditable='true']");
      if (!el) throw new Error("tiptap editor not found");
      return el;
    });
    questionEditor.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement API for contenteditable editing in tests
    document.execCommand("selectAll");
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand("insertText", false, "edited reformulate question");

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(([method]: unknown[]) => method === "ForgeUpdateCard")
          .length;
      })
      .toBeGreaterThanOrEqual(1);

    const reformulateButton = screen.getByRole("button", { name: "Reformulate card" });
    (reformulateButton.element() as HTMLButtonElement).click();

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(([method]: unknown[]) => method === "ForgeReformulateCard")
          .length;
      })
      .toBe(1);

    const reformulateCall = invoke.mock.calls.findLast(
      ([method]: unknown[]) => method === "ForgeReformulateCard",
    ) as
      | [
          string,
          {
            source: { cardId: number };
            sourceQuestion: string;
            sourceAnswer: string;
          },
        ]
      | undefined;
    expect(reformulateCall?.[1]).toEqual({
      source: { cardId: 8_225 },
      sourceQuestion: "edited reformulate question",
      sourceAnswer: "editable reformulate answer",
    });

    await expect
      .poll(
        () =>
          (screen.getByRole("button", { name: "Reformulate card" }).element() as HTMLButtonElement)
            .disabled,
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          screen.getByRole("button", { name: "Reformulate card" }).element().closest(".group")
            ?.className,
      )
      .toContain("animate-pulse");

    await expect
      .element(screen.getByText("Reformulated: edited reformulate question"))
      .toBeVisible();
    await expect
      .element(screen.getByText("Reformulated: editable reformulate answer"))
      .toBeVisible();
  });

  it("reformulates a derivation card from the expansion column", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [
            {
              id: 8_228,
              question: "expandable reformulate question",
              answer: "expandable reformulate answer",
            },
          ],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    await userEvent.click(screen.getByText("Generate cards", { exact: false }));

    await expect
      .element(screen.getByText("Expansion for expandable reformulate question"))
      .toBeVisible();

    const derivationRow = screen
      .getByText("Expansion for expandable reformulate question")
      .element()
      .closest(".group");
    if (!(derivationRow instanceof HTMLElement)) {
      throw new Error("Expected derivation row.");
    }

    const reformulateButton = derivationRow.querySelector("button[aria-label='Reformulate card']");
    if (!(reformulateButton instanceof HTMLButtonElement)) {
      throw new Error("Expected derivation reformulate button.");
    }
    reformulateButton.click();

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(([method]: unknown[]) => method === "ForgeReformulateCard")
          .length;
      })
      .toBe(1);

    const reformulateCall = invoke.mock.calls.findLast(
      ([method]: unknown[]) => method === "ForgeReformulateCard",
    ) as
      | [
          string,
          {
            source: { derivationId: number };
            sourceQuestion: string;
            sourceAnswer: string;
          },
        ]
      | undefined;
    expect(reformulateCall?.[1]).toEqual({
      source: { derivationId: 12_000 },
      sourceQuestion: "Expansion for expandable reformulate question",
      sourceAnswer: "expandable reformulate answer",
    });

    await expect
      .element(screen.getByText("Reformulated: Expansion for expandable reformulate question"))
      .toBeVisible();
    await expect
      .element(screen.getByText("Reformulated: expandable reformulate answer"))
      .toBeVisible();
  });

  it("renders permutation generation errors from the mutation path", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [
            {
              id: 8_230,
              question: "broken permutation question",
              answer: "broken permutation answer",
            },
          ],
        },
      },
      derivedGenerationFailureMessageByKind: {
        permutation: "permutation generation failed",
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Permutations" }));

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method]: unknown[]) => method === "ForgeGenerateDerivedCards",
        ).length;
      })
      .toBe(1);
    await expect.element(screen.getByText("permutation generation failed")).toBeVisible();
  });

  it("renders expansion generation errors from the mutation path", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [
            {
              id: 8_235,
              question: "broken expansion question",
              answer: "broken expansion answer",
            },
          ],
        },
      },
      derivedGenerationFailureMessageByKind: {
        expansion: "expansion generation failed",
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    await userEvent.click(screen.getByRole("button", { name: "Generate cards" }));

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method, payload]: unknown[]) =>
            method === "ForgeGenerateDerivedCards" &&
            typeof payload === "object" &&
            payload !== null &&
            "kind" in payload &&
            payload.kind === "expansion",
        ).length;
      })
      .toBe(1);
    await expect.element(screen.getByText("expansion generation failed")).toBeVisible();
  });

  it("opens an expansion column and generates expansion cards from a root card", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [
            {
              id: 8_240,
              question: "expandable question",
              answer: "expandable answer",
            },
          ],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Expand" }));

    const instructionField = screen.getByPlaceholder("What should these cards focus on?");
    await expect.element(instructionField).toBeVisible();
    await userEvent.fill(instructionField, "deeper detail");

    await userEvent.click(screen.getByText("Generate cards", { exact: false }));

    await expect
      .poll(() => {
        return invoke.mock.calls.filter(
          ([method, payload]: unknown[]) =>
            method === "ForgeGenerateDerivedCards" &&
            typeof payload === "object" &&
            payload !== null &&
            "kind" in payload &&
            payload.kind === "expansion",
        ).length;
      })
      .toBe(1);

    const expansionCall = invoke.mock.calls.find(
      ([method, payload]: unknown[]) =>
        method === "ForgeGenerateDerivedCards" &&
        typeof payload === "object" &&
        payload !== null &&
        "kind" in payload &&
        payload.kind === "expansion",
    ) as
      | [string, { parent: { cardId: number }; kind: "expansion"; instruction: string }]
      | undefined;

    expect(expansionCall?.[1]).toEqual({
      parent: { cardId: 8_240 },
      kind: "expansion",
      instruction: "deeper detail",
    });
    await expect.element(screen.getByText("Expansion for expandable question")).toBeVisible();
    await expect.element(screen.getByText('"deeper detail"')).toBeVisible();
  });

  it("ForgeUpdateDerivation mock updates permutation data correctly", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [
            {
              id: 8_250,
              question: "perm source question",
              answer: "perm source answer",
            },
          ],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Permutations" }));
    await expect.element(screen.getByText("Permutation for 8250")).toBeVisible();

    const derivationId = 12_000;
    const updateResult = await invoke("ForgeUpdateDerivation", {
      derivationId,
      question: "updated question",
      answer: "updated answer",
    });

    expect(updateResult).toEqual({
      type: "success",
      data: {
        derivation: {
          id: derivationId,
          rootCardId: 8_250,
          parentDerivationId: null,
          kind: "permutation",
          derivationOrder: 0,
          question: "updated question",
          answer: "updated answer",
          instruction: null,
          addedCount: 0,
        },
      },
    });

    const getResult = await invoke("ForgeGetDerivedCards", {
      parent: { cardId: 8_250 },
      kind: "permutation",
    });
    expect(getResult.data.derivations[0]).toEqual({
      id: derivationId,
      rootCardId: 8_250,
      parentDerivationId: null,
      kind: "permutation",
      derivationOrder: 0,
      question: "updated question",
      answer: "updated answer",
      instruction: null,
      addedCount: 0,
    });

    const notFoundResult = await invoke("ForgeUpdateDerivation", {
      derivationId: 999_999,
      question: "x",
      answer: "y",
    });
    expect(notFoundResult.type).toBe("failure");
    expect(notFoundResult.error.tag).toBe("derivation_not_found");
  });

  it("auto-generates permutations and cloze variants when panels open empty", async () => {
    const invoke = createCardsInvoke({
      initialByTopicKey: {
        ...defaultInteractiveState(),
        "101:0": {
          status: "generated",
          generationRevision: 1,
          cards: [
            {
              id: 8_300,
              question: "variant question",
              answer: "variant answer",
            },
          ],
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
          ([method]: unknown[]) => method === "ForgeGenerateDerivedCards",
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
          cards: [
            {
              id: 8_400,
              question: "exclusive question",
              answer: "exclusive answer",
            },
          ],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Permutations" }));
    await expect.element(screen.getByText("Permutation for 8400")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Cloze" }));
    await expect.element(screen.getByText("Permutation for 8400")).not.toBeVisible();
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
          cards: [
            {
              id: 8_450,
              question: "in-flight question",
              answer: "in-flight answer",
            },
          ],
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
          ([method]: unknown[]) => method === "ForgeGenerateDerivedCards",
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
          invoke.mock.calls.filter(([method]: unknown[]) => method === "ForgeGenerateDerivedCards")
            .length,
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
          cards: [
            {
              id: 8_500,
              question: "persist question",
              answer: "persist answer",
            },
          ],
        },
      },
    });
    mockDesktopGlobals(invoke);

    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    await userEvent.click(screen.getByRole("button", { name: "Permutations" }));
    await expect.element(screen.getByText("Permutation for 8500")).toBeVisible();

    const sidebar = screen.getByRole("complementary").element();
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
