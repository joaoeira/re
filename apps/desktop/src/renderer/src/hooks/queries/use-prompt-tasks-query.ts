import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

export function usePromptTasksQuery() {
  const ipc = useIpc();

  return useQuery({
    queryKey: queryKeys.promptTasks,
    staleTime: Infinity,
    queryFn: () =>
      runIpcEffect(
        ipc.client
          .ListPromptTasks()
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
  });
}
