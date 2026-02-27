import { useMemo, useReducer } from "react";

import { useForgePageStore } from "../forge-page-context";
import { topicKey } from "../forge-page-store";
import type { TopicCardGeneration } from "./mock-cards-data";
import { createMockCardsForTopic } from "./mock-cards-data";
import { CardsCanvas } from "./cards-canvas";
import { CardsFooter } from "./cards-footer";
import { CardsSidebar } from "./cards-sidebar";

type CardsTopic = {
  readonly topicKey: string;
  readonly text: string;
};

type CardsState = {
  readonly topics: ReadonlyArray<CardsTopic>;
  readonly activeTopicKey: string | null;
  readonly generationByTopic: ReadonlyMap<string, TopicCardGeneration>;
  readonly addedCardIds: ReadonlySet<string>;
  readonly deletedCardIds: ReadonlySet<string>;
};

type CardsAction =
  | { readonly type: "selectTopic"; readonly topicKey: string }
  | { readonly type: "addCard"; readonly cardId: string }
  | { readonly type: "deleteCard"; readonly cardId: string }
  | {
      readonly type: "editCard";
      readonly cardId: string;
      readonly field: "question" | "answer";
      readonly value: string;
    }
  | { readonly type: "addPermutation"; readonly cardId: string }
  | { readonly type: "addCloze"; readonly cardId: string }
  | { readonly type: "regenerateTopic"; readonly topicKey: string }
  | { readonly type: "generateCards"; readonly topicKey: string };

function cardsReducer(state: CardsState, action: CardsAction): CardsState {
  switch (action.type) {
    case "selectTopic":
      return { ...state, activeTopicKey: action.topicKey };

    case "addCard":
      return { ...state, addedCardIds: new Set([...state.addedCardIds, action.cardId]) };

    case "deleteCard":
      return {
        ...state,
        deletedCardIds: new Set([...state.deletedCardIds, action.cardId]),
      };

    case "editCard": {
      const gen = state.activeTopicKey ? state.generationByTopic.get(state.activeTopicKey) : null;
      if (!gen) return state;

      const updatedCards = gen.cards.map((c) =>
        c.id === action.cardId ? { ...c, [action.field]: action.value } : c,
      );
      const next = new Map(state.generationByTopic);
      next.set(gen.topicKey, { ...gen, cards: updatedCards });
      return { ...state, generationByTopic: next };
    }

    case "addPermutation":
    case "addCloze":
      return state;

    case "regenerateTopic": {
      const topic = state.topics.find((t) => t.topicKey === action.topicKey);
      if (!topic) return state;
      const next = new Map(state.generationByTopic);
      next.set(action.topicKey, createMockCardsForTopic(topic.text, action.topicKey));
      return { ...state, generationByTopic: next };
    }

    case "generateCards": {
      const topic = state.topics.find((t) => t.topicKey === action.topicKey);
      if (!topic) return state;
      const next = new Map(state.generationByTopic);
      next.set(action.topicKey, createMockCardsForTopic(topic.text, action.topicKey));
      return { ...state, generationByTopic: next };
    }
  }
}

function initCardsState(topics: ReadonlyArray<CardsTopic>): CardsState {
  const generationByTopic = new Map<string, TopicCardGeneration>();
  for (const topic of topics) {
    generationByTopic.set(topic.topicKey, createMockCardsForTopic(topic.text, topic.topicKey));
  }

  return {
    topics,
    activeTopicKey: topics[0]?.topicKey ?? null,
    generationByTopic,
    addedCardIds: new Set(),
    deletedCardIds: new Set(),
  };
}

export function CardsStep() {
  const store = useForgePageStore();

  const selectedTopics = useMemo((): ReadonlyArray<CardsTopic> => {
    const { topicsByChunk, selectedTopicKeys } = store.getSnapshot().context;
    const result: CardsTopic[] = [];
    for (const chunk of topicsByChunk) {
      for (let i = 0; i < chunk.topics.length; i++) {
        const key = topicKey(chunk.chunkId, i);
        if (selectedTopicKeys.has(key)) {
          result.push({ topicKey: key, text: chunk.topics[i]! });
        }
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [state, dispatch] = useReducer(cardsReducer, selectedTopics, initCardsState);

  const activeGen = state.activeTopicKey
    ? (state.generationByTopic.get(state.activeTopicKey) ?? null)
    : null;
  const activeTopic = state.topics.find((t) => t.topicKey === state.activeTopicKey);

  const { totalCards, totalAdded } = useMemo(() => {
    let cards = 0;
    let added = 0;
    for (const gen of state.generationByTopic.values()) {
      for (const card of gen.cards) {
        if (state.deletedCardIds.has(card.id)) continue;
        cards++;
        if (state.addedCardIds.has(card.id)) added++;
      }
    }
    return { totalCards: cards, totalAdded: added };
  }, [state.generationByTopic, state.addedCardIds, state.deletedCardIds]);

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <CardsSidebar
          topics={state.topics}
          activeTopicKey={state.activeTopicKey}
          generationByTopic={state.generationByTopic}
          addedCardIds={state.addedCardIds}
          deletedCardIds={state.deletedCardIds}
          onSelectTopic={(key) => dispatch({ type: "selectTopic", topicKey: key })}
        />
        <CardsCanvas
          topicText={activeTopic?.text ?? null}
          generation={activeGen}
          addedCardIds={state.addedCardIds}
          deletedCardIds={state.deletedCardIds}
          onAddCard={(cardId) => dispatch({ type: "addCard", cardId })}
          onDeleteCard={(cardId) => dispatch({ type: "deleteCard", cardId })}
          onEditCard={(cardId, field, value) =>
            dispatch({ type: "editCard", cardId, field, value })
          }
          onAddPermutation={(cardId) => dispatch({ type: "addPermutation", cardId })}
          onAddCloze={(cardId) => dispatch({ type: "addCloze", cardId })}
          onRegenerate={() => {
            if (state.activeTopicKey) {
              dispatch({ type: "regenerateTopic", topicKey: state.activeTopicKey });
            }
          }}
          onGenerateCards={() => {
            if (state.activeTopicKey) {
              dispatch({ type: "generateCards", topicKey: state.activeTopicKey });
            }
          }}
        />
      </div>
      <CardsFooter addedCount={totalAdded} totalCount={totalCards} />
    </>
  );
}
