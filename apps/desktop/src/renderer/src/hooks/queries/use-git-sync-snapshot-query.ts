import { useEffect } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import { WorkspaceSnapshotChanged } from "@shared/rpc/contracts";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

export function useGitSyncSnapshotQuery(rootPath: string | null) {
  const ipc = useIpc();
  const queryClient = useQueryClient();

  useEffect(() => {
    return ipc.events.subscribe(WorkspaceSnapshotChanged, (snapshot) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gitSyncSnapshot(snapshot.rootPath),
      });
    });
  }, [ipc, queryClient]);

  return useQuery({
    queryKey: queryKeys.gitSyncSnapshot(rootPath),
    queryFn: rootPath
      ? () =>
          runIpcEffect(
            ipc.client
              .GetGitSyncSnapshot({ rootPath })
              .pipe(
                Effect.catchTag("RpcDefectError", (rpcDefect) =>
                  Effect.fail(toRpcDefectError(rpcDefect)),
                ),
              ),
          )
      : skipToken,
  });
}
