import { useEffect } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import { mapScanDecksErrorToError } from "@re/workspace";
import { WorkspaceSnapshotChanged } from "@shared/rpc/contracts";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

const DEFAULT_SNAPSHOT_OPTIONS = {
  includeHidden: false,
  extraIgnorePatterns: [],
} as const;

export function useWorkspaceSnapshotQuery(rootPath: string | null) {
  const ipc = useIpc();
  const queryClient = useQueryClient();

  useEffect(() => {
    return ipc.events.subscribe(WorkspaceSnapshotChanged, (snapshot) => {
      queryClient.setQueryData(queryKeys.workspaceSnapshot(snapshot.rootPath), snapshot);
    });
  }, [ipc, queryClient]);

  return useQuery({
    queryKey: queryKeys.workspaceSnapshot(rootPath),
    queryFn: rootPath
      ? () =>
          runIpcEffect(
            ipc.client
              .GetWorkspaceSnapshot({
                rootPath,
                options: DEFAULT_SNAPSHOT_OPTIONS,
              })
              .pipe(
                Effect.catchTag("RpcDefectError", (rpcDefect) =>
                  Effect.fail(toRpcDefectError(rpcDefect)),
                ),
                Effect.mapError(mapScanDecksErrorToError),
              ),
          )
      : skipToken,
  });
}
