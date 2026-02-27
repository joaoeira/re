import { skipToken, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

type UseForgeTopicSnapshotQueryOptions = {
  readonly refetchIntervalMs?: number | false;
};

export function useForgeTopicSnapshotQuery(
  sourceFilePath: string | null,
  options: UseForgeTopicSnapshotQueryOptions = {},
) {
  const ipc = useIpc();

  return useQuery({
    queryKey: queryKeys.forgeTopicSnapshot(sourceFilePath),
    queryFn: sourceFilePath
      ? () =>
          runIpcEffect(
            ipc.client
              .ForgeGetTopicExtractionSnapshot({ sourceFilePath })
              .pipe(
                Effect.catchTag("RpcDefectError", (rpcDefect) =>
                  Effect.fail(toRpcDefectError(rpcDefect)),
                ),
              ),
          )
      : skipToken,
    refetchInterval: options.refetchIntervalMs ?? false,
  });
}
