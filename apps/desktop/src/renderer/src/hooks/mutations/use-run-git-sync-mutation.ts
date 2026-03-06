import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import { mapGitSyncErrorToError } from "@shared/git";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

type RunGitSyncVariables = {
  readonly rootPath: string;
};

export function useRunGitSyncMutation() {
  const ipc = useIpc();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ rootPath }: RunGitSyncVariables) => {
      return runIpcEffect(
        ipc.client.RunGitSync({ rootPath }).pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
          Effect.mapError(mapGitSyncErrorToError),
        ),
      );
    },
    onSuccess: (result, variables) => {
      queryClient.setQueryData(queryKeys.gitSyncSnapshot(variables.rootPath), result.snapshot);
    },
    onSettled: (_result, _error, variables) => {
      if (!variables) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gitSyncSnapshot(variables.rootPath),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceSnapshot(variables.rootPath),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scanDecks(variables.rootPath) });
    },
  });
}
