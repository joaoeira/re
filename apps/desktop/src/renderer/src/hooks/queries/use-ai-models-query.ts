import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

export function useAiModelsQuery() {
  const ipc = useIpc();

  return useQuery({
    queryKey: queryKeys.aiModels,
    staleTime: Infinity,
    queryFn: () =>
      runIpcEffect(
        ipc.client.ListAiModels().pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
        ),
      ),
  });
}
