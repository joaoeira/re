import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";

import type { ScanDecksResult } from "@re/workspace";
import { Effect, Option } from "effect";

import { createIpc } from "@/lib/ipc";
import { EditorNavigateRequest, WorkspaceSnapshotChanged } from "@shared/rpc/contracts";
import { useEditorStore } from "@shared/state/stores-context";

export type EditorSearchParams =
  | { mode: "create"; deckPath?: string }
  | { mode: "edit"; deckPath: string; cardId: string };

type DeckEntry = ScanDecksResult["decks"][number];

type DuplicateStatus = {
  isDuplicate: boolean;
  matchingDeckPath: string | null;
};

const DUPLICATE_CHECK_DEBOUNCE_MS = 400;
const QA_SEPARATOR = "\n---\n";

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const normalizeDeckPathFromSearch = (
  value: string | undefined,
  decks: readonly DeckEntry[],
): string | null => {
  if (!value) {
    return null;
  }

  const byAbsolute = decks.find((deck) => deck.absolutePath === value);
  if (byAbsolute) {
    return byAbsolute.absolutePath;
  }

  const byRelative = decks.find((deck) => deck.relativePath === value);
  if (byRelative) {
    return byRelative.absolutePath;
  }

  return value;
};

const buildEditorContent = (context: {
  readonly cardType: "qa" | "cloze";
  readonly frontContent: string;
  readonly backContent: string;
  readonly clozeContent: string;
}): string | null => {
  if (context.cardType === "qa") {
    const front = context.frontContent.trim();
    const back = context.backContent.trim();

    if (front.length === 0 || back.length === 0) {
      return null;
    }

    return `${front}${QA_SEPARATOR}${back}`;
  }

  const cloze = context.clozeContent.trim();
  return cloze.length === 0 ? null : cloze;
};

const toDuplicateStatus = (value: {
  readonly isDuplicate: boolean;
  readonly matchingDeckPath: Option.Option<string>;
}): DuplicateStatus => ({
  isDuplicate: value.isDuplicate,
  matchingDeckPath: Option.isSome(value.matchingDeckPath) ? value.matchingDeckPath.value : null,
});

export function useEditorSession(search: EditorSearchParams) {
  const navigate = useNavigate();
  const editorStore = useEditorStore();
  const context = useSelector(editorStore, (snapshot) => snapshot.context);
  const initialMode = search.mode;
  const initialDeckPath = search.deckPath;
  const initialCardId = search.mode === "edit" ? search.cardId : null;

  const [rootPath, setRootPath] = useState<string | null>(null);
  const [decks, setDecks] = useState<readonly DeckEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const ipc = useMemo(() => {
    if (!window.desktopApi) return null;
    return createIpc(window.desktopApi);
  }, []);

  const refreshDecks = useCallback(
    async (workspaceRootPath: string) => {
      if (!ipc) {
        return;
      }

      const scanned = await Effect.runPromise(ipc.client.ScanDecks({ rootPath: workspaceRootPath }));
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
      if (!ipc) {
        editorStore.send({ type: "setError", error: "Desktop IPC bridge is unavailable." });
        setLoading(false);
        return;
      }

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

        const scanned = await Effect.runPromise(ipc.client.ScanDecks({ rootPath: configuredRootPath }));
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
    if (!ipc) {
      return;
    }

    return ipc.events.subscribe(EditorNavigateRequest, (params) => {
      const dirty = editorStore.getSnapshot().context.dirty;
      if (dirty && !window.confirm("Discard unsaved changes?")) {
        return;
      }

      const sameRequest =
        params.mode === search.mode &&
        (params.mode === "create"
          ? (params.deckPath ?? null) === (search.mode === "create" ? (search.deckPath ?? null) : null)
          : search.mode === "edit" &&
            params.deckPath === search.deckPath &&
            params.cardId === search.cardId);

      if (sameRequest) {
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
    if (!ipc || !rootPath) {
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
      }
    };

    window.addEventListener("beforeunload", beforeUnloadHandler);
    return () => {
      window.removeEventListener("beforeunload", beforeUnloadHandler);
    };
  }, [editorStore]);

  useEffect(() => {
    if (!ipc || !rootPath || !context.deckPath) {
      if (context.isDuplicate || context.duplicateDeckPath !== null) {
        editorStore.send({ type: "setDuplicate", isDuplicate: false, deckPath: null });
      }
      return;
    }

    const content = buildEditorContent(context);
    if (!content) {
      if (context.isDuplicate || context.duplicateDeckPath !== null) {
        editorStore.send({ type: "setDuplicate", isDuplicate: false, deckPath: null });
      }
      return;
    }

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
          editorStore.send({ type: "setError", error: null });
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
    context.clozeContent,
    context.deckPath,
    context.editCardIds,
    context.frontContent,
    context.mode,
    editorStore,
    ipc,
    rootPath,
  ]);

  const submit = useCallback(async () => {
    if (!ipc) {
      editorStore.send({ type: "setError", error: "Desktop IPC bridge is unavailable." });
      return;
    }

    const snapshot = editorStore.getSnapshot().context;
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
        return yield* Effect.sync(() => {
          editorStore.send({
            type: "setError",
            error: "Duplicate content detected. Change the card before saving.",
          });
        });
      }

      yield* Effect.sync(() => {
        editorStore.send({ type: "setSubmitting", isSubmitting: true });
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
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          editorStore.send({ type: "setSubmitting", isSubmitting: false });
          editorStore.send({ type: "setError", error: toErrorMessage(error) });
        }),
      ),
    );

    await Effect.runPromise(submitEffect);
  }, [editorStore, ipc, rootPath]);

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

  return {
    context,
    decks,
    rootPath,
    loading,
    canSubmit,
    submit,
    setCardType: (cardType: "qa" | "cloze") => editorStore.send({ type: "setCardType", cardType }),
    setDeckPath: (deckPath: string | null) => editorStore.send({ type: "setDeckPath", deckPath }),
    setFrontContent: (content: string) => editorStore.send({ type: "setFrontContent", content }),
    setBackContent: (content: string) => editorStore.send({ type: "setBackContent", content }),
    setClozeContent: (content: string) => editorStore.send({ type: "setClozeContent", content }),
    toggleFrontFrozen: () => editorStore.send({ type: "toggleFrontFrozen" }),
    toggleBackFrozen: () => editorStore.send({ type: "toggleBackFrozen" }),
    toggleClozeFrozen: () => editorStore.send({ type: "toggleClozeFrozen" }),
  };
}
