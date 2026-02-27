import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import { mapSettingsErrorToError } from "@shared/settings";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

export type UseWorkspaceRootMutationsResult = {
  readonly rootPathSaving: boolean;
  readonly rootPathError: string | null;
  readonly selectDirectory: () => void;
  readonly clearRootPath: () => void;
  readonly clearError: () => void;
};

export function useWorkspaceRootMutations(): UseWorkspaceRootMutationsResult {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const [rootPathError, setRootPathError] = useState<string | null>(null);

  const { mutate: selectDirectoryMutate, isPending: isSelectingDirectory } = useMutation({
    mutationFn: async () => {
      const selected = await runIpcEffect(
        ipc.client
          .SelectDirectory()
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      );
      if (selected.path === null) {
        return { cancelled: true as const };
      }

      const settings = await runIpcEffect(
        ipc.client.SetWorkspaceRootPath({ rootPath: selected.path }).pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
          Effect.mapError(mapSettingsErrorToError),
        ),
      );
      return {
        cancelled: false as const,
        settings,
      };
    },
    onMutate: () => {
      setRootPathError(null);
    },
    onSuccess: (result) => {
      if (result.cancelled) return;

      queryClient.setQueryData(queryKeys.settings, result.settings);
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceSnapshotPrefix });
    },
    onError: (error) => {
      console.error("[settings] set workspace root", error);
      setRootPathError(`Failed to set workspace path: ${error.message}`);
    },
  });

  const { mutate: clearRootPathMutate, isPending: isClearingRootPath } = useMutation({
    mutationFn: () =>
      runIpcEffect(
        ipc.client.SetWorkspaceRootPath({ rootPath: null }).pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
          Effect.mapError(mapSettingsErrorToError),
        ),
      ),
    onMutate: () => {
      setRootPathError(null);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceSnapshotPrefix });
    },
    onError: (error) => {
      console.error("[settings] clear workspace root", error);
      setRootPathError(`Failed to clear workspace path: ${error.message}`);
    },
  });

  const clearError = useCallback(() => {
    setRootPathError(null);
  }, []);

  const selectDirectory = useCallback(() => {
    selectDirectoryMutate();
  }, [selectDirectoryMutate]);

  const clearRootPath = useCallback(() => {
    clearRootPathMutate();
  }, [clearRootPathMutate]);

  return {
    rootPathSaving: isSelectingDirectory || isClearingRootPath,
    rootPathError,
    selectDirectory,
    clearRootPath,
    clearError,
  };
}
