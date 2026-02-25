import { assign, fromPromise, raise, setup, type SnapshotFrom } from "xstate";

import type { Option } from "effect";
import type { ScanDecksResult } from "@re/workspace";
import { hasClozeDeletion } from "@re/core";

import {
  buildEditorContent,
  QA_SEPARATOR,
  normalizeDeckPathFromSearch,
  toDuplicateStatus,
  toErrorMessage,
} from "@shared/state/editor-utils";

export type EditorSearchParams =
  | { mode: "create"; deckPath?: string }
  | { mode: "edit"; deckPath: string; cardId: string };

export type DeckEntry = ScanDecksResult["decks"][number];

export interface EditorSessionServices {
  readonly getSettings: () => Promise<{
    readonly workspace: {
      readonly rootPath: string | null;
    };
  }>;
  readonly scanDecks: (input: { readonly rootPath: string }) => Promise<{
    readonly decks: readonly DeckEntry[];
  }>;
  readonly getItemForEdit: (input: {
    readonly deckPath: string;
    readonly cardId: string;
  }) => Promise<{
    readonly content: string;
    readonly cardType: "qa" | "cloze";
    readonly cardIds: readonly string[];
  }>;
  readonly checkDuplicates: (input: {
    readonly content: string;
    readonly cardType: "qa" | "cloze";
    readonly rootPath: string;
    readonly excludeCardIds: readonly string[];
  }) => Promise<{
    readonly isDuplicate: boolean;
    readonly matchingDeckPath: Option.Option<string>;
  }>;
  readonly appendItem: (input: {
    readonly deckPath: string;
    readonly content: string;
    readonly cardType: "qa" | "cloze";
  }) => Promise<unknown>;
  readonly replaceItem: (input: {
    readonly deckPath: string;
    readonly cardId: string;
    readonly content: string;
    readonly cardType: "qa" | "cloze";
  }) => Promise<{
    readonly cardIds: readonly string[];
  }>;
  readonly createDeck: (input: {
    readonly relativePath: string;
    readonly createParents: boolean;
  }) => Promise<{
    readonly absolutePath: string;
  }>;
}

export interface EditorSessionViewContext {
  readonly mode: "create" | "edit";
  readonly cardType: "qa" | "cloze";
  readonly deckPath: string | null;
  readonly editCardId: string | null;
  readonly editCardIds: readonly string[];
  readonly frontContent: string;
  readonly backContent: string;
  readonly frontFrozen: boolean;
  readonly backFrozen: boolean;
  readonly dirty: boolean;
  readonly isDuplicate: boolean;
  readonly duplicateDeckPath: string | null;
  readonly addedCount: number;
  readonly lastError: string | null;
  readonly isSubmitting: boolean;
}

interface EditorSessionContext extends EditorSessionViewContext {
  readonly rootPath: string | null;
  readonly decks: readonly DeckEntry[];
  readonly loading: boolean;
  readonly flashMessage: string | null;
  readonly currentRequest: EditorSearchParams;
  readonly pendingCreateDeckRelativePath: string | null;
  readonly pendingSubmit: PendingSubmitSnapshot | null;
}

interface PendingSubmitSnapshot {
  readonly mode: "create" | "edit";
  readonly cardType: "qa" | "cloze";
  readonly deckPath: string | null;
  readonly editCardId: string | null;
  readonly editCardIds: readonly string[];
  readonly frontContent: string;
  readonly backContent: string;
  readonly rootPath: string | null;
}

type EditorSessionPublicEvent =
  | { type: "REQUEST_LOAD"; search: EditorSearchParams }
  | { type: "SET_DECK_PATH"; deckPath: string | null }
  | { type: "SET_FRONT_CONTENT"; content: string }
  | { type: "SET_BACK_CONTENT"; content: string }
  | { type: "TOGGLE_FRONT_FROZEN" }
  | { type: "TOGGLE_BACK_FROZEN" }
  | { type: "REFRESH_DECKS" }
  | { type: "SUBMIT" }
  | { type: "CREATE_DECK"; relativePath: string };

type EditorSessionInternalEvent = { type: "REEVALUATE_DUPLICATES" };
type EditorSessionSetFlashEvent = { type: "SET_FLASH"; message: string };

type EditorSessionEvent =
  | EditorSessionPublicEvent
  | EditorSessionInternalEvent
  | EditorSessionSetFlashEvent;

export type EditorSessionSendEvent = EditorSessionPublicEvent;

interface InitializeOutput {
  readonly rootPath: string | null;
  readonly decks: readonly DeckEntry[];
  readonly lastError: string | null;
  readonly session: EditorSessionViewContext;
}

type SubmitActorOutput =
  | {
      readonly type: "duplicate";
      readonly duplicateDeckPath: string | null;
    }
  | {
      readonly type: "saved";
      readonly deckPath: string;
      readonly editIdentity: {
        readonly cardIds: readonly string[];
        readonly cardId: string | null;
      } | null;
    };

interface CreateDeckOutput {
  readonly decks: readonly DeckEntry[];
  readonly absolutePath: string;
}

interface DuplicateCheckOutput {
  readonly isDuplicate: boolean;
  readonly duplicateDeckPath: string | null;
}

const DUPLICATE_CHECK_DEBOUNCE_MS = 400;
const FLASH_DURATION_MS = 2500;

const NO_WORKSPACE_ERROR = "No workspace configured. Set a workspace root path in settings.";
const EDIT_MODE_REQUIRES_IDS_ERROR = "Edit mode requires both deckPath and cardId.";
const SELECT_DECK_ERROR = "Select a deck before saving.";
const WORKSPACE_PATH_UNAVAILABLE_ERROR = "Workspace root path is unavailable.";
const MISSING_EDIT_CARD_ID_ERROR = "Missing card id for edit operation.";
const DUPLICATE_ERROR = "Duplicate content detected. Change the card before saving.";
const MISSING_FRONT_BACK_ERROR = "Both Front and Back are required.";
const MISSING_CLOZE_CONTENT_ERROR = "Cloze content cannot be empty.";
const MISSING_DECK_SELECTED_ERROR = "The selected deck no longer exists in the current workspace.";

const toSavedFlashMessage = (
  mode: "create" | "edit",
  decks: readonly DeckEntry[],
  deckPath: string,
): string => {
  const savedDeck = decks.find((deck) => deck.absolutePath === deckPath);
  const deckName = savedDeck?.name ?? "deck";
  return mode === "edit" ? `Saved to ${deckName}` : `Card added to ${deckName}`;
};

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

const createBaseViewContext = (): EditorSessionViewContext => ({
  mode: "create",
  cardType: "qa",
  deckPath: null,
  editCardId: null,
  editCardIds: [] as readonly string[],
  frontContent: "",
  backContent: "",
  frontFrozen: false,
  backFrozen: false,
  dirty: false,
  isDuplicate: false,
  duplicateDeckPath: null,
  addedCount: 0,
  lastError: null,
  isSubmitting: false,
});

const createPendingSubmitSnapshot = (context: EditorSessionContext): PendingSubmitSnapshot => ({
  mode: context.mode,
  cardType: context.cardType,
  deckPath: context.deckPath,
  editCardId: context.editCardId,
  editCardIds: context.editCardIds,
  frontContent: context.frontContent,
  backContent: context.backContent,
  rootPath: context.rootPath,
});

const hasDraftChangedSinceSubmit = (
  context: EditorSessionContext,
  submitted: PendingSubmitSnapshot,
): boolean =>
  context.mode !== submitted.mode ||
  context.cardType !== submitted.cardType ||
  context.deckPath !== submitted.deckPath ||
  context.frontContent !== submitted.frontContent ||
  context.backContent !== submitted.backContent;

const buildCreateViewContext = (deckPath: string | null): EditorSessionViewContext => ({
  ...createBaseViewContext(),
  mode: "create",
  deckPath,
});

const buildEditViewContext = (input: {
  readonly content: string;
  readonly cardType: "qa" | "cloze";
  readonly cardId: string;
  readonly cardIds: readonly string[];
  readonly deckPath: string;
}): EditorSessionViewContext => ({
  ...createBaseViewContext(),
  mode: "edit",
  cardType: input.cardType,
  deckPath: input.deckPath,
  editCardId: input.cardId,
  editCardIds: input.cardIds,
  ...(input.cardType === "qa"
    ? splitQaContent(input.content)
    : { frontContent: input.content.trim(), backContent: "" }),
});

const applyItemSaved = (
  context: EditorSessionContext,
  submitted: PendingSubmitSnapshot,
): EditorSessionContext => {
  const draftChangedSinceSubmit = hasDraftChangedSinceSubmit(context, submitted);
  const base: EditorSessionContext = {
    ...context,
    addedCount: submitted.mode === "create" ? context.addedCount + 1 : context.addedCount,
    isDuplicate: false,
    duplicateDeckPath: null,
    lastError: null,
    isSubmitting: false,
    pendingSubmit: null,
  };

  if (draftChangedSinceSubmit) {
    return {
      ...base,
      dirty: true,
    };
  }

  return {
    ...base,
    frontContent: submitted.mode === "create" && !context.frontFrozen ? "" : context.frontContent,
    backContent: submitted.mode === "create" && !context.backFrozen ? "" : context.backContent,
    dirty: false,
  };
};

const shouldCheckDuplicates = (context: EditorSessionContext): boolean => {
  if (!context.rootPath || !context.deckPath) {
    return false;
  }

  return buildEditorContent(context) !== null;
};

export const canSubmitEditorSession = (context: {
  readonly mode: "create" | "edit";
  readonly cardType: "qa" | "cloze";
  readonly deckPath: string | null;
  readonly editCardId: string | null;
  readonly frontContent: string;
  readonly backContent: string;
  readonly isDuplicate: boolean;
  readonly isSubmitting: boolean;
  readonly rootPath: string | null;
  readonly loading: boolean;
}): boolean => {
  if (context.loading) {
    return false;
  }

  if (!buildEditorContent(context)) {
    return false;
  }

  if (!context.rootPath || !context.deckPath) {
    return false;
  }

  if (context.mode === "edit" && !context.editCardId) {
    return false;
  }

  if (context.isDuplicate || context.isSubmitting) {
    return false;
  }

  return true;
};

export const createEditorSessionMachine = (
  services: EditorSessionServices,
  initialSearch: EditorSearchParams,
) => {
  const initializeActor = fromPromise(
    async ({
      input,
    }: {
      input: { readonly request: EditorSearchParams };
    }): Promise<InitializeOutput> => {
      const settings = await services.getSettings();
      const configuredRootPath = settings.workspace.rootPath;

      if (!configuredRootPath) {
        return {
          rootPath: null,
          decks: [],
          lastError: NO_WORKSPACE_ERROR,
          session: buildCreateViewContext(null),
        };
      }

      const scanned = await services.scanDecks({ rootPath: configuredRootPath });

      if (input.request.mode === "create") {
        const requestedDeckPath = normalizeDeckPathFromSearch(
          input.request.deckPath,
          scanned.decks,
        );
        const selectedDeckPath = requestedDeckPath ?? scanned.decks[0]?.absolutePath ?? null;

        return {
          rootPath: configuredRootPath,
          decks: scanned.decks,
          lastError: null,
          session: buildCreateViewContext(selectedDeckPath),
        };
      }

      const requestedDeckPath = input.request.deckPath;
      const requestedCardId = input.request.cardId;

      if (!requestedDeckPath || !requestedCardId) {
        return {
          rootPath: configuredRootPath,
          decks: scanned.decks,
          lastError: EDIT_MODE_REQUIRES_IDS_ERROR,
          session: buildCreateViewContext(scanned.decks[0]?.absolutePath ?? null),
        };
      }

      const editDeckPath =
        normalizeDeckPathFromSearch(requestedDeckPath, scanned.decks) ?? requestedDeckPath;
      const item = await services.getItemForEdit({
        deckPath: editDeckPath,
        cardId: requestedCardId,
      });

      return {
        rootPath: configuredRootPath,
        decks: scanned.decks,
        lastError: null,
        session: buildEditViewContext({
          content: item.content,
          cardType: item.cardType,
          cardId: requestedCardId,
          cardIds: item.cardIds,
          deckPath: editDeckPath,
        }),
      };
    },
  );

  const refreshDecksActor = fromPromise(
    async ({ input }: { input: { readonly rootPath: string } }): Promise<readonly DeckEntry[]> => {
      const scanned = await services.scanDecks({ rootPath: input.rootPath });
      return scanned.decks;
    },
  );

  const checkDuplicatesActor = fromPromise(
    async ({
      input,
    }: {
      input: { readonly context: EditorSessionContext };
    }): Promise<DuplicateCheckOutput> => {
      const snapshot = input.context;
      const content = buildEditorContent(snapshot);

      if (!content || !snapshot.rootPath) {
        throw new Error("Duplicate check called without a valid draft context.");
      }

      const result = await services.checkDuplicates({
        content,
        cardType: snapshot.cardType,
        rootPath: snapshot.rootPath,
        excludeCardIds: snapshot.mode === "edit" ? snapshot.editCardIds : [],
      });
      const duplicate = toDuplicateStatus(result);

      return {
        isDuplicate: duplicate.isDuplicate,
        duplicateDeckPath: duplicate.matchingDeckPath,
      };
    },
  );

  const createDeckActor = fromPromise(
    async ({
      input,
    }: {
      input: { readonly rootPath: string; readonly relativePath: string };
    }): Promise<CreateDeckOutput> => {
      const created = await services.createDeck({
        relativePath: input.relativePath,
        createParents: true,
      });

      const scanned = await services.scanDecks({ rootPath: input.rootPath });

      return {
        decks: scanned.decks,
        absolutePath: created.absolutePath,
      };
    },
  );

  const submitActor = fromPromise(
    async ({
      input,
    }: {
      input: { readonly submission: PendingSubmitSnapshot };
    }): Promise<SubmitActorOutput> => {
      const snapshot = input.submission;
      const content = buildEditorContent(snapshot);

      if (!snapshot.deckPath) {
        throw new Error(SELECT_DECK_ERROR);
      }
      const deckPath = snapshot.deckPath;

      if (!snapshot.rootPath) {
        throw new Error(WORKSPACE_PATH_UNAVAILABLE_ERROR);
      }

      if (!content) {
        throw new Error(
          snapshot.cardType === "qa" ? MISSING_FRONT_BACK_ERROR : MISSING_CLOZE_CONTENT_ERROR,
        );
      }

      if (snapshot.mode === "edit" && !snapshot.editCardId) {
        throw new Error(MISSING_EDIT_CARD_ID_ERROR);
      }

      const duplicateResult = await services.checkDuplicates({
        content,
        cardType: snapshot.cardType,
        rootPath: snapshot.rootPath,
        excludeCardIds: snapshot.mode === "edit" ? snapshot.editCardIds : [],
      });

      const duplicateNow = toDuplicateStatus(duplicateResult);
      if (duplicateNow.isDuplicate) {
        return {
          type: "duplicate",
          duplicateDeckPath: duplicateNow.matchingDeckPath,
        };
      }

      if (snapshot.mode === "create") {
        await services.appendItem({
          deckPath,
          content,
          cardType: snapshot.cardType,
        });

        return {
          type: "saved",
          deckPath,
          editIdentity: null,
        };
      }

      const currentEditCardId = snapshot.editCardId;
      if (!currentEditCardId) {
        throw new Error(MISSING_EDIT_CARD_ID_ERROR);
      }

      const replaceResult = await services.replaceItem({
        deckPath,
        cardId: currentEditCardId,
        content,
        cardType: snapshot.cardType,
      });

      const editedCardIndex = snapshot.editCardIds.indexOf(currentEditCardId);
      const nextEditCardId =
        editedCardIndex >= 0
          ? (replaceResult.cardIds[editedCardIndex] ?? replaceResult.cardIds[0] ?? null)
          : (replaceResult.cardIds[0] ?? null);

      return {
        type: "saved",
        deckPath,
        editIdentity: {
          cardIds: replaceResult.cardIds,
          cardId: nextEditCardId,
        },
      };
    },
  );

  return setup({
    types: {
      context: {} as EditorSessionContext,
      events: {} as EditorSessionEvent,
    },
    actors: {
      initialize: initializeActor,
      refreshDecks: refreshDecksActor,
      checkDuplicates: checkDuplicatesActor,
      createDeck: createDeckActor,
      submit: submitActor,
    },
    guards: {
      shouldCheckDuplicates: ({ context }) => shouldCheckDuplicates(context),
      hasRootPath: ({ context }) => context.rootPath !== null,
      hasFlashMessage: ({ context }) => context.flashMessage !== null,
      hasNoFlashMessage: ({ context }) => context.flashMessage === null,
    },
    actions: {
      clearDuplicateState: assign({
        isDuplicate: () => false,
        duplicateDeckPath: () => null,
      }),
    },
  }).createMachine({
    id: "editorSession",
    initial: "booting",
    context: () => ({
      ...buildCreateViewContext(null),
      rootPath: null,
      decks: [],
      loading: true,
      flashMessage: null,
      currentRequest: initialSearch,
      pendingCreateDeckRelativePath: null,
      pendingSubmit: null,
    }),
    states: {
      booting: {
        entry: assign({
          loading: () => true,
          isSubmitting: () => false,
          flashMessage: () => null,
          pendingSubmit: () => null,
        }),
        on: {
          REQUEST_LOAD: {
            target: "#editorSession.booting",
            reenter: true,
            actions: assign({
              currentRequest: ({ event }) => event.search,
              flashMessage: () => null,
            }),
          },
        },
        invoke: {
          src: "initialize",
          input: ({ context }) => ({
            request: context.currentRequest,
          }),
          onDone: {
            target: "ready",
            actions: [
              assign(({ context, event }) => ({
                ...context,
                ...event.output.session,
                rootPath: event.output.rootPath,
                decks: event.output.decks,
                loading: false,
                lastError: event.output.lastError,
                pendingCreateDeckRelativePath: null,
                pendingSubmit: null,
              })),
              raise({ type: "REEVALUATE_DUPLICATES" }),
            ],
          },
          onError: {
            target: "ready",
            actions: assign({
              loading: () => false,
              isSubmitting: () => false,
              lastError: ({ event }) => toErrorMessage(event.error),
              pendingSubmit: () => null,
            }),
          },
        },
      },
      ready: {
        type: "parallel",
        states: {
          operations: {
            initial: "idle",
            states: {
              idle: {
                on: {
                  SUBMIT: {
                    target: "submitting",
                    actions: assign({
                      pendingSubmit: ({ context }) => createPendingSubmitSnapshot(context),
                    }),
                  },
                  CREATE_DECK: {
                    guard: "hasRootPath",
                    target: "creatingDeck",
                    actions: assign({
                      pendingCreateDeckRelativePath: ({ event }) => event.relativePath,
                    }),
                  },
                  REQUEST_LOAD: {
                    target: "#editorSession.booting",
                    actions: assign({
                      currentRequest: ({ event }) => event.search,
                      flashMessage: () => null,
                    }),
                  },
                },
              },
              submitting: {
                entry: assign({
                  isSubmitting: () => true,
                }),
                invoke: {
                  src: "submit",
                  input: ({ context }) => {
                    if (!context.pendingSubmit) {
                      throw new Error("Missing pending submit snapshot.");
                    }

                    return {
                      submission: context.pendingSubmit,
                    };
                  },
                  onDone: [
                    {
                      guard: ({ event }) => event.output.type === "saved",
                      target: "idle",
                      actions: [
                        assign(({ context, event }) => {
                          const submitted = context.pendingSubmit;
                          if (!submitted) {
                            return {
                              ...context,
                              isSubmitting: false,
                              pendingSubmit: null,
                              lastError: "Missing pending submit snapshot.",
                            };
                          }

                          const savedOutput = event.output as Extract<
                            SubmitActorOutput,
                            { type: "saved" }
                          >;

                          const withEditIdentity =
                            savedOutput.editIdentity === null
                              ? context
                              : {
                                  ...context,
                                  editCardIds: savedOutput.editIdentity.cardIds,
                                  editCardId: savedOutput.editIdentity.cardId,
                                };

                          return applyItemSaved(withEditIdentity, submitted);
                        }),
                        raise({ type: "REEVALUATE_DUPLICATES" }),
                        raise(({ context, event }) => {
                          const savedOutput = event.output as Extract<
                            SubmitActorOutput,
                            { type: "saved" }
                          >;

                          return {
                            type: "SET_FLASH" as const,
                            message: toSavedFlashMessage(
                              context.mode,
                              context.decks,
                              savedOutput.deckPath,
                            ),
                          };
                        }),
                      ],
                    },
                    {
                      target: "idle",
                      actions: [
                        assign(({ context, event }) => {
                          const submitted = context.pendingSubmit;
                          if (!submitted) {
                            return {
                              ...context,
                              isSubmitting: false,
                              pendingSubmit: null,
                              lastError: "Missing pending submit snapshot.",
                            };
                          }

                          const duplicateOutput = event.output as Extract<
                            SubmitActorOutput,
                            { type: "duplicate" }
                          >;

                          const draftChangedSinceSubmit = hasDraftChangedSinceSubmit(
                            context,
                            submitted,
                          );

                          return {
                            ...context,
                            isSubmitting: false,
                            pendingSubmit: null,
                            isDuplicate: draftChangedSinceSubmit ? false : true,
                            duplicateDeckPath: draftChangedSinceSubmit
                              ? null
                              : duplicateOutput.duplicateDeckPath,
                            lastError: DUPLICATE_ERROR,
                          };
                        }),
                        raise({ type: "REEVALUATE_DUPLICATES" }),
                      ],
                    },
                  ],
                  onError: {
                    target: "idle",
                    actions: assign({
                      isSubmitting: () => false,
                      pendingSubmit: () => null,
                      lastError: ({ event }) => toErrorMessage(event.error),
                    }),
                  },
                },
              },
              creatingDeck: {
                invoke: {
                  src: "createDeck",
                  input: ({ context }) => {
                    if (!context.rootPath || !context.pendingCreateDeckRelativePath) {
                      throw new Error(WORKSPACE_PATH_UNAVAILABLE_ERROR);
                    }

                    return {
                      rootPath: context.rootPath,
                      relativePath: context.pendingCreateDeckRelativePath,
                    };
                  },
                  onDone: {
                    target: "idle",
                    actions: [
                      assign(({ context, event }) => ({
                        ...context,
                        decks: event.output.decks,
                        deckPath: event.output.absolutePath,
                        pendingCreateDeckRelativePath: null,
                        lastError: null,
                      })),
                      raise({ type: "REEVALUATE_DUPLICATES" }),
                    ],
                  },
                  onError: {
                    target: "idle",
                    actions: assign({
                      pendingCreateDeckRelativePath: () => null,
                      lastError: ({ event }) => toErrorMessage(event.error),
                    }),
                  },
                },
              },
            },
          },
          duplicateCheck: {
            initial: "idle",
            on: {
              REEVALUATE_DUPLICATES: [
                {
                  guard: "shouldCheckDuplicates",
                  target: ".debouncing",
                },
                {
                  target: ".idle",
                  actions: "clearDuplicateState",
                },
              ],
            },
            states: {
              idle: {},
              debouncing: {
                after: {
                  [DUPLICATE_CHECK_DEBOUNCE_MS]: "checking",
                },
              },
              checking: {
                invoke: {
                  src: "checkDuplicates",
                  input: ({ context }) => ({ context }),
                  onDone: {
                    target: "idle",
                    actions: assign({
                      isDuplicate: ({ event }) => event.output.isDuplicate,
                      duplicateDeckPath: ({ event }) => event.output.duplicateDeckPath,
                    }),
                  },
                  onError: {
                    target: "idle",
                    actions: assign({
                      lastError: ({ event }) => toErrorMessage(event.error),
                    }),
                  },
                },
              },
            },
          },
          workspaceSync: {
            initial: "idle",
            states: {
              idle: {
                on: {
                  REFRESH_DECKS: {
                    guard: "hasRootPath",
                    target: "refreshing",
                  },
                },
              },
              refreshing: {
                on: {
                  REFRESH_DECKS: {
                    target: "refreshing",
                    reenter: true,
                  },
                },
                invoke: {
                  src: "refreshDecks",
                  input: ({ context }) => ({
                    rootPath: context.rootPath!,
                  }),
                  onDone: {
                    target: "idle",
                    actions: [
                      assign(({ context, event }) => {
                        const nextDecks = event.output;
                        const selectedDeckPath = context.deckPath;
                        const selectedDeckStillExists =
                          selectedDeckPath === null ||
                          nextDecks.some((deck) => deck.absolutePath === selectedDeckPath);

                        if (selectedDeckStillExists) {
                          return {
                            ...context,
                            decks: nextDecks,
                          };
                        }

                        return {
                          ...context,
                          decks: nextDecks,
                          deckPath: null,
                          isDuplicate: false,
                          duplicateDeckPath: null,
                          lastError: MISSING_DECK_SELECTED_ERROR,
                        };
                      }),
                      raise({ type: "REEVALUATE_DUPLICATES" }),
                    ],
                  },
                  onError: {
                    target: "idle",
                    actions: assign({
                      lastError: ({ event }) => toErrorMessage(event.error),
                    }),
                  },
                },
              },
            },
          },
          flash: {
            initial: "hidden",
            on: {
              SET_FLASH: {
                target: ".visible",
                reenter: true,
                actions: assign({
                  flashMessage: ({ event }) => event.message,
                }),
              },
            },
            states: {
              hidden: {
                always: {
                  guard: "hasFlashMessage",
                  target: "visible",
                },
              },
              visible: {
                after: {
                  [FLASH_DURATION_MS]: {
                    target: "hidden",
                    actions: assign({
                      flashMessage: () => null,
                    }),
                  },
                },
                always: {
                  guard: "hasNoFlashMessage",
                  target: "hidden",
                },
              },
            },
          },
        },
        on: {
          SET_DECK_PATH: {
            actions: [
              assign({
                deckPath: ({ event }) => event.deckPath,
              }),
              raise({ type: "REEVALUATE_DUPLICATES" }),
            ],
          },
          SET_FRONT_CONTENT: {
            actions: [
              assign({
                frontContent: ({ event }) => event.content,
                dirty: () => true,
                cardType: ({ event }) => (hasClozeDeletion(event.content) ? "cloze" : "qa"),
              }),
              raise({ type: "REEVALUATE_DUPLICATES" }),
            ],
          },
          SET_BACK_CONTENT: {
            actions: [
              assign({
                backContent: ({ event }) => event.content,
                dirty: () => true,
              }),
              raise({ type: "REEVALUATE_DUPLICATES" }),
            ],
          },
          TOGGLE_FRONT_FROZEN: {
            actions: assign({
              frontFrozen: ({ context }) => !context.frontFrozen,
            }),
          },
          TOGGLE_BACK_FROZEN: {
            actions: assign({
              backFrozen: ({ context }) => !context.backFrozen,
            }),
          },
        },
      },
    },
  });
};

export type EditorSessionSnapshot = SnapshotFrom<ReturnType<typeof createEditorSessionMachine>>;

export const getInitialEditorViewContext = (): EditorSessionViewContext => createBaseViewContext();
