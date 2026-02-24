import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { createActor, type ActorRefFrom } from "xstate";

import { useIpc } from "@/lib/ipc-context";
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
          getSettings: () => Effect.runPromise(ipc.client.GetSettings()),
          scanDecks: ({ rootPath }) => Effect.runPromise(ipc.client.ScanDecks({ rootPath })),
          getItemForEdit: ({ deckPath, cardId }) =>
            Effect.runPromise(ipc.client.GetItemForEdit({ deckPath, cardId })),
          checkDuplicates: ({ content, cardType, rootPath, excludeCardIds }) =>
            Effect.runPromise(
              ipc.client.CheckDuplicates({
                content,
                cardType,
                rootPath,
                excludeCardIds: [...excludeCardIds],
              }),
            ),
          appendItem: ({ deckPath, content, cardType }) =>
            Effect.runPromise(
              ipc.client.AppendItem({
                deckPath,
                content,
                cardType,
              }),
            ),
          replaceItem: ({ deckPath, cardId, content, cardType }) =>
            Effect.runPromise(
              ipc.client.ReplaceItem({
                deckPath,
                cardId,
                content,
                cardType,
              }),
            ),
          createDeck: ({ relativePath, createParents }) =>
            Effect.runPromise(
              ipc.client.CreateDeck({
                relativePath,
                createParents,
              }),
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
