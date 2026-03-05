import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { createActor, type ActorRefFrom } from "xstate";

import { mapScanDecksErrorToError } from "@re/workspace";
import { mapCreateDeckErrorToError } from "@shared/rpc/schemas/workspace";
import { mapSettingsErrorToError } from "@shared/settings";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import {
  canSubmitEditorSession,
  createEditorSessionMachine,
  getInitialEditorViewContext,
  type EditorSearchParams,
  type EditorSessionSendEvent,
  type EditorSessionSnapshot,
} from "@/machines/editorSession";
import { EditorNavigateRequest, WorkspaceSnapshotChanged } from "@shared/rpc/contracts";
import { isSameEditorRequest } from "@shared/state/editor-utils";

export type { EditorSearchParams } from "@/machines/editorSession";

type EditorSessionActor = ActorRefFrom<ReturnType<typeof createEditorSessionMachine>>;
type DeckEntry = EditorSessionSnapshot["context"]["decks"][number];

const toEditorSearchParams = (params: {
  readonly mode: "create" | "edit";
  readonly deckPath?: string | undefined;
  readonly cardId?: string | undefined;
}): EditorSearchParams => {
  if (params.mode === "create") {
    return params.deckPath ? { mode: "create", deckPath: params.deckPath } : { mode: "create" };
  }

  if (typeof params.deckPath === "string" && typeof params.cardId === "string") {
    return {
      mode: "edit",
      deckPath: params.deckPath,
      cardId: params.cardId,
    };
  }

  return { mode: "create" };
};

const toSearchKey = (search: EditorSearchParams): string =>
  search.mode === "create"
    ? `create:${search.deckPath ?? ""}`
    : `edit:${search.deckPath}:${search.cardId}`;

export function useEditorSession(search: EditorSearchParams) {
  const navigate = useNavigate();
  const ipc = useIpc();
  const searchKey = toSearchKey(search);
  const actorRef = useRef<EditorSessionActor | null>(null);
  const initialContextRef = useRef(getInitialEditorViewContext());
  const [snapshot, setSnapshot] = useState<EditorSessionSnapshot | null>(null);

  const send = useCallback((event: EditorSessionSendEvent) => {
    actorRef.current?.send(event);
  }, []);

  useEffect(() => {
    const actor = createActor(
      createEditorSessionMachine(
        {
          getSettings: () =>
            runIpcEffect(
              ipc.client.GetSettings().pipe(
                Effect.catchTag("RpcDefectError", (rpcDefect) =>
                  Effect.fail(toRpcDefectError(rpcDefect)),
                ),
                Effect.mapError(mapSettingsErrorToError),
              ),
            ),
          scanDecks: ({ rootPath }) =>
            runIpcEffect(
              ipc.client.ScanDecks({ rootPath }).pipe(
                Effect.catchTag("RpcDefectError", (rpcDefect) =>
                  Effect.fail(toRpcDefectError(rpcDefect)),
                ),
                Effect.mapError(mapScanDecksErrorToError),
              ),
            ),
          getItemForEdit: ({ deckPath, cardId }) =>
            runIpcEffect(
              ipc.client.GetItemForEdit({ deckPath, cardId }).pipe(
                Effect.catchTag("RpcDefectError", (rpcDefect) =>
                  Effect.fail(toRpcDefectError(rpcDefect)),
                ),
                Effect.catchTag("editor_operation_error", (editorError) =>
                  Effect.fail(new Error(editorError.message)),
                ),
              ),
            ),
          checkDuplicates: ({ content, cardType, rootPath, excludeCardIds }) =>
            runIpcEffect(
              ipc.client
                .CheckDuplicates({
                  content,
                  cardType,
                  rootPath,
                  excludeCardIds: [...excludeCardIds],
                })
                .pipe(
                  Effect.catchTag("RpcDefectError", (rpcDefect) =>
                    Effect.fail(toRpcDefectError(rpcDefect)),
                  ),
                  Effect.catchTag("editor_operation_error", (editorError) =>
                    Effect.fail(new Error(editorError.message)),
                  ),
                ),
            ),
          appendItem: ({ deckPath, content, cardType }) =>
            runIpcEffect(
              ipc.client
                .AppendItem({
                  deckPath,
                  content,
                  cardType,
                })
                .pipe(
                  Effect.catchTag("RpcDefectError", (rpcDefect) =>
                    Effect.fail(toRpcDefectError(rpcDefect)),
                  ),
                  Effect.catchTag("editor_operation_error", (editorError) =>
                    Effect.fail(new Error(editorError.message)),
                  ),
                ),
            ),
          replaceItem: ({ deckPath, cardId, content, cardType }) =>
            runIpcEffect(
              ipc.client
                .ReplaceItem({
                  deckPath,
                  cardId,
                  content,
                  cardType,
                })
                .pipe(
                  Effect.catchTag("RpcDefectError", (rpcDefect) =>
                    Effect.fail(toRpcDefectError(rpcDefect)),
                  ),
                  Effect.catchTag("editor_operation_error", (editorError) =>
                    Effect.fail(new Error(editorError.message)),
                  ),
                ),
            ),
          createDeck: ({ relativePath, createParents }) =>
            runIpcEffect(
              ipc.client
                .CreateDeck({
                  relativePath,
                  createParents,
                })
                .pipe(
                  Effect.catchTag("RpcDefectError", (rpcDefect) =>
                    Effect.fail(toRpcDefectError(rpcDefect)),
                  ),
                  Effect.mapError(mapCreateDeckErrorToError),
                ),
            ),
        },
        search,
      ),
    );

    actorRef.current = actor;
    actor.start();
    setSnapshot(actor.getSnapshot());

    const subscription = actor.subscribe((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });

    return () => {
      subscription.unsubscribe();
      actor.stop();
      if (actorRef.current === actor) {
        actorRef.current = null;
      }
    };
  }, [ipc, searchKey]);

  useEffect(() => {
    return ipc.events.subscribe(EditorNavigateRequest, (params) => {
      const currentSnapshot = actorRef.current?.getSnapshot();
      if (!currentSnapshot) {
        return;
      }

      if (
        currentSnapshot.context.isSubmitting ||
        currentSnapshot.matches({ ready: { operations: "creatingDeck" } })
      ) {
        return;
      }

      if (currentSnapshot.context.dirty && !window.confirm("Discard unsaved changes?")) {
        return;
      }

      const incomingSearch = toEditorSearchParams(params);

      if (isSameEditorRequest(incomingSearch, search)) {
        send({ type: "REQUEST_LOAD", search: incomingSearch });
        return;
      }

      void navigate({
        to: "/editor",
        search: incomingSearch,
      });
    });
  }, [ipc, navigate, search, send]);

  useEffect(() => {
    return ipc.events.subscribe(WorkspaceSnapshotChanged, (workspaceSnapshot) => {
      const currentSnapshot = actorRef.current?.getSnapshot();
      if (!currentSnapshot?.context.rootPath) {
        return;
      }

      if (workspaceSnapshot.rootPath !== currentSnapshot.context.rootPath) {
        return;
      }

      send({ type: "REFRESH_DECKS" });
    });
  }, [ipc, send]);

  useEffect(() => {
    const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      if (actorRef.current?.getSnapshot().context.dirty) {
        event.preventDefault();
        Reflect.set(event, "returnValue", true);
      }
    };

    window.addEventListener("beforeunload", beforeUnloadHandler);
    return () => {
      window.removeEventListener("beforeunload", beforeUnloadHandler);
    };
  }, []);

  const context: ReturnType<typeof getInitialEditorViewContext> =
    snapshot?.context ?? initialContextRef.current;
  const decks: readonly DeckEntry[] = snapshot?.context.decks ?? [];
  const rootPath = snapshot?.context.rootPath ?? null;
  const loading = snapshot?.context.loading ?? true;
  const flashMessage = snapshot?.context.flashMessage ?? null;
  const creatingDeck = snapshot?.matches({ ready: { operations: "creatingDeck" } }) ?? false;
  const canSubmit = snapshot ? canSubmitEditorSession(snapshot.context) : false;

  const submit = useCallback(() => {
    send({ type: "SUBMIT" });
  }, [send]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        const currentSnapshot = actorRef.current?.getSnapshot();
        if (currentSnapshot && canSubmitEditorSession(currentSnapshot.context)) {
          send({ type: "SUBMIT" });
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [send]);

  const createDeck = useCallback(
    (relativePath: string) => {
      send({ type: "CREATE_DECK", relativePath });
    },
    [send],
  );

  return {
    context,
    decks,
    rootPath,
    loading,
    creatingDeck,
    canSubmit,
    flashMessage,
    submit,
    createDeck,
    setDeckPath: (deckPath: string | null) => send({ type: "SET_DECK_PATH", deckPath }),
    setFrontContent: (content: string) => send({ type: "SET_FRONT_CONTENT", content }),
    setBackContent: (content: string) => send({ type: "SET_BACK_CONTENT", content }),
    toggleFrontFrozen: () => send({ type: "TOGGLE_FRONT_FROZEN" }),
    toggleBackFrozen: () => send({ type: "TOGGLE_BACK_FROZEN" }),
  };
}
