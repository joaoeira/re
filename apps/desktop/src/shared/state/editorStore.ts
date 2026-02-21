import { createStore } from "@xstate/store";

const QA_SEPARATOR = "\n---\n";

const splitQaContent = (content: string): { frontContent: string; backContent: string } => {
  const separatorIndex = content.indexOf(QA_SEPARATOR);

  if (separatorIndex === -1) {
    return {
      frontContent: content.trim(),
      backContent: "",
    };
  }

  return {
    frontContent: content.slice(0, separatorIndex).trim(),
    backContent: content.slice(separatorIndex + QA_SEPARATOR.length).trim(),
  };
};

export const createEditorStore = () =>
  createStore({
    context: {
      mode: "create" as "create" | "edit",
      cardType: "qa" as "qa" | "cloze",
      deckPath: null as string | null,
      editCardId: null as string | null,
      editCardIds: [] as readonly string[],
      frontContent: "",
      backContent: "",
      clozeContent: "",
      frontFrozen: false,
      backFrozen: false,
      clozeFrozen: false,
      dirty: false,
      isDuplicate: false,
      duplicateDeckPath: null as string | null,
      addedCount: 0,
      lastError: null as string | null,
      isSubmitting: false,
    },
    on: {
      loadCreate: (context, event: { deckPath: string | null }) => ({
        ...context,
        mode: "create" as const,
        cardType: "qa" as const,
        deckPath: event.deckPath,
        editCardId: null,
        editCardIds: [],
        frontContent: "",
        backContent: "",
        clozeContent: "",
        dirty: false,
        isDuplicate: false,
        duplicateDeckPath: null,
        lastError: null,
        isSubmitting: false,
      }),
      loadForEdit: (
        context,
        event: {
          content: string;
          cardType: "qa" | "cloze";
          cardId: string;
          cardIds: readonly string[];
          deckPath: string;
        },
      ) => ({
        ...context,
        mode: "edit" as const,
        cardType: event.cardType,
        deckPath: event.deckPath,
        editCardId: event.cardId,
        editCardIds: event.cardIds,
        dirty: false,
        isDuplicate: false,
        duplicateDeckPath: null,
        lastError: null,
        isSubmitting: false,
        ...(event.cardType === "qa"
          ? { ...splitQaContent(event.content), clozeContent: "" }
          : { frontContent: "", backContent: "", clozeContent: event.content.trim() }),
      }),
      setEditIdentity: (context, event: { cardIds: readonly string[]; cardId: string | null }) => ({
        ...context,
        editCardIds: event.cardIds,
        editCardId: event.cardId,
      }),
      setCardType: (context, event: { cardType: "qa" | "cloze" }) => ({
        ...context,
        cardType: event.cardType,
        dirty: context.dirty || context.cardType !== event.cardType,
      }),
      setDeckPath: (context, event: { deckPath: string | null }) => ({
        ...context,
        deckPath: event.deckPath,
      }),
      setFrontContent: (context, event: { content: string }) => ({
        ...context,
        frontContent: event.content,
        dirty: true,
      }),
      setBackContent: (context, event: { content: string }) => ({
        ...context,
        backContent: event.content,
        dirty: true,
      }),
      setClozeContent: (context, event: { content: string }) => ({
        ...context,
        clozeContent: event.content,
        dirty: true,
      }),
      toggleFrontFrozen: (context) => ({
        ...context,
        frontFrozen: !context.frontFrozen,
      }),
      toggleBackFrozen: (context) => ({
        ...context,
        backFrozen: !context.backFrozen,
      }),
      toggleClozeFrozen: (context) => ({
        ...context,
        clozeFrozen: !context.clozeFrozen,
      }),
      setDuplicate: (context, event: { isDuplicate: boolean; deckPath: string | null }) => ({
        ...context,
        isDuplicate: event.isDuplicate,
        duplicateDeckPath: event.deckPath,
      }),
      setSubmitting: (context, event: { isSubmitting: boolean }) => ({
        ...context,
        isSubmitting: event.isSubmitting,
      }),
      setError: (context, event: { error: string | null }) => ({
        ...context,
        lastError: event.error,
      }),
      itemSaved: (context) => ({
        ...context,
        addedCount: context.addedCount + 1,
        frontContent: context.mode === "create" && !context.frontFrozen ? "" : context.frontContent,
        backContent: context.mode === "create" && !context.backFrozen ? "" : context.backContent,
        clozeContent: context.mode === "create" && !context.clozeFrozen ? "" : context.clozeContent,
        dirty: false,
        isDuplicate: false,
        duplicateDeckPath: null,
        lastError: null,
        isSubmitting: false,
      }),
    },
  });

export type EditorStore = ReturnType<typeof createEditorStore>;
