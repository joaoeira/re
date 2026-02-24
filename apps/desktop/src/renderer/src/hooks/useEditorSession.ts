import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";

import type { ScanDecksResult } from "@re/workspace";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { EditorNavigateRequest, WorkspaceSnapshotChanged } from "@shared/rpc/contracts";
import {
  buildEditorContent,
  isSameEditorRequest,
  normalizeDeckPathFromSearch,
  toDuplicateStatus,
  toErrorMessage,
} from "@shared/state/editor-utils";
import { useEditorStore } from "@shared/state/stores-context";

export type EditorSearchParams =
  | { mode: "create"; deckPath?: string }
  | { mode: "edit"; deckPath: string; cardId: string };

type DeckEntry = ScanDecksResult["decks"][number];

const DUPLICATE_CHECK_DEBOUNCE_MS = 400;
const FLASH_DURATION_MS = 2500;
const CLOZE_PATTERN = /\{\{c\d+::/;

export function useEditorSession(search: EditorSearchParams) {
  const navigate = useNavigate();
  const editorStore = useEditorStore();
  const context = useSelector(editorStore, (snapshot) => snapshot.context);
  const initialMode = search.mode;
  const initialDeckPath = search.deckPath;
  const initialCardId = search.mode === "edit" ? search.cardId : null;
  const ipc = useIpc();

  const [rootPath, setRootPath] = useState<string | null>(null);
  const [decks, setDecks] = useState<readonly DeckEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const refreshDecks = useCallback(
    async (workspaceRootPath: string) => {
      const scanned = await Effect.runPromise(
        ipc.client.ScanDecks({ rootPath: workspaceRootPath }),
      );
      setDecks(scanned.decks);

      const selectedDeckPath = editorStore.getSnapshot().context.deckPath;
      if (
        selectedDeckPath &&
        !scanned.decks.some((deck) => deck.absolutePath === selectedDeckPath)
      ) {
        editorStore.send({ type: "setDeckPath", deckPath: null });
        editorStore.send({
          type: "setError",
          error: "The selected deck no longer exists in the current workspace.",
        });
      }
    },
    [editorStore, ipc],
  );

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      setLoading(true);

      try {
        const settings = await Effect.runPromise(ipc.client.GetSettings());
        const configuredRootPath = settings.workspace.rootPath;

        if (!configuredRootPath) {
          editorStore.send({
            type: "setError",
            error: "No workspace configured. Set a workspace root path in settings.",
          });
          if (!cancelled) {
            setRootPath(null);
            setDecks([]);
            setLoading(false);
          }
          return;
        }

        const scanned = await Effect.runPromise(
          ipc.client.ScanDecks({ rootPath: configuredRootPath }),
        );
        if (cancelled) {
          return;
        }

        setRootPath(configuredRootPath);
        setDecks(scanned.decks);

        if (initialMode === "create") {
          const requestedDeckPath = normalizeDeckPathFromSearch(initialDeckPath, scanned.decks);
          const selectedDeckPath = requestedDeckPath ?? scanned.decks[0]?.absolutePath ?? null;
          editorStore.send({ type: "loadCreate", deckPath: selectedDeckPath });
        } else {
          if (!initialDeckPath || !initialCardId) {
            editorStore.send({
              type: "setError",
              error: "Edit mode requires both deckPath and cardId.",
            });
            setLoading(false);
            return;
          }

          const editDeckPath =
            normalizeDeckPathFromSearch(initialDeckPath, scanned.decks) ?? initialDeckPath;
          const item = await Effect.runPromise(
            ipc.client.GetItemForEdit({ deckPath: editDeckPath, cardId: initialCardId }),
          );

          if (cancelled) {
            return;
          }

          editorStore.send({
            type: "loadForEdit",
            content: item.content,
            cardType: item.cardType,
            cardId: initialCardId,
            cardIds: item.cardIds,
            deckPath: editDeckPath,
          });
        }

        setLoading(false);
      } catch (error) {
        if (cancelled) {
          return;
        }
        editorStore.send({ type: "setError", error: toErrorMessage(error) });
        setLoading(false);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [editorStore, initialCardId, initialDeckPath, initialMode, ipc]);

  useEffect(() => {
    return ipc.events.subscribe(EditorNavigateRequest, (params) => {
      const dirty = editorStore.getSnapshot().context.dirty;
      if (dirty && !window.confirm("Discard unsaved changes?")) {
        return;
      }

      if (isSameEditorRequest(params, search)) {
        if (params.mode === "create") {
          const requestedDeckPath = normalizeDeckPathFromSearch(params.deckPath, decks);
          const selectedDeckPath = requestedDeckPath ?? decks[0]?.absolutePath ?? null;
          editorStore.send({ type: "loadCreate", deckPath: selectedDeckPath });
          return;
        }

        void Effect.runPromise(
          ipc.client.GetItemForEdit({
            deckPath: params.deckPath,
            cardId: params.cardId,
          }),
        )
          .then((item) => {
            editorStore.send({
              type: "loadForEdit",
              content: item.content,
              cardType: item.cardType,
              cardId: params.cardId,
              cardIds: item.cardIds,
              deckPath: params.deckPath,
            });
          })
          .catch((error: unknown) => {
            editorStore.send({ type: "setError", error: toErrorMessage(error) });
          });
        return;
      }

      void navigate({
        to: "/editor",
        search:
          params.mode === "create"
            ? params.deckPath
              ? { mode: "create", deckPath: params.deckPath }
              : { mode: "create" }
            : params,
      });
    });
  }, [decks, editorStore, ipc, navigate, search]);

  useEffect(() => {
    if (!rootPath) {
      return;
    }

    return ipc.events.subscribe(WorkspaceSnapshotChanged, (snapshot) => {
      if (snapshot.rootPath !== rootPath) {
        return;
      }
      void refreshDecks(rootPath).catch((error: unknown) => {
        editorStore.send({ type: "setError", error: toErrorMessage(error) });
      });
    });
  }, [editorStore, ipc, refreshDecks, rootPath]);

  useEffect(() => {
    const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      if (editorStore.getSnapshot().context.dirty) {
        event.preventDefault();
        Reflect.set(event, "returnValue", true);
      }
    };

    window.addEventListener("beforeunload", beforeUnloadHandler);
    return () => {
      window.removeEventListener("beforeunload", beforeUnloadHandler);
    };
  }, [editorStore]);

  useEffect(() => {
    const hasCloze = CLOZE_PATTERN.test(context.frontContent);
    const nextCardType = hasCloze ? "cloze" : "qa";
    if (nextCardType !== context.cardType) {
      editorStore.send({ type: "detectCardType", cardType: nextCardType });
    }
  }, [context.frontContent, context.cardType, editorStore]);

  useEffect(() => {
    const shouldClear = !rootPath || !context.deckPath || !buildEditorContent(context);
    if (shouldClear) {
      if (context.isDuplicate || context.duplicateDeckPath !== null) {
        editorStore.send({ type: "setDuplicate", isDuplicate: false, deckPath: null });
      }
      return;
    }

    const content = buildEditorContent(context)!;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void Effect.runPromise(
        ipc.client.CheckDuplicates({
          content,
          cardType: context.cardType,
          rootPath,
          excludeCardIds: context.mode === "edit" ? context.editCardIds : [],
        }),
      )
        .then((result) => {
          if (cancelled) {
            return;
          }
          const duplicate = toDuplicateStatus(result);
          editorStore.send({
            type: "setDuplicate",
            isDuplicate: duplicate.isDuplicate,
            deckPath: duplicate.matchingDeckPath,
          });
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          editorStore.send({ type: "setError", error: toErrorMessage(error) });
        });
    }, DUPLICATE_CHECK_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    context.backContent,
    context.cardType,
    context.deckPath,
    context.editCardIds,
    context.frontContent,
    context.mode,
    editorStore,
    ipc,
    rootPath,
  ]);

  useEffect(() => {
    if (!flashMessage) return;
    const timer = window.setTimeout(() => setFlashMessage(null), FLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [flashMessage]);

  const submitRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const canSubmitRef = useRef(false);

  const submit = useCallback(async () => {
    const snapshot = editorStore.getSnapshot().context;

    if (snapshot.isSubmitting) return;

    const content = buildEditorContent(snapshot);

    if (!snapshot.deckPath) {
      editorStore.send({ type: "setError", error: "Select a deck before saving." });
      return;
    }
    const deckPath = snapshot.deckPath;

    if (!rootPath) {
      editorStore.send({ type: "setError", error: "Workspace root path is unavailable." });
      return;
    }
    const workspaceRootPath = rootPath;

    if (!content) {
      editorStore.send({
        type: "setError",
        error:
          snapshot.cardType === "qa"
            ? "Both Front and Back are required."
            : "Cloze content cannot be empty.",
      });
      return;
    }

    if (snapshot.isDuplicate) {
      editorStore.send({
        type: "setError",
        error: "Duplicate content detected. Change the card before saving.",
      });
      return;
    }

    if (snapshot.mode === "edit" && !snapshot.editCardId) {
      editorStore.send({
        type: "setError",
        error: "Missing card id for edit operation.",
      });
      return;
    }

    editorStore.send({ type: "setSubmitting", isSubmitting: true });

    const submitEffect = Effect.gen(function* () {
      const duplicateResult = yield* ipc.client.CheckDuplicates({
        content,
        cardType: snapshot.cardType,
        rootPath: workspaceRootPath,
        excludeCardIds: snapshot.mode === "edit" ? snapshot.editCardIds : [],
      });
      const duplicateNow = toDuplicateStatus(duplicateResult);
      yield* Effect.sync(() => {
        editorStore.send({
          type: "setDuplicate",
          isDuplicate: duplicateNow.isDuplicate,
          deckPath: duplicateNow.matchingDeckPath,
        });
      });

      if (duplicateNow.isDuplicate) {
        yield* Effect.sync(() => {
          editorStore.send({ type: "setSubmitting", isSubmitting: false });
          editorStore.send({
            type: "setError",
            error: "Duplicate content detected. Change the card before saving.",
          });
        });
        return false as const;
      }

      yield* Effect.sync(() => {
        editorStore.send({ type: "setError", error: null });
      });

      if (snapshot.mode === "create") {
        yield* ipc.client.AppendItem({
          deckPath,
          content,
          cardType: snapshot.cardType,
        });
      } else {
        const currentEditCardId = snapshot.editCardId;
        if (!currentEditCardId) {
          return yield* Effect.fail(new Error("Missing card id for edit operation."));
        }

        const replaceResult = yield* ipc.client.ReplaceItem({
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

        yield* Effect.sync(() => {
          editorStore.send({
            type: "setEditIdentity",
            cardIds: replaceResult.cardIds,
            cardId: nextEditCardId,
          });
        });
      }

      yield* Effect.sync(() => {
        editorStore.send({ type: "itemSaved" });
      });

      return true as const;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          editorStore.send({ type: "setSubmitting", isSubmitting: false });
          editorStore.send({ type: "setError", error: toErrorMessage(error) });
          return false as const;
        }),
      ),
    );

    const succeeded = await Effect.runPromise(submitEffect);
    if (succeeded) {
      const savedDeck = decks.find((d) => d.absolutePath === deckPath);
      const deckName = savedDeck?.name ?? "deck";
      setFlashMessage(
        snapshot.mode === "edit" ? `Saved to ${deckName}` : `Card added to ${deckName}`,
      );
    }
  }, [decks, editorStore, ipc, rootPath]);

  const canSubmit = useMemo(() => {
    const content = buildEditorContent(context);
    if (!content) {
      return false;
    }

    if (!rootPath) {
      return false;
    }

    if (!context.deckPath) {
      return false;
    }

    if (context.mode === "edit" && !context.editCardId) {
      return false;
    }

    if (context.isDuplicate || context.isSubmitting) {
      return false;
    }

    return true;
  }, [context, rootPath]);

  submitRef.current = submit;
  canSubmitRef.current = canSubmit;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (canSubmitRef.current) {
          void submitRef.current?.();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const createDeck = useCallback(
    async (relativePath: string) => {
      if (!rootPath) return;
      try {
        const result = await Effect.runPromise(
          ipc.client.CreateDeck({ relativePath, createParents: true }),
        );
        await refreshDecks(rootPath);
        editorStore.send({ type: "setDeckPath", deckPath: result.absolutePath });
      } catch (error) {
        editorStore.send({ type: "setError", error: toErrorMessage(error) });
      }
    },
    [editorStore, ipc, refreshDecks, rootPath],
  );

  return {
    context,
    decks,
    rootPath,
    loading,
    canSubmit,
    flashMessage,
    submit,
    createDeck,
    setDeckPath: (deckPath: string | null) => editorStore.send({ type: "setDeckPath", deckPath }),
    setFrontContent: (content: string) => editorStore.send({ type: "setFrontContent", content }),
    setBackContent: (content: string) => editorStore.send({ type: "setBackContent", content }),
    toggleFrontFrozen: () => editorStore.send({ type: "toggleFrontFrozen" }),
    toggleBackFrozen: () => editorStore.send({ type: "toggleBackFrozen" }),
  };
}
