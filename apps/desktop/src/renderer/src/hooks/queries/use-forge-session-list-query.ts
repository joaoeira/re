import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import type { ForgeListSessionsResult } from "@shared/rpc/schemas/forge";

export function useForgeSessionListQuery() {
  const ipc = useIpc();

  return useQuery<ForgeListSessionsResult, Error>({
    queryKey: queryKeys.forgeSessionList,
    queryFn: () =>
      runIpcEffect(
        ipc.client
          .ForgeListSessions()
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
  });
}
