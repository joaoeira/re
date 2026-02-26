import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useSelector } from "@xstate/store-react";
import { Effect } from "effect";
import type { RpcDefectError } from "electron-effect-rpc/renderer";

import { useIpc } from "@/lib/ipc-context";
import {
  createForgePageStore,
  type ChunkTopics,
  type ExtractState,
  type ExtractSummary,
  type ForgePageStore,
  type ForgeStep,
  type PreviewState,
  type SelectedPdf,
} from "./forge-page-store";

type ForgePageActions = {
  readonly handleFileSelected: (file: File | null) => void;
  readonly beginExtraction: () => void;
};

type ForgePageContextValue = {
  readonly store: ForgePageStore;
  readonly actions: ForgePageActions;
};

const ForgePageContext = createContext<ForgePageContextValue | null>(null);

const toRpcDefectMessage = (error: RpcDefectError): string =>
  `RPC defect (${error.code}): ${error.message}`;

const toAsyncErrorMessage = (error: unknown): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return toRpcDefectMessage(error as RpcDefectError);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
};

function useForgePageContextValue(): ForgePageContextValue {
  const context = useContext(ForgePageContext);
  if (!context) throw new Error("ForgePageProvider is missing from the component tree");
  return context;
}

export function useForgePageStore(): ForgePageStore {
  return useForgePageContextValue().store;
}

export function useForgePageActions(): ForgePageActions {
  return useForgePageContextValue().actions;
}

function useForgePageSelector<T>(
  selector: (snapshot: ReturnType<ForgePageStore["getSnapshot"]>) => T,
): T {
  const store = useForgePageStore();
  return useSelector(store, selector);
}

export function useForgeCurrentStep(): ForgeStep {
  return useForgePageSelector((snapshot) => snapshot.context.currentStep);
}

export function useForgeSelectedPdf(): SelectedPdf | null {
  return useForgePageSelector((snapshot) => snapshot.context.selectedPdf);
}

export function useForgeDuplicateOfSessionId(): number | null {
  return useForgePageSelector((snapshot) => snapshot.context.duplicateOfSessionId);
}

export function useForgePreviewState(): PreviewState {
  return useForgePageSelector((snapshot) => snapshot.context.previewState);
}

export function useForgeExtractState(): ExtractState {
  return useForgePageSelector((snapshot) => snapshot.context.extractState);
}

export function useForgeExtractSummary(): ExtractSummary | null {
  return useForgePageSelector((snapshot) => snapshot.context.extractSummary);
}

export function useForgeTopicsByChunk(): ReadonlyArray<ChunkTopics> {
  return useForgePageSelector((snapshot) => snapshot.context.topicsByChunk);
}

export function ForgePageProvider({ children }: { children: React.ReactNode }) {
  const ipc = useIpc();
  const store = useMemo(() => createForgePageStore(), []);
  const requestTokenRef = useRef(0);

  const isActiveRequest = useCallback((requestToken: number): boolean => {
    return requestTokenRef.current === requestToken;
  }, []);

  const setPreviewErrorIfActive = useCallback(
    (requestToken: number, message: string) => {
      if (!isActiveRequest(requestToken)) return;
      store.send({ type: "previewError", message });
    },
    [isActiveRequest, store],
  );

  const setExtractErrorIfActive = useCallback(
    (requestToken: number, message: string) => {
      if (!isActiveRequest(requestToken)) return;
      store.send({ type: "extractionError", message });
    },
    [isActiveRequest, store],
  );

  const handleFileSelected = useCallback(
    (file: File | null) => {
      if (!file) {
        requestTokenRef.current += 1;
        store.send({ type: "resetForNoFile" });
        return;
      }

      const sourceFilePath = window.desktopHost.getPathForFile(file);
      if (sourceFilePath.length === 0) {
        requestTokenRef.current += 1;
        store.send({
          type: "setFileSelectionError",
          message: "Unable to resolve a local file path for the selected PDF.",
        });
        return;
      }

      const requestToken = requestTokenRef.current + 1;
      requestTokenRef.current = requestToken;

      store.send({
        type: "setSelectedPdf",
        selectedPdf: {
          fileName: file.name,
          sourceFilePath,
        },
      });

      void Effect.runPromise(
        ipc.client.ForgePreviewChunks({ sourceFilePath }).pipe(
          Effect.tap((preview) =>
            Effect.sync(() => {
              if (!isActiveRequest(requestToken)) return;
              store.send({
                type: "previewReady",
                summary: preview,
              });
            }),
          ),
          Effect.mapError(toAsyncErrorMessage),
          Effect.catchAll((message) =>
            Effect.sync(() => setPreviewErrorIfActive(requestToken, message)),
          ),
        ),
      );
    },
    [ipc.client, isActiveRequest, setPreviewErrorIfActive, store],
  );

  const beginExtraction = useCallback(() => {
    const snapshot = store.getSnapshot().context;
    if (!snapshot.selectedPdf || snapshot.extractState.status === "extracting") {
      return;
    }

    store.send({ type: "setExtracting" });
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;

    void Effect.runPromise(
      ipc.client
        .ForgeStartTopicExtraction({
          sourceFilePath: snapshot.selectedPdf.sourceFilePath,
        })
        .pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              if (!isActiveRequest(requestToken)) return;
              console.log("[forge/topics]", result.topicsByChunk);
              store.send({
                type: "extractionSuccess",
                duplicateOfSessionId: result.duplicateOfSessionId,
                extraction: result.extraction,
                topicsByChunk: result.topicsByChunk,
              });
            }),
          ),
          Effect.mapError(toAsyncErrorMessage),
          Effect.catchAll((message) =>
            Effect.sync(() => setExtractErrorIfActive(requestToken, message)),
          ),
        ),
    );
  }, [ipc.client, isActiveRequest, setExtractErrorIfActive, store]);

  const actions = useMemo(
    () => ({
      handleFileSelected,
      beginExtraction,
    }),
    [handleFileSelected, beginExtraction],
  );

  const value = useMemo(
    () => ({
      store,
      actions,
    }),
    [store, actions],
  );

  return <ForgePageContext.Provider value={value}>{children}</ForgePageContext.Provider>;
}
